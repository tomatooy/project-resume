import {
  type AutofillVendor,
  AutofillVendorSchema,
  type FieldDescriptor,
  FieldsSchema,
  type Fill,
  FillSchema,
  LIMITS,
  QuestionSchema,
} from "@workspace/autofill/fields"
import { normalizeText } from "@workspace/autofill/match"
import {
  type Counts,
  JobIdentitySchema,
  NotesOutcomeSchema,
  PlanResultSchema,
  QuotaSchema,
  StartResultSchema,
} from "@workspace/resume-core/contracts"
import { z } from "zod"
import {
  type ContentMessage,
  PageInfoSchema,
  type WriteOutcomeSchema,
} from "../../lib/autofill-protocol"
import { queued } from "../tab-state"
import { originKey } from "./origin"

/*
 * One autofill session per tab (spec 15.2), tied to the posting key. The
 * reducers are pure; the storage helpers run in the tab's queue.
 */

export type ScanMessage = Extract<ContentMessage, { type: "autofill-scan" }>
type WriteOutcome = z.infer<typeof WriteOutcomeSchema>

/** 32-bit FNV-1a over the UTF-8 bytes, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Tells a field from a different question under the same id. It is taken
 * from the field as scanned, so options read on Autofill do not change it.
 */
export function fieldSignature(field: FieldDescriptor): string {
  return fnv1a(
    JSON.stringify([
      field.control,
      normalizeText(field.label),
      (field.options ?? []).map(({ label }) => label),
    ])
  )
}

export const FieldStateSchema = z.object({
  signature: z.string(),
  /** The last value written, which a reload puts back. */
  fill: FillSchema.nullable(),
  source: z.enum(["rule", "ai"]).nullable(),
  /** Never written again: the user edited or cleared it, or the page did. */
  owned: z.boolean(),
  /** AI has tried it, so automatic passes leave it alone. */
  attempted: z.boolean(),
  failed: z.boolean(),
  /** The user inserted a Write with AI draft into it. */
  drafted: z.boolean(),
})
export type FieldState = z.infer<typeof FieldStateSchema>

export const AutofillSessionSchema = z.object({
  postingKey: z.string().nullable(),
  /** The document of the last scan; another one means the page reloaded. */
  documentId: z.string(),
  /** The frame that sent the scan: 0 in v1 (spec 15.1). */
  frameId: z.number().int().min(0),
  vendor: AutofillVendorSchema,
  url: z.string(),
  page: PageInfoSchema,
  form: z.boolean(),
  formLink: z.string().nullable(),
  /** The last scan, with the options read on Autofill merged in. */
  fields: FieldsSchema,
  scanAt: z.number(),
  /** The `scanAt` that `plan` was made for. */
  planAt: z.number().nullable(),
  plan: PlanResultSchema.nullable(),
  /** The user's pick; null leaves it to the default rules. */
  resumeId: z.uuid().nullable(),
  useAnyway: z.boolean(),
  linkedin: JobIdentitySchema.nullable(),
  /** The application record and resume snapshot of the last `start`. */
  started: z
    .object({
      resumeId: z.uuid(),
      applicationId: z.uuid(),
      versionId: z.uuid(),
      fileName: z.string(),
    })
    .nullable(),
  attach: z
    .object({
      versionId: z.uuid(),
      status: z.enum(["pending", "done", "failed"]),
      at: z.number(),
      /** The file name of the resume this one replaces. */
      previous: z.string().nullable(),
    })
    .nullable(),
  /** Kept for fields that left the form too, so a field seen once is known. */
  states: z.record(z.string(), FieldStateSchema),
  /** Automatic passes that called AI. */
  passes: z.number().int().min(0),
  /** When the pass in progress began. */
  running: z.number().nullable(),
  /** An automatic pass was asked for during that pass, so one runs after it. */
  rerun: z.boolean(),
  ai: z.object({
    write: z.array(z.string()),
    page: z.array(z.string()),
    degraded: z.boolean(),
  }),
  questions: z.array(QuestionSchema),
  unmatched: z.array(z.string()),
  draft: z.string().max(LIMITS.answer),
  notes: z
    .object({
      outcome: NotesOutcomeSchema,
      retry: z
        .object({ text: z.string(), questions: z.array(QuestionSchema) })
        .nullable(),
      undo: z.enum(["done", "refused"]).nullable(),
    })
    .nullable(),
  quota: QuotaSchema.nullable(),
})
export type AutofillSession = z.infer<typeof AutofillSessionSchema>

export type ScanFrame = {
  documentId: string
  frameId: number
  vendor: AutofillVendor
}

const blankState = (signature: string): FieldState => ({
  signature,
  fill: null,
  source: null,
  owned: false,
  attempted: false,
  failed: false,
  drafted: false,
})

function newSession(
  scan: ScanMessage,
  frame: ScanFrame,
  now: number
): AutofillSession {
  return {
    postingKey: scan.postingKey,
    documentId: frame.documentId,
    frameId: frame.frameId,
    vendor: frame.vendor,
    url: scan.url,
    page: scan.page,
    form: scan.form,
    formLink: scan.formLink,
    fields: [],
    scanAt: now,
    planAt: null,
    plan: null,
    resumeId: null,
    useAnyway: false,
    linkedin: null,
    started: null,
    attach: null,
    states: {},
    passes: 0,
    running: null,
    rerun: false,
    ai: { write: [], page: [], degraded: false },
    questions: [],
    unmatched: [],
    draft: "",
    notes: null,
    quota: null,
  }
}

/**
 * A widget lists its options only while open, so the ones read on Autofill
 * (or `searchable`, when none could be read) stay while it reports pending.
 */
function withReadOptions(
  scanned: FieldDescriptor,
  stored: FieldDescriptor | undefined
): FieldDescriptor {
  if (scanned.optionsPending !== true || scanned.options || !stored)
    return scanned
  return {
    ...scanned,
    ...(stored.options ? { options: stored.options } : {}),
    ...(stored.searchable ? { searchable: true } : {}),
  }
}

/**
 * Takes in a scan. A different posting starts a new session; a field whose
 * signature changed starts over. After a reload, `restore` holds what we
 * wrote into fields that are empty again and still ours to fill.
 */
export function applyScan(
  session: AutofillSession | null,
  scan: ScanMessage,
  frame: ScanFrame,
  now: number
): { session: AutofillSession; added: string[]; restore: Fill[] } {
  const kept = session?.postingKey === scan.postingKey ? session : null
  const base = kept ?? newSession(scan, frame, now)
  const reload = kept !== null && kept.documentId !== frame.documentId
  const stored = new Map(base.fields.map((field) => [field.id, field]))
  const states = { ...base.states }
  const added: string[] = []
  const restore: Fill[] = []
  const fields = scan.fields.map((field) => {
    const signature = fieldSignature(field)
    const state = states[field.id]
    if (!state) added.push(field.id)
    if (state?.signature !== signature) {
      states[field.id] = blankState(signature)
      return field
    }
    if (reload && state.fill && !state.owned && !field.hasValue)
      restore.push(state.fill)
    return withReadOptions(field, stored.get(field.id))
  })
  return {
    session: {
      ...base,
      documentId: frame.documentId,
      frameId: frame.frameId,
      vendor: frame.vendor,
      url: scan.url,
      page: scan.page,
      form: scan.form,
      formLink: scan.formLink,
      fields,
      states,
      // Every scan moves `scanAt`, so a plan for an older scan never looks current.
      scanAt: kept && now <= kept.scanAt ? kept.scanAt + 1 : now,
    },
    added,
    restore,
  }
}

export function markOwned(
  session: AutofillSession,
  fieldIds: string[]
): AutofillSession {
  const states = { ...session.states }
  let changed = false
  for (const id of fieldIds) {
    const state = states[id]
    if (!state || state.owned) continue
    states[id] = { ...state, owned: true }
    changed = true
  }
  return changed ? { ...session, states } : session
}

/** The user inserted a Write with AI draft into the field. */
export function markDrafted(
  session: AutofillSession,
  fieldId: string
): AutofillSession {
  const state = session.states[fieldId]
  if (!state || state.drafted) return session
  return {
    ...session,
    states: { ...session.states, [fieldId]: { ...state, drafted: true } },
  }
}

export function recordWrites(
  session: AutofillSession,
  fills: Fill[],
  results: Record<string, WriteOutcome>
): AutofillSession {
  const states = { ...session.states }
  // The content script writes only the first fill for a field.
  const seen = new Set<string>()
  for (const fill of fills) {
    const id = fill.fieldId
    const state = states[id]
    const result = results[id]
    if (seen.has(id) || !state || result === undefined) continue
    seen.add(id)
    if (result === "written")
      states[id] = { ...state, fill, source: fill.source, failed: false }
    else if (result !== "skipped") states[id] = { ...state, failed: true }
  }
  return { ...session, states }
}

/** A pass not finished after 30 s is taken as lost with its service worker. */
const PASS_MS = 30_000

export const canRunPass = (session: AutofillSession, now: number): boolean =>
  session.running === null || now - session.running >= PASS_MS

/** Fills for fields on the form, not owned, and empty unless forced. */
export function fieldsToFill(
  session: AutofillSession,
  fills: Fill[],
  force: ReadonlySet<string> = new Set()
): Fill[] {
  const fields = new Map(session.fields.map((field) => [field.id, field]))
  return fills.filter(({ fieldId }) => {
    const field = fields.get(fieldId)
    return (
      field !== undefined &&
      session.states[fieldId]?.owned !== true &&
      (!field.hasValue || force.has(fieldId))
    )
  })
}

/**
 * The tallies kept on the application record (spec 14.4). A field counts as
 * filled, as in the panel, while it holds our value and is not the user's.
 */
export function countsOf(session: AutofillSession): Counts {
  const counts: Counts = {
    fields: session.fields.length,
    rules: 0,
    ai: 0,
    asked: session.questions.length,
    drafted: 0,
  }
  for (const field of session.fields) {
    const state = session.states[field.id]
    if (!state) continue
    if (state.drafted) counts.drafted += 1
    if (state.owned || !field.hasValue) continue
    if (state.source === "rule") counts.rules += 1
    else if (state.source === "ai") counts.ai += 1
  }
  return counts
}

/** A pending attach the panel has not settled within a minute counts as failed. */
const ATTACH_MS = 60_000

/** Whether the resume attach failed, or waited on the panel too long. */
export const attachFailed = (
  attach: AutofillSession["attach"],
  now: number
): boolean =>
  attach?.status === "failed" ||
  (attach?.status === "pending" && now - attach.at > ATTACH_MS)

/**
 * The Write with AI group (spec 7): fields the rules route there and ones
 * `infer` judged to need a written answer, in form order. Empty before the
 * first run.
 */
export function writeFieldIds(session: AutofillSession): string[] {
  if (session.started === null) return []
  const routed = new Set(
    (session.plan?.classes ?? [])
      .filter(({ route }) => route === "write")
      .map(({ fieldId }) => fieldId)
  )
  const judged = new Set(session.ai.write)
  return session.fields
    .filter(({ id }) => routed.has(id) || judged.has(id))
    .map(({ id }) => id)
}

/** Whether AI calls may use the resume's job description (spec 6.3). */
export function usesJob(session: AutofillSession): boolean {
  const match = session.plan?.jobMatch
  return (
    match === "match" ||
    match === "unknown" ||
    (match === "mismatch" && session.useAnyway)
  )
}

const sessionKey = (tabId: number) => `autofill:${tabId}`
const documentKey = (tabId: number) => `autofill-doc:${tabId}`
const TAB_KEYS = [sessionKey, documentKey, originKey]

const StoredDocumentSchema = z.object({
  versionId: z.uuid(),
  fileName: z.string(),
  document: StartResultSchema.shape.document,
})
/** The resume snapshot the attached PDF is rendered from. */
export type StoredDocument = z.infer<typeof StoredDocumentSchema>

async function loadSession(tabId: number): Promise<AutofillSession | null> {
  const key = sessionKey(tabId)
  const values = await chrome.storage.session.get(key)
  const parsed = AutofillSessionSchema.safeParse(values[key])
  return parsed.success ? parsed.data : null
}

/*
 * Each helper below runs in the tab's queue. One must never call another
 * from inside its task: the queue would wait on itself.
 */

export function readSession(tabId: number): Promise<AutofillSession | null> {
  return queued(tabId, () => loadSession(tabId))
}

/**
 * `change` returns the session it was given for no change, which skips the
 * write, or null to remove the session.
 */
export function updateSession(
  tabId: number,
  change: (session: AutofillSession | null) => AutofillSession | null
): Promise<{ before: AutofillSession | null; after: AutofillSession | null }> {
  return queued(tabId, async () => {
    const before = await loadSession(tabId)
    const after = change(before)
    if (after !== before) {
      if (after === null) await chrome.storage.session.remove(sessionKey(tabId))
      else await chrome.storage.session.set({ [sessionKey(tabId)]: after })
    }
    return { before, after }
  })
}

export function saveDocument(
  tabId: number,
  value: StoredDocument
): Promise<void> {
  return queued(tabId, () =>
    chrome.storage.session.set({ [documentKey(tabId)]: value })
  )
}

export function readDocument(tabId: number): Promise<StoredDocument | null> {
  return queued(tabId, async () => {
    const key = documentKey(tabId)
    const values = await chrome.storage.session.get(key)
    const parsed = StoredDocumentSchema.safeParse(values[key])
    return parsed.success ? parsed.data : null
  })
}

/** Closing the tab drops its session, document and LinkedIn origin. */
export function forgetAutofill(tabId: number): Promise<void> {
  return queued(tabId, () =>
    chrome.storage.session.remove(TAB_KEYS.map((key) => key(tabId)))
  )
}

/** A replaced tab hands its session, document and origin to the new one. */
export async function moveAutofill(from: number, to: number): Promise<void> {
  const found = await queued(from, async () => {
    const keys = TAB_KEYS.map((key) => key(from))
    const values = await chrome.storage.session.get(keys)
    await chrome.storage.session.remove(keys)
    return values
  })
  const moved: Record<string, unknown> = {}
  for (const key of TAB_KEYS)
    if (key(from) in found) moved[key(to)] = found[key(from)]
  if (Object.keys(moved).length > 0)
    await queued(to, () => chrome.storage.session.set(moved))
}
