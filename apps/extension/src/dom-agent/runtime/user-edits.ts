import type { RuntimeState } from "./dispatch"

/**
 * The user's own edits to the page, as the page itself can see them.
 *
 * Only a trusted event counts. A write this runtime makes dispatches its own
 * event, so counting those would make every action pause the run that made it,
 * and a page updating itself is not a person typing. What the counter is for is
 * the case a value comparison cannot see: the user working in one part of the
 * form while the run writes another, where the write is not stale, the page has
 * simply moved on from the observation it was planned against.
 */

/**
 * The extension's own panel is not the application form, so answering a question
 * in it is an input to the review flow rather than an edit that pauses the run.
 * The reader marks this UI with the same attribute the old engine did.
 */
const OWN_UI = "[data-vs-autofill]"

/**
 * A keystroke on a text field fires `input`; a selection or a blurred field
 * fires `change`. Both are edits a person made, and neither is guaranteed to
 * follow the other, so both are counted rather than one standing in for both.
 */
const EDIT_EVENTS = ["input", "change"] as const

export function watchUserEdits(state: RuntimeState): void {
  const target = globalThis.document
  if (!target || typeof target.addEventListener !== "function") return
  const count = (event: Event) => {
    if (!countsAsUserEdit(event)) return
    state.userEditEpoch += 1
  }
  for (const type of EDIT_EVENTS) target.addEventListener(type, count, true)
}

/**
 * Whether an event is a person editing the application form. Programmatic
 * writes dispatch their own event, so counting those would make every action
 * pause the run that made it, and the extension's own panel is not the form.
 */
export function countsAsUserEdit(input: {
  isTrusted?: boolean
  target: EventTarget | null
}): boolean {
  if (input.isTrusted !== true) return false
  return !isOwnUi(input.target)
}

function isOwnUi(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false
  const element = target as { closest?: (selector: string) => unknown }
  if (typeof element.closest !== "function") return false
  return element.closest(OWN_UI) !== null
}
