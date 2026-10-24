import type {
  FieldDescriptor,
  Fill,
  Question,
} from "@workspace/autofill/fields"
import { plainQuestions } from "@workspace/autofill/notes"
import type {
  AiRequest,
  AutofillPage,
  InferResult,
  PlanResult,
  Quota,
} from "@workspace/resume-core/contracts"
import { z } from "zod"
import { errorClass, trace } from "../../autofill/debug"
import { fieldIdentity, matchingFields } from "../../autofill/field-identity"
import { scanUrl } from "../../autofill/posting-url"
import { api } from "../../lib/api"
import { DRAFT_FAILED, limitLine } from "../../lib/autofill-copy"
import type {
  WorkerReply,
  WriteOutcomeSchema,
} from "../../lib/autofill-protocol"
import type { AutofillAction, AutofillView } from "../../lib/autofill-view"
import { autofillFrame, sameDocument } from "./frames"
import { sendToContent } from "./send"
import { withLocationResolution } from "./location-resolution"
import {
  type AutofillSession,
  applyScan,
  attachFailed,
  canRunPass,
  countsOf,
  fieldsToFill,
  markOwned,
  openQuestions,
  readDocument,
  readSession,
  recordWrites,
  saveDocument,
  updateSession,
  usesJob,
  writeFieldIds,
} from "./session"
import {
  traceAnswer,
  traceInfer,
  tracePlan,
  traceTargets,
  traceWrites,
} from "./trace"
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

/** What every AI call names: the page, the started record and its tallies. */
function aiRequest(
  session: AutofillSession,
  page: AutofillPage,
  started: Started,
  useJob = usesJob(session)
): AiRequest {
  return {
    page,
    resumeId: started.resumeId,
    applicationId: started.applicationId,
    useJob,
    counts: countsOf(session),
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
    await sendToContent(tabId, session, {
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
  if (page === null)
    trace(
      `3. no ${auto ? "automatic " : ""}pass:`,
      !hasForm(before)
        ? "no application form on the page"
        : !canRunPass(before, now)
          ? `another pass is running${auto ? "; this one runs after it" : ""}`
          : "automatic passes wait until Autofill has run once"
    )
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
): Promise<{ results: WriteResults; fills: Fill[] }> {
  if (fills.length === 0) return { results: {}, fills: [] }
  const {
    reply: { results },
    selections,
  } = await withLocationResolution(tabId, session, fills, (requestId) =>
    sendToContent(tabId, session, {
      type: "autofill-write",
      requestId,
      fills,
      force,
      identities: Object.fromEntries(
        session.fields.map((field) => [field.id, fieldIdentity(field)])
      ),
    })
  )
  const written = fills.map((fill): Fill => {
    const selection = selections.get(fill.fieldId)
    return fill.kind === "search" &&
      results[fill.fieldId] === "written" &&
      selection
      ? { ...fill, selection: selection.label, source: "ai" }
      : fill
  })
  traceWrites(session, written, results)
  return { results, fills: written }
}

/** Writes fills into the session's frame and records what landed. */
export async function writeFills(
  tabId: number,
  session: AutofillSession,
  fills: Fill[],
  force: string[] = []
): Promise<void> {
  if (fills.length === 0) return
  const { results, fills: written } = await sendWrites(
    tabId,
    session,
    fills,
    force
  )
  await updatePosting(tabId, session.postingKey, (current) => {
    if (!sameDocument(current, session)) return current
    const valid = matchingFields(session.fields, current.fields)
    return recordWrites(
      current,
      written.filter((fill) => valid.has(fill.fieldId)),
      results
    )
  })
}

async function prepareFields(
  tabId: number,
  { session }: Pass,
  retry: boolean
): Promise<AutofillSession | null> {
  const { scan } = await sendToContent(tabId, session, {
    type: "autofill-prepare",
    retry,
  })
  if (
    !scan ||
    scan.postingKey !== session.postingKey ||
    scan.url !== session.url
  )
    return null
  const now = Date.now()
  const { after } = await updateSession(tabId, (current) =>
    current &&
    sameDocument(current, session) &&
    current.postingKey === scan.postingKey
      ? applyScan(current, scan, session, now).session
      : current
  )
  return after &&
    sameDocument(after, session) &&
    after.postingKey === scan.postingKey &&
    after.revision === scan.revision
    ? after
    : null
}

/** The user's pick, else the default the first plan found (spec 6.2). */
const pickOf = (session: AutofillSession): string | null =>
  session.resumeId ?? session.defaultResume?.id ?? null

/** A default rule's pick, which the session keeps from then on. */
function defaultOf(plan: PlanResult): AutofillSession["defaultResume"] {
  const { resumeId: id, resumeChoice: choice } = plan
  return id !== null && choice !== null && choice !== "user"
    ? { id, choice }
    : null
}

/**
 * Plans the session's fields; the plan is kept while it is still current.
 * The default is computed once: later plans send it back as the pick, so a
 * new tailored resume or a late company name cannot move it.
 */
const planning = new Map<number, Map<string, Promise<PlanResult | null>>>()

const planKey = (session: AutofillSession, page: AutofillPage): string =>
  JSON.stringify([
    session.documentId,
    session.frameId,
    session.scanAt,
    page,
    session.fields,
    pickOf(session),
    session.linkedin,
  ])

function planFor(
  tabId: number,
  session: AutofillSession,
  page: AutofillPage
): Promise<PlanResult | null> {
  const key = planKey(session, page)
  const pending =
    planning.get(tabId) ?? new Map<string, Promise<PlanResult | null>>()
  const shared = pending.get(key)
  if (shared) {
    trace("reused an in-flight plan")
    return shared
  }
  const resumeId = pickOf(session)
  const request = async (): Promise<PlanResult | null> => {
    const plan = await api.autofill.plan(
      { page, fields: session.fields, resumeId, linkedin: session.linkedin },
      timeout()
    )
    const { before } = await updateSession(tabId, (current) => {
      const currentPage = current && pageOf(current)
      if (
        !current ||
        !currentPage ||
        current.scanAt !== session.scanAt ||
        planKey(current, currentPage) !== key
      )
        return current
      return {
        ...current,
        quota: plan.quota,
        defaultResume: current.defaultResume ?? defaultOf(plan),
        plan,
        planAt: current.scanAt,
      }
    })
    const beforePage = before && pageOf(before)
    return before &&
      beforePage &&
      before.scanAt === session.scanAt &&
      planKey(before, beforePage) === key
      ? plan
      : null
  }
  const running = request().finally(() => {
    pending.delete(key)
    if (pending.size === 0) planning.delete(tabId)
  })
  pending.set(key, running)
  planning.set(tabId, pending)
  return running
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
      // Passes run one at a time, so the first start's plan predates its record.
      earlier: session.started === null ? plan.earlier : session.earlier,
      started,
      attach: nextAttach(session, plan, started, now),
    }))
    trace("5. application record started; AI calls can run")
    return started
  } catch (error) {
    trace(
      `5. could not start the application record, so AI fields become questions: ${errorClass(error)}`
    )
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
  targets: ReadonlySet<string>,
  starting: Promise<Started | null>
): Promise<void> {
  if (
    plan.fills.some(
      (fill) => targets.has(fill.fieldId) && fill.kind === "search"
    )
  )
    await starting
  const session = await readPosting(tabId, pass.page.postingKey)
  if (!session || !sameDocument(session, pass.session)) return
  const fills = plan.fills.filter(({ fieldId }) => targets.has(fieldId))
  await writeFills(tabId, pass.session, fieldsToFill(session, fills))
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
  if (!started) {
    trace("7. no application record, so AI fields become questions")
    return plain({ degraded: true })
  }
  if (plan.quota.remaining === 0) {
    trace("7. hourly AI limit reached, so AI fields become questions")
    return plain({})
  }
  const useJob = usesJob({ ...session, plan })
  trace(
    `7. asking AI about ${fields.length} field(s); the job description ${useJob ? "is" : "is not"} sent:`,
    fields.map(({ label }) => label)
  )
  try {
    const result = await api.autofill.infer(
      { ...aiRequest(session, pass.page, started, useJob), fields },
      timeout()
    )
    traceInfer(fields, result)
    return { ...result, called: true }
  } catch (error) {
    trace(
      `8. the AI call failed, so these fields become questions: ${errorClass(error)}`
    )
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
  if (!session || !sameDocument(session, pass.session)) return
  const eligible = matchingFields(
    pass.session.fields,
    session.fields.filter((field) => !field.hasValue)
  )
  const fields = pass.session.fields.filter(
    (field) =>
      fieldIds.has(field.id) &&
      session.states[field.id]?.owned !== true &&
      eligible.has(field.id)
  )
  if (fields.length === 0) return
  const asked = new Set(fields.map(({ id }) => id))
  const outcome = await infer(pass, plan, started, session, fields)
  const latest = await readPosting(tabId, key)
  if (!latest || !sameDocument(latest, pass.session)) return
  const fills = fieldsToFill(
    latest,
    outcome.fills.filter(({ fieldId }) => asked.has(fieldId))
  )
  const { results, fills: written } = await sendWrites(
    tabId,
    pass.session,
    fills
  )
  await updatePosting(tabId, key, (current) => {
    if (!sameDocument(current, pass.session)) return current
    const valid = matchingFields(fields, current.fields)
    for (const id of valid) if (current.states[id]?.owned) valid.delete(id)
    return withAiOutcome(
      recordWrites(
        current,
        written.filter((fill) => valid.has(fill.fieldId)),
        results
      ),
      valid,
      {
        ...outcome,
        write: outcome.write.filter((id) => valid.has(id)),
        page: outcome.page.filter((id) => valid.has(id)),
        questions: outcome.questions.filter((question) =>
          question.original.every(({ fieldId }) => valid.has(fieldId))
        ),
      },
      mode
    )
  })
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
  trace(
    `3. ${mode === "manual" ? "Autofill" : "automatic"} pass started (${mode === "manual" ? "every field" : "only fields AI has not tried"})`
  )
  const session = await prepareFields(tabId, pass, mode === "manual")
  if (!session) return
  const page = pageOf(session)
  if (!page) return
  pass = { ...pass, session, page }
  const plan = await planFor(tabId, session, page)
  if (!plan) return
  tracePlan(session, plan)
  const resumeId = plan.resumeId
  if (resumeId === null) {
    trace("4. no resume picked, so the pass stops here")
    return
  }
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
  traceTargets(session, routes, targets, aiFields, AUTO_PASSES)
  await settle([
    writeRules(
      tabId,
      pass,
      plan,
      new Set(targets.map(({ id }) => id)),
      starting
    ),
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
    if (!plan) return
    const before = pass.session.started
    if (
      before === null ||
      plan.resumeId === null ||
      plan.resumeId === before.resumeId
    )
      return
    const fields = new Set(pass.session.fields.map(({ id }) => id))
    const starting = startApplication(tabId, pass, plan, plan.resumeId)
    await settle([writeRules(tabId, pass, plan, fields, starting), starting])
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
    // The panel's order, so the numbers in the reply match (spec 8.2).
    const questions = openQuestions(session).slice(0, ANSWER_QUESTIONS)
    if (questions.length === 0) return
    const named = new Set(
      questions.flatMap(({ original }) =>
        original.map(({ fieldId }) => fieldId)
      )
    )
    const fields = session.fields.filter(
      ({ id, hasValue }) => !hasValue && named.has(id)
    )
    trace(
      `9. Save and fill again: your reply goes to AI with ${questions.length} question(s) for these fields:`,
      fields.map(({ label }) => label)
    )
    const result = await limited(tabId, page.postingKey, () =>
      api.autofill.answer(
        { ...aiRequest(session, page, started), fields, questions, text },
        timeout()
      )
    )
    if (!result) {
      trace("9. hourly AI limit reached, so nothing was filled")
      return
    }
    traceAnswer(fields, result)
    const latest = await readPosting(tabId, page.postingKey)
    if (!latest || !sameDocument(latest, session)) return
    const fills = fieldsToFill(
      latest,
      result.fills.filter(({ fieldId }) => named.has(fieldId))
    )
    const { results, fills: written } = await sendWrites(tabId, session, fills)
    const outcome = result.notes
    await updatePosting(tabId, page.postingKey, (current) => {
      if (!sameDocument(current, session)) return current
      const valid = matchingFields(fields, current.fields)
      return {
        ...recordWrites(
          current,
          written.filter((fill) => valid.has(fill.fieldId)),
          results
        ),
        unmatched: result.unmatched,
        notes: {
          outcome,
          retry: outcome.kind === "failed" ? { text, questions } : null,
          undo: null,
        },
        quota: result.quota,
        draft: "",
      }
    })
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
    ? await sendToContent(tabId, session, {
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
    await sendToContent(tabId, session, {
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
        ...aiRequest(session, page, started),
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
  await sendToContent(tabId, session, {
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
    (candidate) => candidate.fieldId === fieldId
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
      if (!session) return
      await sendToContent(tabId, session, {
        type: "autofill-focus",
        fieldId: action.fieldId,
      })
      return
    }
    case "open-form": {
      const session = await readSession(tabId)
      if (session?.formLink)
        await sendToContent(tabId, session, { type: "autofill-open-form" })
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
  const frame = await autofillFrame(tabId)
  if (
    !session ||
    !frame ||
    !sameDocument(session, frame) ||
    session.url !== scanUrl(frame.url)
  ) {
    if (frame)
      void sendToContent(tabId, frame, { type: "autofill-rescan" }).catch(
        () => {}
      )
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
