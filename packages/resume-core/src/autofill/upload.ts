import type { FieldSnapshot } from "./contract"

export function isResumeUpload(
  field: Pick<FieldSnapshot, "control" | "label" | "attributes">
): boolean {
  if (field.control !== "file") return false
  const text = `${field.label} ${field.attributes.name ?? ""}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
  return (
    /\b(resume|résumé|cv|curriculum vitae)\b/i.test(text) &&
    !/cover\s*letter|portfolio|transcript|reference|certificate/i.test(text)
  )
}

export function acceptsResumePdf(accept = ""): boolean {
  return (
    !accept.trim() ||
    accept
      .split(",")
      .some((value) =>
        [".pdf", "application/pdf", "application/*", "*/*"].includes(
          value.trim().toLowerCase()
        )
      )
  )
}
