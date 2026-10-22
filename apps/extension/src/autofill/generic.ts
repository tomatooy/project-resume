import type {
  Control,
  FieldDescriptor,
  Option,
} from "@workspace/autofill/fields"
import {
  LIMITS,
  clip,
  fieldId,
  groupLabel,
  helpFor,
  isShown,
  labelFor,
  labelText,
  ownLabel,
  uniqueIds,
} from "./dom"
import { hasValueNow } from "./drivers"
import type { LiveField, ScannedField } from "./types"

type Native = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
type Group = {
  type: "radio" | "checkbox"
  name: string
  first: HTMLInputElement
  members: HTMLInputElement[]
}
type Entry = { control: Native } | { group: Group }

// Passwords are never touched.
const IGNORED_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "password",
])
const TEXT_CONTROLS = [
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
] as const satisfies readonly Control[]
const PLACEHOLDER = /^(?:(?:select|choose)\b.*?(?:\.{3}|…)|-{2,}.*-{2,})$/i

const textControl = (type: string): Control =>
  TEXT_CONTROLS.find((control) => control === type) ?? "text"

const optionText = (option: HTMLOptionElement): string =>
  clip(option.label.replace(/\s+/g, " ").trim(), LIMITS.option)

/** `value=""`, or a first option like "Select..." with no `value` attribute. */
function isPlaceholder(option: HTMLOptionElement): boolean {
  if (option.value === "") return true
  return (
    option.index === 0 &&
    !option.hasAttribute("value") &&
    PLACEHOLDER.test(optionText(option))
  )
}

function usable(control: Native): boolean {
  if (control instanceof HTMLInputElement && IGNORED_TYPES.has(control.type))
    return false
  if (control.disabled || control.matches(":disabled")) return false
  if (control.getAttribute("role") === "combobox") return false
  // Vendors hide the file input itself and show a button instead.
  if (control instanceof HTMLInputElement && control.type === "file")
    return isShown(control.parentElement ?? control)
  return isShown(control)
}

const required = (control: Element): boolean =>
  control.hasAttribute("required") ||
  control.getAttribute("aria-required") === "true"

function maxLengthOf(control: Element): number | undefined {
  const value = Number.parseInt(control.getAttribute("maxlength") ?? "", 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function autocompleteOf(control: Element): string | undefined {
  const value = control.getAttribute("autocomplete")?.trim()
  return value ? clip(value, 100) : undefined
}

/** The nearest enclosing legend that is not the field's own label. */
function sectionOf(
  control: Element,
  root: Element,
  label: string
): string | undefined {
  for (
    let node = control.parentElement;
    node && root.contains(node);
    node = node.parentElement
  ) {
    if (node.localName !== "fieldset") continue
    const legend = [...node.children].find(
      (child) => child.localName === "legend"
    )
    const text = legend ? labelText(legend) : ""
    if (text && text !== label) return text
  }
  return undefined
}

/** The lowest element holding every member of a group. */
function containerOf(group: Group): HTMLElement {
  const holdsAll = (node: HTMLElement): boolean =>
    group.members.every((member) => node.contains(member))
  for (let node = group.first.parentElement; node; node = node.parentElement)
    if (holdsAll(node)) return node
  return group.first
}

/** Option ids are positional; oversized lists require manual selection. */
export function listed(choices: ScannedField["choices"]): {
  options?: Option[]
  optionState: "ready" | "unavailable"
} {
  if (choices.length > LIMITS.options) return { optionState: "unavailable" }
  return {
    optionState: "ready",
    options: choices.map(({ label }, i) => ({ id: `#${i + 1}`, label })),
  }
}

type Draft = Omit<FieldDescriptor, "id"> & {
  idFrom: HTMLElement
  name?: string
}
type Built = LiveField & { draft: Draft }

/** Value presence comes from the drivers, as vendor widgets' does. */
const finish = (field: LiveField, draft: Omit<Draft, "hasValue">): Built => ({
  ...field,
  draft: { ...draft, hasValue: hasValueNow(field) },
})

function single(control: Native, root: Element): Built {
  const label = labelFor(control)
  const base = {
    idFrom: control,
    label,
    help: helpFor(control),
    section: sectionOf(control, root, label),
    required: required(control),
  }
  if (control instanceof HTMLSelectElement) {
    const choices = [...control.options]
      .filter(
        (option) => !isPlaceholder(option) && !option.matches(":disabled")
      )
      .map((option) => ({ element: option, label: optionText(option) }))
    return finish(
      { element: control, kind: "select", choices },
      {
        ...base,
        control: "select",
        ...listed(choices),
        ...(control.multiple ? { multiple: true } : {}),
        autocomplete: autocompleteOf(control),
      }
    )
  }
  if (control instanceof HTMLTextAreaElement)
    return finish(
      { element: control, kind: "text", choices: [] },
      {
        ...base,
        control: "textarea",
        maxLength: maxLengthOf(control),
        autocomplete: autocompleteOf(control),
      }
    )
  if (control.type === "file")
    return finish(
      { element: control, kind: "file", choices: [] },
      { ...base, control: "file" }
    )
  if (control.type === "checkbox")
    return finish(
      { element: control, kind: "checkbox", choices: [] },
      { ...base, control: "checkbox" }
    )
  return finish(
    { element: control, kind: "text", choices: [] },
    {
      ...base,
      control: textControl(control.type),
      maxLength: maxLengthOf(control),
      autocomplete: autocompleteOf(control),
    }
  )
}

function grouped(group: Group, root: Element): Built {
  const label = groupLabel(group.first)
  const choices = group.members.map((member) => ({
    element: member,
    label: clip(ownLabel(member) || member.value, LIMITS.option),
  }))
  const control = group.type === "radio" ? "radio" : "checkboxes"
  return finish(
    { element: containerOf(group), kind: control, choices },
    {
      idFrom: group.first,
      name: group.name,
      label,
      help: helpFor(group.first),
      section: sectionOf(group.first, root, label),
      control,
      ...listed(choices),
      required: group.members.some(required),
    }
  )
}

/**
 * Native controls in page order. Radios sharing a name are one field, and so
 * are checkboxes; a lone checkbox is a yes or no field.
 */
export function scanGeneric(
  root: Element,
  options: { idOf?: (control: HTMLElement) => string | null } = {}
): ScannedField[] {
  const entries: Entry[] = []
  const groups = new Map<string, Group>()
  for (const control of root.querySelectorAll("input, select, textarea")) {
    if (
      !(
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement
      ) ||
      !usable(control)
    )
      continue
    if (
      control instanceof HTMLInputElement &&
      (control.type === "radio" || control.type === "checkbox")
    ) {
      const type = control.type === "radio" ? "radio" : "checkbox"
      const key = `${type}:${control.name}`
      const known = control.name ? groups.get(key) : undefined
      if (known) {
        known.members.push(control)
        continue
      }
      const group: Group = {
        type,
        name: control.name,
        first: control,
        members: [control],
      }
      if (control.name) groups.set(key, group)
      entries.push({ group })
      continue
    }
    entries.push({ control })
  }

  const scanned = entries.slice(0, LIMITS.fields).map((entry) => {
    // A lone checkbox is a yes or no field, not a list of one.
    if (
      "group" in entry &&
      (entry.group.type === "radio" || entry.group.members.length > 1)
    )
      return grouped(entry.group, root)
    return single("group" in entry ? entry.group.first : entry.control, root)
  })
  const ids = uniqueIds(
    scanned.map(({ draft }) => {
      const own = options.idOf?.(draft.idFrom)
      if (own) return clip(own, 300)
      return draft.name ? clip(draft.name, 300) : fieldId(draft.idFrom, root)
    })
  )
  return scanned.map(
    ({ draft: { idFrom, name: _name, ...rest }, ...field }, i) => ({
      ...field,
      descriptor: { id: ids[i] ?? fieldId(idFrom, root), ...rest },
    })
  )
}
