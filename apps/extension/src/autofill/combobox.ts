import {
  byIds,
  clip,
  isShown,
  LIMITS,
  setNativeValue,
  textWithBreaks,
  waitFor,
} from "./dom"
import type { ComboParts } from "./types"
import type { Option } from "@workspace/autofill/fields"

function optionsIn(nodes: (Element | null)[]): HTMLElement[] {
  const found = new Set<HTMLElement>()
  for (const node of nodes)
    for (const option of node?.querySelectorAll("[role=option]") ?? [])
      if (
        option instanceof HTMLElement &&
        option.getAttribute("aria-disabled") !== "true" &&
        !option.matches(":disabled") &&
        !option.closest("[hidden], [aria-hidden=true]") &&
        isShown(option)
      )
        found.add(option)
  return [...found]
}

const textOf = (node: Element): string =>
  (node.textContent ?? "").replace(/\s+/g, " ").trim()

export const comboOptionLabel = (
  parts: ComboParts,
  option: HTMLElement
): string =>
  clip(
    parts.optionLabel?.(option) ?? textWithBreaks(option).split("\n").join(" "),
    LIMITS.option
  )

export const comboOptions = (parts: ComboParts): Option[] =>
  parts.options().map((option, index) => {
    const description = parts.optionDescription?.(option)
    return {
      id: `#${index + 1}`,
      label: comboOptionLabel(parts, option),
      ...(description ? { description: clip(description, LIMITS.option) } : {}),
    }
  })

export const sameCandidate = (
  a: Pick<Option, "label" | "description">,
  b: Pick<Option, "label" | "description">
): boolean => a.label === b.label && a.description === b.description

export function candidateElement(
  parts: ComboParts,
  candidate: Option
): HTMLElement | null {
  const options = parts.options()
  const matches = comboOptions(parts).flatMap((option, index) =>
    sameCandidate(option, candidate) ? [options[index]] : []
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export function setComboQuery(parts: ComboParts, value: string): void {
  if (parts.setQuery) parts.setQuery(value)
  else setNativeValue(parts.input, value, { blur: false })
}

/** The react-select control holds its value; its parent may hold the menu. */
export function reactSelectParts(input: HTMLInputElement): ComboParts | null {
  const control = input.closest(".select__control")
  if (!(control instanceof HTMLElement)) return null
  const container = control.parentElement ?? control
  return {
    input,
    opener: control,
    loading: () => {
      const indicator = container.querySelector(".select__loading-indicator")
      return indicator instanceof HTMLElement && isShown(indicator)
    },
    // A menu rendered in a portal is found through `aria-controls`.
    options: () => {
      const linked = optionsIn([
        ...byIds(input, input.getAttribute("aria-controls")),
        ...byIds(input, input.getAttribute("aria-owns")),
      ])
      return linked.length > 0
        ? linked
        : optionsIn([container.querySelector(".select__menu")])
    },
    values: () =>
      [
        ...control.querySelectorAll(
          ".select__single-value, .select__multi-value__label"
        ),
      ]
        .map(textOf)
        .filter((text) => text !== ""),
    clearer: () => {
      const clearer = container.querySelector(".select__clear-indicator")
      return clearer instanceof HTMLElement ? clearer : null
    },
  }
}

/** An ARIA 1.2 combobox whose value is its text, as on Ashby (Ashby 13). */
export function ariaComboParts(input: HTMLInputElement): ComboParts {
  const menus = () => [
    ...byIds(input, input.getAttribute("aria-controls")),
    ...byIds(input, input.getAttribute("aria-owns")),
  ]
  return {
    input,
    opener: input,
    loading: () =>
      menus().some(
        (menu) =>
          menu?.getAttribute("aria-busy") === "true" ||
          /^loading[.\s\u2026]*$/i.test(menu?.textContent?.trim() ?? "")
      ),
    options: () => optionsIn(menus()),
    values: () => {
      const value = input.value.trim()
      return value ? [value] : []
    },
    clearer: () => null,
  }
}

const shownOptions = (parts: ComboParts): HTMLElement[] | null => {
  const options = parts.options()
  return options.length > 0 ? options : null
}

/** Greenhouse controls menuIsOpen on keyup; Ashby opens on keydown. */
function pressKey(input: HTMLInputElement, key: "ArrowDown" | "Escape"): void {
  for (const type of ["keydown", "keyup"])
    input.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
      })
    )
}

/** Opens a closed menu, then waits for its rendered options. */
export function openCombo(
  parts: ComboParts,
  timeoutMs: number,
  cancelled: () => boolean = () => false
): Promise<HTMLElement[] | null> {
  if (cancelled()) return Promise.resolve(null)
  parts.input.focus()
  if (
    parts.input.getAttribute("aria-expanded") !== "true" &&
    !shownOptions(parts)
  )
    pressKey(parts.input, "ArrowDown")
  return waitFor(() => (cancelled() ? [] : shownOptions(parts)), timeoutMs)
}

export function closeCombo(parts: ComboParts): void {
  pressKey(parts.input, "Escape")
}
