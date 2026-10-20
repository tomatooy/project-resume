import { waitFor } from "./dom"
import type { ComboParts } from "./types"

/** The elements an ARIA id list on `input` names, in the input's own tree. */
function named(input: HTMLInputElement, attribute: string): Element[] {
  const root = input.getRootNode()
  const scope =
    root instanceof Document || root instanceof ShadowRoot
      ? root
      : input.ownerDocument
  return (input.getAttribute(attribute) ?? "").split(/\s+/).flatMap((id) => {
    const target = id ? scope.getElementById(id) : null
    return target ? [target] : []
  })
}

function optionsIn(nodes: (Element | null)[]): HTMLElement[] {
  const found = new Set<HTMLElement>()
  for (const node of nodes)
    for (const option of node?.querySelectorAll("[role=option]") ?? [])
      if (option instanceof HTMLElement) found.add(option)
  return [...found]
}

const textOf = (node: Element): string =>
  (node.textContent ?? "").replace(/\s+/g, " ").trim()

/**
 * A react-select: the `.select__control` holding the input opens it, and its
 * parent holds the menu and the clear button. The outer class on Greenhouse
 * is unverified.
 */
export function reactSelectParts(input: HTMLInputElement): ComboParts | null {
  const control = input.closest(".select__control")
  if (!(control instanceof HTMLElement)) return null
  const container = control.parentElement ?? control
  return {
    input,
    opener: control,
    // A menu rendered in a portal is found through `aria-controls`.
    options: () => {
      const inMenu = optionsIn([container.querySelector(".select__menu")])
      return inMenu.length > 0
        ? inMenu
        : optionsIn(named(input, "aria-controls"))
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

/** An ARIA 1.2 combobox whose value is its text. Unverified. */
export function ariaComboParts(input: HTMLInputElement): ComboParts {
  return {
    input,
    opener: input,
    options: () =>
      optionsIn([
        ...named(input, "aria-controls"),
        ...named(input, "aria-owns"),
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

/**
 * Opens the menu and waits for its options. A menu already open is left as
 * it is: `mousedown` on an open react-select closes it.
 */
export function openCombo(
  parts: ComboParts,
  timeoutMs: number
): Promise<HTMLElement[] | null> {
  parts.input.focus()
  if (!shownOptions(parts))
    parts.opener.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    )
  return waitFor(() => shownOptions(parts), timeoutMs)
}

export function closeCombo(parts: ComboParts): void {
  parts.input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    })
  )
}
