export function buttonChoice(el: HTMLElement) {
  const buttons = [...el.querySelectorAll("button")]
  const inputs = [...el.querySelectorAll("input")]
  const input = inputs[0]
  const parent = el.parentElement
  if (
    !parent ||
    !input ||
    inputs.length !== 1 ||
    input.parentElement !== el ||
    input.type !== "checkbox" ||
    input.tabIndex !== -1 ||
    !input.name ||
    buttons.length !== 2 ||
    el.children.length !== 3 ||
    buttons.some(
      (button) =>
        button.parentElement !== el ||
        !["true", "false"].includes(
          button.getAttribute("aria-pressed") ?? ""
        ) ||
        button.getAttribute("data-option") !==
          button.textContent?.trim().toLowerCase()
    ) ||
    !["yes", "no"].every((answer) =>
      buttons.some((button) => button.getAttribute("data-option") === answer)
    )
  )
    return null
  const labels = [...parent.children].filter(
    (child): child is HTMLLabelElement =>
      child instanceof HTMLLabelElement &&
      child.htmlFor === input.name &&
      (!child.control || child.control === input)
  )
  const label = labels[0]
  if (
    labels.length !== 1 ||
    !label?.textContent?.trim() ||
    parent.querySelectorAll("input,select,textarea").length !== 1
  )
    return null
  return { buttons, input, label }
}

export function canClickChoice(button: HTMLButtonElement): boolean {
  // An omitted type submits only when the button has a form owner.
  return (
    (button.type === "button" || (button.type === "submit" && !button.form)) &&
    !button.hasAttribute("popovertarget") &&
    !button.hasAttribute("commandfor")
  )
}
