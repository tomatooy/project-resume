import type { AutofillVendor } from "@workspace/autofill/fields"
import type { NotesOutcome } from "@workspace/resume-core/contracts"
import type { AutofillGroup, AutofillView } from "./autofill-view"
import { atsName } from "./pages"

/*
 * The autofill panel's copy (the plan's Copy table). Pure, so the service
 * worker can send the limit and draft lines to the page overlay too.
 */

export const NO_FORM = "No application form detected"
export const OPEN_FORM = "Open the application form"
export const NO_RESUME = "Create a resume in VS:Résumé to use autofill."
export const QUESTIONS_HELP =
  "Answer only questions that apply to every application. Answer company-specific ones on the page. We add your answers to your notes for future autofill."
export const UNMATCHED = "Didn't match the options on the page"
export const NOTES_FAILED = "Couldn't update your notes"
export const NOTES_FULL =
  "Your notes are full. Clean them up in Autofill profile ›"
export const UNDO_REFUSED =
  "Notes changed since this update. Use History in Autofill profile."
export const NOTES_RESTORED = "Notes restored."
export const AI_DEGRADED = "AI couldn't finish. We filled what we could."
export const ATTACH_FAILED = "Couldn't attach your resume."
export const SET_IN_PROFILE = "Set in Profile ›"
export const DRAFT_FAILED = "Couldn't write a draft. Try again."

const dates = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
})
const times = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
})
// ICU may put a narrow no-break space before AM and PM.
const spaced = (text: string) => text.replace(/[  ]/g, " ")

export const vendorTitle = (vendor: AutofillVendor) =>
  `Autofill · ${atsName(vendor)}`

export const pageLine = (company: string | null, title: string | null) =>
  [company, title].filter(Boolean).join(" · ")

export const tailoredLine = (job: AutofillView["job"]) =>
  job ? `Tailored for ${job.company} · ${job.title}` : "No job description"

export function runLine(
  view: Pick<AutofillView, "ran" | "fields" | "ready" | "filled">
): string {
  const fields = `${view.fields} ${view.fields === 1 ? "field" : "fields"}`
  return view.ran
    ? `${fields}, ${view.filled} filled`
    : `${fields}, ${view.ready} ready to fill`
}

export const mismatchLine = (jobCompany: string, pageCompany: string) =>
  `This resume was tailored for ${jobCompany}. This application is for ${pageCompany}.`

export const questionsTitle = (n: number) => `Questions for you (${n})`

export const onThisPage = (label: string) => `On this page: "${label}"`

export const optionsText = (options: string[]) => `(${options.join(" / ")})`

export const likelyOnly = (company: string | null) =>
  `Likely only for ${company ?? "this company"}`

/** One line for a Notes merge; zero counts are left out. */
export function notesLine(outcome: NotesOutcome): string {
  if (outcome.kind === "failed") return NOTES_FAILED
  if (outcome.kind === "full") return NOTES_FULL
  const parts = [
    { n: outcome.added, word: "added" },
    { n: outcome.changed, word: "changed" },
    { n: outcome.deleted, word: "deleted" },
  ]
    .filter(({ n }) => n > 0)
    .map(({ n, word }) => `${n} ${word}`)
  return parts.length === 0
    ? "Notes unchanged"
    : `Notes updated: ${parts.join(", ")}`
}

export const missingLine = (n: number) =>
  `Your profile is missing ${n} common ${n === 1 ? "answer" : "answers"}.`

export function earlierLine(at: string, resumeTitle: string | null): string {
  const day = spaced(dates.format(new Date(at)))
  return resumeTitle
    ? `You filled this on ${day} with ${resumeTitle}`
    : `You filled this on ${day}`
}

export function limitLine(resetAt: string | null): string {
  return resetAt
    ? `AI limit reached. Resets at ${spaced(times.format(new Date(resetAt)))}.`
    : "AI limit reached."
}

const GROUP_TITLES: Record<AutofillGroup, string> = {
  page: "Fill these on the page",
  write: "Write with AI",
  ai: "AI filled, please check",
  filled: "Filled",
  already: "Already filled",
}

export const groupTitle = (group: AutofillGroup, n: number) =>
  `${GROUP_TITLES[group]} (${n})`

export const profileHint = (label: string) =>
  `This belongs in your Profile: ${label}.`
