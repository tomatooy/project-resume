import type { Fill, Option } from "@workspace/autofill/fields"
import { normalizeText, searchMatch } from "@workspace/autofill/match"
import { closeCombo, openCombo } from "./combobox"
import {
  LIMITS,
  clip,
  fireEdit,
  scriptClick,
  setNativeValue,
  textWithBreaks,
  waitFor,
} from "./dom"
import type {
  ComboParts,
  FieldHandle,
  LiveField,
  ScannedField,
  WriteOutcome,
} from "./types"

type OptionsFill = Extract<Fill, { kind: "options" }>
type SearchFill = Extract<Fill, { kind: "search" }>
type SearchResult =
  | { interrupted: true }
  | { interrupted: false; label: string }

const OPEN_MS = 2_000
const SEARCH_MS = 5_000
// React renders a choice during its event; other pages may take a moment.
const CONFIRM_MS = 1_000

const isTextControl = (
  element: HTMLElement
): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement

/** A selected option or a checked box. */
function isOn(element: HTMLElement): boolean {
  if (element instanceof HTMLOptionElement) return element.selected
  return element instanceof HTMLInputElement && element.checked
}

const isPressed = (element: Element): boolean =>
  element.getAttribute("aria-pressed") === "true" ||
  element.getAttribute("aria-checked") === "true"

/** Whether the field shows a value now, read from the page by kind. */
export function hasValueNow(field: LiveField): boolean {
  const { element } = field
  switch (field.kind) {
    case "text":
      return isTextControl(element) && element.value.trim() !== ""
    case "select":
    case "radio":
    case "checkboxes":
      return field.choices.some((choice) => isOn(choice.element))
    case "checkbox":
      return element instanceof HTMLInputElement && element.checked
    case "file":
      return (
        element instanceof HTMLInputElement && (element.files?.length ?? 0) > 0
      )
    case "combo":
      return (field.combo?.values().length ?? 0) > 0
    case "buttons":
      // Unverified.
      return (
        field.choices.some((choice) => isPressed(choice.element)) ||
        element.querySelector("input:checked") !== null
      )
  }
}

const squash = (text: string): string => normalizeText(text).replaceAll(" ", "")

/** The page may reformat a value, as a phone mask does. */
const sameText = (shown: string, wanted: string): boolean =>
  shown === wanted ||
  (squash(wanted) !== "" && squash(shown) === squash(wanted))

const optionLabel = (element: HTMLElement): string =>
  clip(textWithBreaks(element).split("\n").join(" "), LIMITS.option)

const comboOptionLabel = (parts: ComboParts, option: HTMLElement): string =>
  clip(parts.optionLabel?.(option) ?? optionLabel(option), LIMITS.option)

const settled = async (check: () => boolean): Promise<boolean> =>
  (await waitFor(() => (check() ? true : null), CONFIRM_MS)) !== null

/** react-select chooses on `click`, after the `mousedown` a person sends. */
function press(element: HTMLElement): void {
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  )
  scriptClick(element)
}

const isOpen = (parts: ComboParts): boolean =>
  parts.input.getAttribute("aria-expanded") === "true" ||
  parts.options().length > 0

/** `Escape` on a closed combobox may clear it, so only an open one gets it. */
function close(parts: ComboParts): void {
  if (isOpen(parts)) closeCombo(parts)
}

/**
 * The choice for each wanted option: the one at `#n` while its label still
 * matches, else the only choice with that label. Null when one has neither.
 */
function resolve(
  labels: readonly string[],
  fill: Pick<OptionsFill, "optionIds" | "labels">
): number[] | null {
  const normalized = labels.map(normalizeText)
  const picks: number[] = []
  for (const [i, id] of fill.optionIds.entries()) {
    const wanted = normalizeText(fill.labels[i] ?? "")
    const at = /^#\d+$/.test(id) ? Number(id.slice(1)) - 1 : -1
    const exact = normalized.flatMap((label, j) =>
      label === wanted ? [j] : []
    )
    const pick =
      normalized[at] === wanted ? at : exact.length === 1 ? exact[0] : undefined
    if (pick === undefined) return null
    if (!picks.includes(pick)) picks.push(pick)
  }
  return picks
}

const isMultiple = (field: ScannedField): boolean =>
  field.kind === "checkboxes" || field.descriptor.multiple === true

/** Whether the page now shows exactly the wanted choices. */
function shows(field: ScannedField, wanted: readonly HTMLElement[]): boolean {
  if (field.kind === "buttons") {
    // Without pressed state on the buttons, the click is all there is to go on.
    const reports = field.choices.some(
      ({ element }) =>
        element.hasAttribute("aria-pressed") ||
        element.hasAttribute("aria-checked")
    )
    return !reports || wanted.every(isPressed)
  }
  if (isMultiple(field))
    return field.choices.every(
      ({ element }) => isOn(element) === wanted.includes(element)
    )
  return wanted.every(isOn)
}

async function choose(
  field: ScannedField,
  picks: readonly number[]
): Promise<WriteOutcome> {
  const multiple = isMultiple(field)
  const wanted = (multiple ? picks : picks.slice(0, 1)).flatMap((i) => {
    const choice = field.choices[i]
    return choice ? [choice.element] : []
  })
  if (wanted.length === 0) return "unmatched"
  const { element } = field
  switch (field.kind) {
    case "select": {
      if (!(element instanceof HTMLSelectElement)) return "failed"
      const [first] = wanted
      if (element.multiple) {
        for (const option of element.options)
          option.selected = wanted.includes(option)
        fireEdit(element)
      } else if (first instanceof HTMLOptionElement)
        setNativeValue(element, first.value)
      break
    }
    case "radio":
    case "checkboxes":
      for (const { element: choice } of field.choices) {
        const on = wanted.includes(choice)
        // A click never turns a radio off; checking another one does.
        if (isOn(choice) !== on && (on || field.kind === "checkboxes"))
          scriptClick(choice)
      }
      break
    case "buttons":
      for (const { element: choice } of field.choices) {
        const on = wanted.includes(choice)
        if (on ? !isPressed(choice) : multiple && isPressed(choice))
          scriptClick(choice)
      }
      break
    default:
      return "failed"
  }
  return (await settled(() => shows(field, wanted))) ? "written" : "failed"
}

async function chooseInCombo(
  parts: ComboParts,
  fill: OptionsFill,
  multiple: boolean,
  cancelled: () => boolean
): Promise<WriteOutcome> {
  const shown = await openCombo(parts, OPEN_MS, cancelled)
  if (cancelled()) return "skipped"
  if (!shown) {
    close(parts)
    return "failed"
  }
  const labels = shown.map((option) => comboOptionLabel(parts, option))
  const picks = resolve(labels, fill)
  if (!picks || picks.length === 0) {
    close(parts)
    return "unmatched"
  }
  const wanted = (multiple ? picks : picks.slice(0, 1)).flatMap((i) => {
    const label = labels[i]
    return label !== undefined ? [{ id: `#${i + 1}`, label }] : []
  })
  const selected = (label: string) =>
    parts.values().some((value) => sameText(value, label))
  for (const { id, label } of wanted) {
    if (cancelled()) return "skipped"
    if (selected(label)) continue
    // A multi-select may close or reorder its menu after each choice.
    const options = await openCombo(parts, OPEN_MS, cancelled)
    if (cancelled()) return "skipped"
    if (!options) break
    const [index] =
      resolve(
        options.map((item) => comboOptionLabel(parts, item)),
        { optionIds: [id], labels: [label] }
      ) ?? []
    const target = index === undefined ? undefined : options[index]
    if (!target) break
    press(target)
  }
  if (cancelled()) return "skipped"
  close(parts)
  parts.input.blur()
  const confirmed = await settled(
    () => !isOpen(parts) && wanted.every(({ label }) => selected(label))
  )
  if (cancelled()) return "skipped"
  return confirmed ? "written" : "failed"
}

/** Clears only the query typed by this search. */
function abandonSearch(parts: ComboParts): WriteOutcome {
  close(parts)
  if (parts.input.value !== "") setQuery(parts, "")
  return "unmatched"
}

function setQuery(parts: ComboParts, value: string): void {
  if (parts.setQuery) parts.setQuery(value)
  else setNativeValue(parts.input, value, { blur: false })
}

/** Types the query and picks the result that matches the target. */
async function searchCombo(
  parts: ComboParts,
  fill: SearchFill,
  cancelled: () => boolean
): Promise<WriteOutcome> {
  const { input } = parts
  input.focus()
  setQuery(parts, fill.query)
  const started = Date.now()
  // Controlled widgets need an open gesture even after the query changes.
  await openCombo(parts, SEARCH_MS, cancelled)
  // Results may arrive late or in parts, so this waits for one that matches.
  const result = await waitFor<SearchResult>(
    () => {
      if (cancelled()) return { interrupted: true }
      const options = parts.options()
      const labels = options.map((option) => comboOptionLabel(parts, option))
      const index = (parts.matchSearch ?? searchMatch)(fill.target, labels)
      const option = index === null ? undefined : options[index]
      return option
        ? {
            interrupted: false,
            label: comboOptionLabel(parts, option),
          }
        : null
    },
    Math.max(0, SEARCH_MS - (Date.now() - started))
  )
  if (cancelled() || result?.interrupted) return "skipped"
  const found = result
  if (!found) return abandonSearch(parts)
  const live = parts
    .options()
    .filter((option) => comboOptionLabel(parts, option) === found.label)
  if (live.length !== 1 || !live[0]) return abandonSearch(parts)
  press(live[0])
  const selected = () =>
    parts.values().some((value) => sameText(value, found.label))
  const committed = await settled(selected)
  if (cancelled()) return "skipped"
  if (!committed) return "failed"
  // An uncommitted search query can look selected until the input blurs.
  input.blur()
  const confirmed = await settled(() => !isOpen(parts) && selected())
  if (cancelled()) return "skipped"
  return confirmed ? "written" : "failed"
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A fill as the field takes it: "2026-10-23" becomes "10/23/2026" for MM/DD/YYYY. */
function typedText(field: ScannedField, value: string): string {
  const iso = field.dateFormat ? ISO_DATE.exec(value) : null
  return iso ? `${iso[2]}/${iso[3]}/${iso[1]}` : value
}

async function writeText(
  field: ScannedField,
  value: string
): Promise<WriteOutcome> {
  const { element } = field
  if (field.kind !== "text" || !isTextControl(element)) return "failed"
  setNativeValue(element, value)
  return (await settled(() => sameText(element.value, value)))
    ? "written"
    : "failed"
}

async function writeCheck(
  field: ScannedField,
  checked: boolean
): Promise<WriteOutcome> {
  const { element } = field
  if (field.kind !== "checkbox" || !(element instanceof HTMLInputElement))
    return "failed"
  if (element.checked !== checked) scriptClick(element)
  return (await settled(() => element.checked === checked))
    ? "written"
    : "failed"
}

function write(
  field: ScannedField,
  fill: Fill,
  cancelled: () => boolean
): Promise<WriteOutcome> {
  if (cancelled()) return Promise.resolve("skipped")
  // Files go through the resume attach, never through a fill.
  if (field.kind === "file" || fill.kind === "resume-file")
    return Promise.resolve("skipped")
  const { combo } = field
  switch (fill.kind) {
    case "text":
      return writeText(field, typedText(field, fill.value))
    case "check":
      return writeCheck(field, fill.checked)
    case "options": {
      if (combo) return chooseInCombo(combo, fill, isMultiple(field), cancelled)
      const picks = resolve(
        field.choices.map(({ label }) => label),
        fill
      )
      return picks ? choose(field, picks) : Promise.resolve("unmatched")
    }
    case "search": {
      if (combo) return searchCombo(combo, fill, cancelled)
      if (field.kind !== "select") return Promise.resolve("failed")
      const index = searchMatch(
        fill.target,
        field.choices.map(({ label }) => label)
      )
      return index === null
        ? Promise.resolve("unmatched")
        : choose(field, [index])
    }
  }
}

async function readOptions(
  field: ScannedField,
  cancelled: () => boolean
): Promise<Option[] | null> {
  const { combo } = field
  if (!combo) return field.descriptor.options ?? null
  if (combo.input.value.trim() !== "" || cancelled()) return null
  const started = Date.now()
  try {
    await openCombo(combo, OPEN_MS, cancelled)
    let previous = ""
    let since = Date.now()
    const labels = await waitFor(
      () => {
        if (cancelled()) return []
        const shown = combo.options()
        if (combo.input.value.trim() !== "" || shown.length === 0) return null
        if (
          combo.input.getAttribute("aria-busy") === "true" ||
          shown.some((option) => option.closest('[aria-busy="true"]'))
        )
          return null
        // Virtualized lists cannot be treated as complete enumerations.
        if (
          shown.some((option) => {
            const size = Number(option.getAttribute("aria-setsize"))
            const count =
              option
                .closest('[role="listbox"]')
                ?.querySelectorAll('[role="option"]').length ?? shown.length
            return (
              size === -1 ||
              size > count ||
              Number(option.getAttribute("aria-posinset")) > count
            )
          })
        )
          return null
        const next = shown.map((option) => comboOptionLabel(combo, option))
        const signature = JSON.stringify(next)
        if (signature !== previous) {
          previous = signature
          since = Date.now()
        }
        return Date.now() - since >= 100 ? next : null
      },
      Math.max(0, OPEN_MS - (Date.now() - started))
    )
    if (
      !labels?.length ||
      labels.length > LIMITS.options ||
      labels.some((label) => !label)
    )
      return null
    return labels.map((label, i) => ({ id: `#${i + 1}`, label }))
  } finally {
    if (!cancelled()) close(combo)
  }
}

async function clearCombo(parts: ComboParts): Promise<void> {
  const clearer = parts.clearer()
  if (clearer)
    clearer.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    )
  else {
    parts.input.focus()
    // A multi-select drops one value per Backspace. Unverified.
    for (let n = parts.values().length; n > 0; n -= 1) {
      parts.input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          code: "Backspace",
          bubbles: true,
          cancelable: true,
        })
      )
      if (parts.values().length === 0) break
    }
  }
  // An ARIA combobox holds its value as its text.
  if (parts.values().length > 0 && parts.input.value !== "") setQuery(parts, "")
}

function uncheck(radio: HTMLInputElement): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "checked"
  )?.set
  if (setter) setter.call(radio, false)
  else radio.checked = false
  fireEdit(radio)
}

async function clear(field: ScannedField): Promise<void> {
  const { element } = field
  switch (field.kind) {
    case "text":
      if (isTextControl(element)) setNativeValue(element, "")
      return
    case "select": {
      if (!(element instanceof HTMLSelectElement)) return
      if (element.multiple) {
        for (const option of element.options) option.selected = false
        fireEdit(element)
        return
      }
      const choices = new Set(field.choices.map((choice) => choice.element))
      const placeholder = [...element.options].find(
        (option) => !choices.has(option)
      )
      setNativeValue(element, placeholder?.value ?? "")
      return
    }
    case "radio":
      // A click cannot turn a radio off, so its setter does. Unverified.
      for (const { element: choice } of field.choices)
        if (choice instanceof HTMLInputElement && choice.checked)
          uncheck(choice)
      return
    case "checkbox":
      if (isOn(element)) scriptClick(element)
      return
    case "checkboxes":
      for (const { element: choice } of field.choices)
        if (isOn(choice)) scriptClick(choice)
      return
    case "buttons":
      // Unverified.
      for (const { element: choice } of field.choices)
        if (isPressed(choice)) scriptClick(choice)
      return
    case "combo":
      if (field.combo) await clearCombo(field.combo)
      return
    case "file":
      // The resume attach replaces files; Clear leaves them.
      return
  }
}

function focus(field: ScannedField): void {
  const { element } = field
  // Vendors hide the file input behind their own button.
  const anchor =
    field.kind === "file" ? (element.parentElement ?? element) : element
  // jsdom has no scrollIntoView.
  if (typeof anchor.scrollIntoView === "function")
    anchor.scrollIntoView({ block: "center" })
  const grouped =
    field.kind === "radio" ||
    field.kind === "checkboxes" ||
    field.kind === "buttons"
  const target = grouped ? (field.choices[0]?.element ?? element) : element
  target.focus({ preventScroll: true })
}

/** Reads and writes one scanned field. No driver ever sends `Enter`. */
export function handleFor(field: ScannedField): FieldHandle {
  return {
    descriptor: field.descriptor,
    hasValue: () => hasValueNow(field),
    readOptions: (cancelled = () => false) => readOptions(field, cancelled),
    write: (fill, cancelled = () => false) =>
      write(field, fill, () => cancelled() || !field.element.isConnected),
    clear: () => clear(field),
    focus: () => focus(field),
  }
}
