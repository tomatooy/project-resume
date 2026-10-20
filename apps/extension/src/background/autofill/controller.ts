import {
  type FieldDescriptor,
  type Fill,
  LIMITS,
  type Option,
  type Question,
} from "@workspace/autofill/fields"
import { plainQuestions } from "@workspace/autofill/notes"
import type {
  AutofillPage,
  InferResult,
  PlanResult,
  Quota,
} from "@workspace/resume-core/contracts"
import { z } from "zod"
import { api } from "../../lib/api"
import { DRAFT_FAILED, limitLine } from "../../lib/autofill-copy"
import type {
  WorkerReply,
  WriteOutcomeSchema,
} from "../../lib/autofill-protocol"
import type { AutofillAction, AutofillView } from "../../lib/autofill-view"
import { sendToContent } from "./send"
import {
  type AutofillSession,
  attachFailed,
  canRunPass,
  countsOf,
  fieldsToFill,
  markOwned,
  readDocument,
  readSession,
  recordWrites,
  saveDocument,
  updateSession,
  usesJob,
  writeFieldIds,
} from "./session"
import { autofillView } from "./view"

/*
 * Autofill passes for a tab (spec 15.2). One pass runs at a time: it reads
 * options, plans, starts the application record, writes rule values and asks
 * AI about the rest. The panel's other actions are here too.
 */

/** How long a server call may take; AI fields fall back to questions after it. */
const CALL_MS = 25_000
/** Automatic passes that may call AI for fields that appear after a run. */
const AUTO_PASSES = 5
/** The most questions one answer carries. */
const ANSWER_QUESTIONS = 200
/** How long a draft may take; the server gives up at 30 s. */
const DRAFT_MS = 35_000

type Mode = "manual" | "auto"
type Started = NonNullable<AutofillSession["started"]>
type Pass = { session: AutofillSession; page: AutofillPage; claim: number }
type WriteResults = Record<string, z.infer<typeof WriteOutcomeSchema>>
type AttachOutcome = WorkerReply<"autofill-attach">["result"]

const timeout = () => ({ signal: AbortSignal.timeout(CALL_MS) })

function pageOf(session: AutofillSession): AutofillPage | null {
  if (session.postingKey === null) return null
  return {
    vendor: session.vendor,
    postingKey: session.postingKey,
    url: session.url,
    ...session.page,
  }
}

/**
 * Sends the page's Write with AI buttons: the group's fields, disabled with
 * the reset time while no quota is left (spec 7). It never throws.
 */
export async function syncOverlay(tabId: number): Promise<void> {
  try {
    const session = await readSession(tabId)
    if (!session) return
    const { quota } = session
    await sendToContent(tabId, session.frameId, {
      type: "autofill-overlay",
      fieldIds: writeFieldIds(session),
      disabled: quota?.remaining === 0 ? limitLine(quota.resetAt) : null,
    })
  } catch {
    // The page is gone or still loading; its next scan or pass sends again.
  }
}

/** Changes the session only while the tab still shows the posting `key`. */
async function updatePosting(
  tabId: number,
  key: string | null,
  change: (session: AutofillSession) => AutofillSession
): Promise<AutofillSession | null> {
  const { after } = await updateSession(tabId, (session) =>
    session !== null && session.postingKey === key ? change(session) : session
  )
  return after !== null && after.postingKey === key ? after : null
}

async function readPosting(
  tabId: number,
  key: string | null
): Promise<AutofillSession | null> {
  const session = await readSession(tabId)
  return session !== null && session.postingKey === key ? session : null
}

const hasForm = (session: AutofillSession | null): session is AutofillSession =>
  session?.form === true && session.postingKey !== null

/**
 * Claims the tab's one pass, or gives null while another runs. An automatic
 * pass needs the record a run started, so it never makes the first run. One
 * that finds a pass running is noted instead, and runs when that one ends:
 * its fields appeared during that pass, which never sees them.
 */
async function claimPass(tabId: number, auto: boolean): Promise<Pass | null> {
  const now = Date.now()
  const free = (session: AutofillSession) =>
    canRunPass(session, now) && (!auto || session.started !== null)
  const { before, after } = await updateSession(tabId, (session) => {
    if (!hasForm(session)) return session
    if (free(session)) return { ...session, running: now, rerun: false }
    return auto && !canRunPass(session, now) && !session.rerun
      ? { ...session, rerun: true }
      : session
  })
  // The reducer is pure, so `before` tells whether it claimed.
  const page =
    hasForm(before) && free(before) && after !== null ? pageOf(after) : null
  return after !== null && page !== null
    ? { session: after, page, claim: now }
    : null
}

async function withPass(
  tabId: number,
  task: (pass: Pass) => Promise<void>,
  auto = false
): Promise<void> {
  const pass = await claimPass(tabId, auto)
  if (!pass) return
  try {
    await task(pass)
  } finally {
    // A pass taken as lost may have been claimed again meanwhile.
    const { before } = await updateSession(tabId, (session) =>
      session?.running === pass.claim
        ? { ...session, running: null, rerun: false }
        : session
    )
    // Each pass may change the group and the quota.
    await syncOverlay(tabId)
    if (before?.running === pass.claim && before.rerun)
      await run(tabId, "auto").catch(() => {})
  }
}

/** Waits for every task, then throws the first failure. */
async function settle(tasks: Promise<unknown>[]): Promise<void> {
  for (const result of await Promise.allSettled(tasks))
    if (result.status === "rejected") throw result.reason
}

const RateLimitedSchema = z.object({
  code: z.literal("RATE_LIMITED"),
  data: z.object({ retryAfterSeconds: z.number().optional() }).optional(),
})

/** The quota a RATE_LIMITED error stands for, or null for other errors. */
function limitedQuota(error: unknown): Quota | null {
  const limited = RateLimitedSchema.safeParse(error)
  if (!limited.success) return null
  const seconds = limited.data.data?.retryAfterSeconds
  return {
    remaining: 0,
    resetAt:
      seconds === undefined
        ? null
        : new Date(Date.now() + seconds * 1000).toISOString(),
  }
}

/** Runs an AI call; the hourly limit stores the quota and gives null. */
async function limited<T>(
  tabId: number,
  key: string,
  call: () => Promise<T>
): Promise<T | null> {
  try {
    return await call()
  } catch (error) {
    const quota = limitedQuota(error)
    if (!quota) throw error
    await updatePosting(tabId, key, (session) => ({ ...session, quota }))
    return null
  }
}

async function sendWrites(
  tabId: number,
  session: AutofillSession,
  fills: Fill[],
  force: string[] = []
): Promise<WriteResults> {
  if (fills.length === 0) return {}
  const { results } = await sendToContent(tabId, session.frameId, {
    type: "autofill-write",
    fills,
    force,
  })
  return results
}

/** Writes fills into the session's frame and records what landed. */
export async function writeFills(
  tabId: number,
  session: AutofillSession,
  fills: Fill[],
  force: string[] = []
): Promise<void> {
  if (fills.length === 0) return
  const results = await sendWrites(tabId, session, fills, force)
  await updatePosting(tabId, session.postingKey, (current) =>
    recordWrites(current, fills, results)
  )
}

/**
 * Takes in options read from closed widgets. A widget that listed none, or
 * more than a field may carry, is searched by typing instead.
 */
function withOptions(
  session: AutofillSession,
  read: Record<string, Option[] | null>
): AutofillSession {
  return {
    ...session,
    fields: session.fields.map((field) => {
      const options = read[field.id]
      if (options === undefined) return field
      return options !== null &&
        options.length > 0 &&
        options.length <= LIMITS.options
        ? { ...field, options }
        : { ...field, searchable: true }
    }),
  }
}

async function readOptions(
  tabId: number,
  { session }: Pass
): Promise<AutofillSession | null> {
  const fieldIds = session.fields
    .filter(
      (field) =>
        field.optionsPending === true &&
        !field.options &&
        !field.searchable &&
        !field.hasValue
    )
    .map(({ id }) => id)
  if (fieldIds.length === 0) return session
  const { options } = await sendToContent(tabId, session.frameId, {
    type: "autofill-read-options",
    fieldIds,
  })
  return updatePosting(tabId, session.postingKey, (current) =>
    withOptions(current, options)
  )
}

/** Plans the session's fields; the plan is kept while it is still current. */
async function planFor(
  tabId: number,
  session: AutofillSession,
  page: AutofillPage
): Promise<PlanResult> {
  const plan = await api.autofill.plan(
    {
      page,
      fields: session.fields,
      resumeId: session.resumeId,
      linkedin: session.linkedin,
    },
    timeout()
  )
  await updatePosting(tabId, page.postingKey, (current) => ({
    ...current,
    quota: plan.quota,
    // A plan for older fields or another pick is dropped.
    ...(current.scanAt === session.scanAt &&
    current.resumeId === session.resumeId
      ? { plan, planAt: session.scanAt }
      : {}),
  }))
  return plan
}

/** The plan's fill for the resume file field. */
function resumeFill(plan: PlanResult | null): Fill | null {
  return (
    [...(plan?.fills ?? []), ...(plan?.overwrites ?? [])].find(
      ({ kind }) => kind === "resume-file"
    ) ?? null
  )
}

/** The file field the resume PDF goes to, while it is not the user's. */
function resumeField(
  session: AutofillSession,
  plan: PlanResult
): FieldDescriptor | null {
  const fill = resumeFill(plan)
  const field = fill && session.fields.find(({ id }) => id === fill.fieldId)
  return field && session.states[field.id]?.owned !== true ? field : null
}

/**
 * The attach a new snapshot calls for: the first resume goes into an empty
 * field, a switched one replaces the file we attached, and the same resume
 * started again moves a pending attach to the new version.
 */
function nextAttach(
  session: AutofillSession,
  plan: PlanResult,
  started: Started,
  now: number
): AutofillSession["attach"] {
  const field = resumeField(session, plan)
  const { attach, started: before } = session
  if (!field) return attach
  const pending = (previous: string | null): AutofillSession["attach"] => ({
    versionId: started.versionId,
    status: "pending",
    at: now,
    previous,
  })
  if (before === null) return field.hasValue ? attach : pending(null)
  if (before.resumeId !== started.resumeId) {
    // A file we never attached is not ours to replace.
    if (attach === null && field.hasValue) return attach
    // Our file on the page: the last one attached, or the one an unfinished
    // attach was to replace.
    return pending(
      attach?.status === "done" ? before.fileName : (attach?.previous ?? null)
    )
  }
  return attach?.status === "pending"
    ? { ...attach, versionId: started.versionId, at: now }
    : attach
}

/**
 * Starts the application record with a snapshot of the resume, which the
 * panel renders into the PDF. A failure leaves the AI fields to questions.
 */
async function startApplication(
  tabId: number,
  pass: Pass,
  plan: PlanResult,
  resumeId: string
): Promise<Started | null> {
  const key = pass.page.postingKey
  try {
    const result = await api.autofill.start(
      {
        page: pass.page,
        resumeId,
        useJob: usesJob({ ...pass.session, plan }),
      },
      timeout()
    )
    await saveDocument(tabId, {
      versionId: result.versionId,
      fileName: result.fileName,
      document: result.document,
    })
    const started: Started = {
      resumeId,
      applicationId: result.applicationId,
      versionId: result.versionId,
      fileName: result.fileName,
    }
    const now = Date.now()
    await updatePosting(tabId, key, (session) => ({
      ...session,
      started,
      attach: nextAttach(session, plan, started, now),
    }))
    return started
  } catch {
    await updatePosting(tabId, key, (session) => ({
      ...session,
      ai: { ...session.ai, degraded: true },
    }))
    return null
  }
}

async function writeRules(
  tabId: number,
  pass: Pass,
  plan: PlanResult,
  targets: ReadonlySet<string>
): Promise<void> {
  const session = await readPosting(tabId, pass.page.postingKey)
  if (!session) return
  const fills = plan.fills.filter(
    ({ fieldId, kind }) => targets.has(fieldId) && kind !== "resume-file"
  )
  await writeFills(tabId, session, fieldsToFill(session, fills))
}

type AiOutcome = Pick<InferResult, "fills" | "write" | "page" | "questions"> & {
  degraded?: boolean
  quota?: Quota
  /** Infer was called, which counts toward the automatic passes. */
  called: boolean
}

async function infer(
  pass: Pass,
  plan: PlanResult,
  started: Started | null,
  session: AutofillSession,
  fields: FieldDescriptor[]
): Promise<AiOutcome> {
  const plain = (rest: Partial<AiOutcome>): AiOutcome => ({
    fills: [],
    write: [],
    page: [],
    questions: plainQuestions(
      fields,
      fields.map(({ id }) => id)
    ),
    called: false,
    ...rest,
  })
  if (!started) return plain({ degraded: true })
  if (plan.quota.remaining === 0) return plain({})
  try {
    const result = await api.autofill.infer(
      {
        page: pass.page,
        resumeId: started.resumeId,
        applicationId: started.applicationId,
        useJob: usesJob({ ...session, plan }),
        counts: countsOf(session),
        fields,
      },
      timeout()
    )
    return { ...result, called: true }
  } catch (error) {
    const quota = limitedQuota(error)
    return plain(
      quota ? { quota, called: true } : { degraded: true, called: true }
    )
  }
}

/** The leading number of question ids, so each pass's ids stay unique. */
function nextTag(questions: Question[]): number {
  let tag = 0
  for (const { id } of questions)
    tag = Math.max(tag, Number.parseInt(id, 10) || 0)
  return tag + 1
}

function withAiOutcome(
  session: AutofillSession,
  asked: ReadonlySet<string>,
  outcome: AiOutcome,
  mode: Mode
): AutofillSession {
  const states = { ...session.states }
  for (const id of asked) {
    const state = states[id]
    if (state) states[id] = { ...state, attempted: true }
  }
  const others = (ids: string[]) => ids.filter((id) => !asked.has(id))
  const tag = nextTag(session.questions)
  return {
    ...session,
    states,
    passes:
      mode === "auto" && outcome.called ? session.passes + 1 : session.passes,
    ai: {
      write: [...others(session.ai.write), ...outcome.write],
      page: [...others(session.ai.page), ...outcome.page],
      degraded: outcome.degraded ?? session.ai.degraded,
    },
    // New questions replace the ones about this pass's fields.
    questions: [
      ...session.questions.filter(
        ({ original }) => !original.some(({ fieldId }) => asked.has(fieldId))
      ),
      ...outcome.questions.map((question, i) => ({
        ...question,
        id: `${tag}.${i + 1}`,
      })),
    ],
    quota: outcome.quota ?? session.quota,
  }
}

/** Sends the AI fields to `infer` once the record exists, or asks about them. */
async function askAi(
  tabId: number,
  pass: Pass,
  mode: Mode,
  plan: PlanResult,
  starting: Promise<Started | null>,
  fieldIds: ReadonlySet<string>
): Promise<void> {
  if (fieldIds.size === 0) return
  const key = pass.page.postingKey
  const started = await starting
  const session = await readPosting(tabId, key)
  const fields = (session?.fields ?? []).filter(({ id }) => fieldIds.has(id))
  if (!session || fields.length === 0) return
  const asked = new Set(fields.map(({ id }) => id))
  const outcome = await infer(pass, plan, started, session, fields)
  const latest = await readPosting(tabId, key)
  if (!latest) return
  const fills = fieldsToFill(
    latest,
    outcome.fills.filter(
      ({ fieldId, kind }) => asked.has(fieldId) && kind !== "resume-file"
    )
  )
  const results = await sendWrites(tabId, latest, fills)
  await updatePosting(tabId, key, (current) =>
    withAiOutcome(recordWrites(current, fills, results), asked, outcome, mode)
  )
}

/**
 * Autofill attaches the resume again after a failed attach, or when none was
 * made, while the field is empty and not the user's. A switched resume gets
 * its own attach when it starts.
 */
async function retryAttach(
  tabId: number,
  key: string,
  plan: PlanResult
): Promise<void> {
  const now = Date.now()
  await updatePosting(tabId, key, (session) => {
    const { attach, started } = session
    const field = resumeField(session, plan)
    if (
      started === null ||
      started.resumeId !== plan.resumeId ||
      field === null ||
      field.hasValue ||
      (attach !== null && !attachFailed(attach, now))
    )
      return session
    return {
      ...session,
      attach: {
        versionId: started.versionId,
        status: "pending",
        at: now,
        previous: attach?.previous ?? null,
      },
    }
  })
}

async function runPass(tabId: number, pass: Pass, mode: Mode): Promise<void> {
  const session = await readOptions(tabId, pass)
  if (!session) return
  const plan = await planFor(tabId, session, pass.page)
  const resumeId = plan.resumeId
  if (resumeId === null) return
  if (mode === "manual") await retryAttach(tabId, pass.page.postingKey, plan)
  // Rule values do not wait for the record; AI calls need its id.
  const starting: Promise<Started | null> =
    session.started?.resumeId === resumeId
      ? Promise.resolve(session.started)
      : startApplication(tabId, pass, plan, resumeId)
  const targets =
    mode === "manual"
      ? session.fields
      : session.fields.filter(
          ({ id }) => session.states[id]?.attempted !== true
        )
  const routes = new Map(
    plan.classes.map(({ fieldId, route }) => [fieldId, route])
  )
  const aiFields =
    mode === "auto" && session.passes >= AUTO_PASSES
      ? []
      : targets.filter(
          ({ id }) =>
            routes.get(id) === "ai" && session.states[id]?.owned !== true
        )
  await settle([
    writeRules(tabId, pass, plan, new Set(targets.map(({ id }) => id))),
    askAi(
      tabId,
      pass,
      mode,
      plan,
      starting,
      new Set(aiFields.map(({ id }) => id))
    ),
    starting,
  ])
}

/** One autofill pass: every field for Autofill, new ones for `auto`. */
export function run(tabId: number, mode: Mode): Promise<void> {
  return withPass(tabId, (pass) => runPass(tabId, pass, mode), mode === "auto")
}

/** A new pick fills only empty fields and replaces the attached file (spec 6.2). */
async function pickResume(tabId: number, resumeId: string): Promise<void> {
  await updateSession(tabId, (session) =>
    session !== null && session.resumeId !== resumeId
      ? { ...session, resumeId, planAt: null }
      : session
  )
  await withPass(tabId, async (pass) => {
    const plan = await planFor(tabId, pass.session, pass.page)
    const before = pass.session.started
    if (
      before === null ||
      plan.resumeId === null ||
      plan.resumeId === before.resumeId
    )
      return
    const fields = new Set(pass.session.fields.map(({ id }) => id))
    await settle([
      writeRules(tabId, pass, plan, fields),
      startApplication(tabId, pass, plan, plan.resumeId),
    ])
  })
}

/** The record takes the job target once the user accepts it (spec 6.3). */
async function acceptJob(tabId: number): Promise<void> {
  await updateSession(tabId, (session) =>
    session !== null && !session.useAnyway
      ? { ...session, useAnyway: true }
      : session
  )
  await withPass(tabId, async (pass) => {
    const { plan, started } = pass.session
    if (plan !== null && started !== null)
      await startApplication(tabId, pass, plan, started.resumeId)
  })
}

/** Fills the open fields the questions name from the user's answer (spec 4). */
async function answerQuestions(tabId: number, text: string): Promise<void> {
  await withPass(tabId, async ({ session, page }) => {
    const { started } = session
    if (started === null) return
    const empty = new Set(
      session.fields.filter(({ hasValue }) => !hasValue).map(({ id }) => id)
    )
    const questions = session.questions
      .filter(({ original }) =>
        original.some(({ fieldId }) => empty.has(fieldId))
      )
      .slice(0, ANSWER_QUESTIONS)
    if (questions.length === 0) return
    const named = new Set(
      questions.flatMap(({ original }) =>
        original.map(({ fieldId }) => fieldId)
      )
    )
    const fields = session.fields.filter(
      ({ id }) => empty.has(id) && named.has(id)
    )
    const result = await limited(tabId, page.postingKey, () =>
      api.autofill.answer(
        {
          page,
          resumeId: started.resumeId,
          applicationId: started.applicationId,
          useJob: usesJob(session),
          counts: countsOf(session),
          fields,
          questions,
          text,
        },
        timeout()
      )
    )
    if (!result) return
    const latest = await readPosting(tabId, page.postingKey)
    if (!latest) return
    const fills = fieldsToFill(
      latest,
      result.fills.filter(
        ({ fieldId, kind }) => named.has(fieldId) && kind !== "resume-file"
      )
    )
    const results = await sendWrites(tabId, latest, fills)
    const outcome = result.notes
    await updatePosting(tabId, page.postingKey, (current) => ({
      ...recordWrites(current, fills, results),
      unmatched: result.unmatched,
      notes: {
        outcome,
        retry: outcome.kind === "failed" ? { text, questions } : null,
        undo: null,
      },
      quota: result.quota,
      draft: "",
    }))
  })
}

async function retryNotes(tabId: number): Promise<void> {
  const session = await readSession(tabId)
  const page = session ? pageOf(session) : null
  const retry = session?.notes?.retry
  if (!session?.started || !page || !retry) return
  const { resumeId } = session.started
  const result = await limited(tabId, page.postingKey, () =>
    api.autofill.notes.merge(
      { page, resumeId, questions: retry.questions, text: retry.text },
      timeout()
    )
  )
  if (result)
    await updatePosting(tabId, page.postingKey, (current) => ({
      ...current,
      notes: {
        outcome: result.notes,
        retry: result.notes.kind === "failed" ? retry : null,
        undo: null,
      },
      quota: result.quota,
    }))
  await syncOverlay(tabId)
}

async function undoNotes(tabId: number): Promise<void> {
  const session = await readSession(tabId)
  const outcome = session?.notes?.outcome
  if (
    !session ||
    outcome?.kind !== "saved" ||
    outcome.undoVersionId === null ||
    session.notes?.undo !== null
  )
    return
  const result = await api.autofill.notes.undo(
    { versionId: outcome.undoVersionId, revision: outcome.revision },
    timeout()
  )
  await updatePosting(tabId, session.postingKey, (current) =>
    current.notes
      ? {
          ...current,
          notes: {
            ...current.notes,
            undo: result.kind === "restored" ? "done" : "refused",
          },
        }
      : current
  )
}

/**
 * Attaches the PDF the panel rendered for the pending version (spec 10). It
 * is recorded as a rule fill, so a reload attaches it again.
 */
async function attachResume(
  tabId: number,
  versionId: string,
  base64: string
): Promise<void> {
  const session = await readSession(tabId)
  const attach = session?.attach
  if (
    !session ||
    attach?.status !== "pending" ||
    attach.versionId !== versionId
  )
    return
  const document = await readDocument(tabId)
  // A newer snapshot is being stored, and its own attach follows.
  if (document?.versionId !== versionId) return
  const fill = resumeFill(session.plan)
  const result: AttachOutcome = fill
    ? await sendToContent(tabId, session.frameId, {
        type: "autofill-attach",
        fieldId: fill.fieldId,
        fileName: document.fileName,
        base64,
        previous: attach.previous,
      }).then(
        (reply) => reply.result,
        (): AttachOutcome => "failed"
      )
    : "failed"
  await updatePosting(tabId, session.postingKey, (current) => {
    const recorded =
      fill && result === "attached"
        ? recordWrites(current, [fill], { [fill.fieldId]: "written" })
        : current
    const latest = current.attach
    // An attach for a newer version replaces this file in turn.
    if (latest?.status !== "pending" || latest.versionId !== versionId)
      return recorded
    // A skipped field keeps the user's own file, which needs no warning.
    return {
      ...recorded,
      attach: { ...latest, status: result === "failed" ? "failed" : "done" },
    }
  })
}

/** The panel could not render the PDF; the field goes to the page list. */
async function failAttach(tabId: number, versionId: string): Promise<void> {
  await updateSession(tabId, (session) =>
    session?.attach?.status === "pending" &&
    session.attach.versionId === versionId
      ? { ...session, attach: { ...session.attach, status: "failed" } }
      : session
  )
}

/**
 * Drafts a written answer for a Write with AI field and sends it to the
 * page's popover (spec 7). Drafts are kept nowhere. It needs the first run's
 * record, the field in the group and quota left; anything else gets a line.
 */
export async function draft(
  tabId: number,
  fieldId: string,
  instruction?: string
): Promise<void> {
  const session = await readSession(tabId)
  if (!session) return
  const reply = async (text: string | null, error: string | null) => {
    await sendToContent(tabId, session.frameId, {
      type: "autofill-draft-result",
      fieldId,
      text,
      error,
    }).catch(() => {})
  }
  const page = pageOf(session)
  const { started, quota } = session
  const field = session.fields.find(({ id }) => id === fieldId)
  if (!page || !started || !field || !writeFieldIds(session).includes(fieldId))
    return reply(null, DRAFT_FAILED)
  if (quota?.remaining === 0) return reply(null, limitLine(quota.resetAt))
  const outcome = await api.autofill
    .generate(
      {
        page,
        resumeId: started.resumeId,
        applicationId: started.applicationId,
        useJob: usesJob(session),
        counts: countsOf(session),
        field,
        ...(instruction ? { instruction } : {}),
      },
      { signal: AbortSignal.timeout(DRAFT_MS) }
    )
    .then(
      (result) => ({ text: result.text, quota: result.quota }),
      (error: unknown) => ({ text: null, quota: limitedQuota(error) })
    )
  const next = outcome.quota
  if (next)
    await updatePosting(tabId, page.postingKey, (current) => ({
      ...current,
      quota: next,
    }))
  await reply(
    outcome.text,
    outcome.text !== null ? null : next ? limitLine(next.resetAt) : DRAFT_FAILED
  )
  await syncOverlay(tabId)
}

async function clearField(tabId: number, fieldId: string): Promise<void> {
  const session = await readSession(tabId)
  if (!session) return
  await sendToContent(tabId, session.frameId, {
    type: "autofill-clear",
    fieldId,
  })
  await updateSession(tabId, (current) =>
    current ? markOwned(current, [fieldId]) : current
  )
}

/** Replaces the page's own value with the rules' one, on request. */
async function overwriteField(tabId: number, fieldId: string): Promise<void> {
  const session = await readSession(tabId)
  const fill = session?.plan?.overwrites.find(
    (candidate) =>
      candidate.fieldId === fieldId && candidate.kind !== "resume-file"
  )
  if (!session || !fill) return
  const fills = fieldsToFill(session, [fill], new Set([fieldId]))
  await writeFills(tabId, session, fills, [fieldId])
}

export async function act(
  tabId: number,
  action: AutofillAction
): Promise<void> {
  switch (action.kind) {
    case "run":
      return run(tabId, "manual")
    case "resume":
      return pickResume(tabId, action.resumeId)
    case "use-anyway":
      return acceptJob(tabId)
    case "answer":
      return answerQuestions(tabId, action.text)
    case "draft":
      await updateSession(tabId, (session) =>
        session ? { ...session, draft: action.text } : session
      )
      return
    case "retry-notes":
      return retryNotes(tabId)
    case "undo-notes":
      return undoNotes(tabId)
    case "clear":
      return clearField(tabId, action.fieldId)
    case "overwrite":
      return overwriteField(tabId, action.fieldId)
    case "focus": {
      const session = await readSession(tabId)
      await sendToContent(tabId, session?.frameId ?? 0, {
        type: "autofill-focus",
        fieldId: action.fieldId,
      })
      return
    }
    case "open-form": {
      const session = await readSession(tabId)
      if (session?.formLink)
        await chrome.tabs.update(tabId, { url: session.formLink })
      return
    }
    case "attach":
      return attachResume(tabId, action.versionId, action.base64)
    case "attach-failed":
      return failAttach(tabId, action.versionId)
  }
}

/**
 * The panel's view of the tab. A plan older than the last scan is made again
 * first, unless a pass is running; with no session the tab is asked to scan.
 */
export async function autofillSnapshot(tabId: number): Promise<AutofillView> {
  let session = await readSession(tabId)
  if (!session) {
    void sendToContent(tabId, 0, { type: "autofill-rescan" }).catch(() => {})
    return autofillView(null, null, Date.now())
  }
  const page = pageOf(session)
  if (
    session.form &&
    page !== null &&
    session.planAt !== session.scanAt &&
    canRunPass(session, Date.now())
  ) {
    await planFor(tabId, session, page)
    // A new plan brings the quota and may change the group.
    await syncOverlay(tabId)
    session = await readSession(tabId)
  }
  const document = await readDocument(tabId)
  return autofillView(session, document, Date.now())
}
