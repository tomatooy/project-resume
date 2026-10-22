import { byIds, isShown, waitFor } from "./dom"
import type { ComboParts } from "./types"

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

/** The react-select control holds its value; its parent may hold the menu. */
export function reactSelectParts(input: HTMLInputElement): ComboParts | null {
  const control = input.closest(".select__control")
  if (!(control instanceof HTMLElement)) return null
  const container = control.parentElement ?? control
  return {
    input,
    opener: control,
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
  return {
    input,
    opener: input,
    options: () =>
      optionsIn([
        ...byIds(input, input.getAttribute("aria-controls")),
        ...byIds(input, input.getAttribute("aria-owns")),
      ]),
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
