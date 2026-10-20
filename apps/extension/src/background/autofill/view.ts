import type { FieldClass, FieldDescriptor } from "@workspace/autofill/fields"
import type { AutofillGroup, AutofillView, Item } from "../../lib/autofill-view"
import {
  type AutofillSession,
  canRunPass,
  type FieldState,
  type StoredDocument,
} from "./session"

/** A pending attach the panel has not settled within a minute counts as failed. */
const ATTACH_MS = 60_000

const noGroups = (): AutofillView["groups"] => ({
  page: [],
  write: [],
  ai: [],
  filled: [],
  already: [],
})

/** Before the page's first scan arrives. */
const scanning = (): AutofillView => ({
  vendor: null,
  company: null,
  title: null,
  scanning: true,
  form: false,
  formLink: null,
  fields: 0,
  ready: 0,
  filled: 0,
  ran: false,
  running: false,
  resume: null,
  job: null,
  jobMatch: "none",
  useAnyway: false,
  earlier: null,
  missing: [],
  quota: null,
  degraded: false,
  questions: [],
  draft: "",
  notes: null,
  groups: noGroups(),
  attach: null,
  attachFailed: false,
})

type Lists = {
  write: ReadonlySet<string>
  page: ReadonlySet<string>
  attachFailed: boolean
}

/** The one group a field lands in after a run, first match wins (spec 6.4). */
function groupOf(
  field: FieldDescriptor,
  fieldClass: FieldClass | undefined,
  state: FieldState | undefined,
  lists: Lists
): AutofillGroup | null {
  if (fieldClass?.route === "write" || lists.write.has(field.id)) return "write"
  const ours = field.hasValue && state?.owned !== true
  if (ours && state?.source === "ai") return "ai"
  if (ours && state?.source === "rule") return "filled"
  if (!field.hasValue)
    return fieldClass?.route === "page" ||
      lists.page.has(field.id) ||
      state?.failed === true ||
      (fieldClass?.zone === "resume-file" && lists.attachFailed)
      ? "page"
      : null
  return "already"
}

function groupFields(
  session: AutofillSession,
  classes: ReadonlyMap<string, FieldClass>,
  attachFailed: boolean
): AutofillView["groups"] {
  const groups = noGroups()
  const lists: Lists = {
    write: new Set(session.ai.write),
    page: new Set(session.ai.page),
    attachFailed,
  }
  const overwrites = new Set(
    (session.plan?.overwrites ?? []).map(({ fieldId }) => fieldId)
  )
  for (const field of session.fields) {
    const fieldClass = classes.get(field.id)
    const state = session.states[field.id]
    const group = groupOf(field, fieldClass, state, lists)
    if (group === null) continue
    const item: Item = {
      fieldId: field.id,
      label: field.label,
      anchor: fieldClass?.anchor ?? null,
      overwrite:
        group === "already" &&
        overwrites.has(field.id) &&
        state?.owned !== true,
    }
    groups[group].push(item)
  }
  return groups
}

/** The panel's view of a tab's session (spec 6). */
export function autofillView(
  session: AutofillSession | null,
  document: StoredDocument | null,
  now: number
): AutofillView {
  if (!session) return scanning()
  const plan = session.plan
  const classes = new Map(
    (plan?.classes ?? []).map((fieldClass) => [fieldClass.fieldId, fieldClass])
  )
  const fields = new Map(session.fields.map((field) => [field.id, field]))

  const attach = session.attach
  const stale = attach?.status === "pending" && now - attach.at > ATTACH_MS
  const attachFailed = attach?.status === "failed" || stale
  const rendering =
    attach?.status === "pending" &&
    !stale &&
    document !== null &&
    document.versionId === attach.versionId
      ? {
          versionId: document.versionId,
          fileName: document.fileName,
          document: document.document,
        }
      : null

  const groups =
    session.started === null
      ? noGroups()
      : groupFields(session, classes, attachFailed)

  // Fields rules can fill now, or once their options are read.
  let ready = 0
  for (const field of session.fields) {
    const route = classes.get(field.id)?.route
    if (
      (route === "rule" || route === "pending") &&
      session.states[field.id]?.owned !== true
    )
      ready += 1
  }

  // A question stays while a field it names is on the form and empty.
  const open = (fieldId: string) => fields.get(fieldId)?.hasValue === false
  const unmatched = new Set(session.unmatched)
  const questions = session.questions
    .filter(({ original }) => original.some(({ fieldId }) => open(fieldId)))
    .map((question) => ({ ...question, unmatched: unmatched.has(question.id) }))

  const resumeId = session.resumeId ?? plan?.resumeId ?? null
  return {
    vendor: session.vendor,
    company: session.page.company,
    title: session.page.title,
    scanning: false,
    form: session.form,
    formLink: session.formLink,
    fields: session.fields.length,
    ready,
    filled: groups.ai.length + groups.filled.length,
    ran: session.started !== null,
    running: !canRunPass(session, now),
    resume:
      resumeId === null
        ? null
        : {
            id: resumeId,
            choice:
              session.resumeId !== null ? "user" : (plan?.resumeChoice ?? null),
          },
    job: plan?.job ?? null,
    jobMatch: plan?.jobMatch ?? "none",
    useAnyway: session.useAnyway,
    earlier: plan?.earlier ?? null,
    missing: plan?.missing ?? [],
    quota: session.quota,
    degraded: session.ai.degraded,
    questions,
    draft: session.draft,
    notes: session.notes && {
      outcome: session.notes.outcome,
      canRetry: session.notes.retry !== null,
      undo: session.notes.undo,
    },
    groups,
    attach: rendering,
    attachFailed,
  }
}
