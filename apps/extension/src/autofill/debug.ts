import type { FieldDescriptor, Fill } from "@workspace/autofill/fields"

/*
 * A step-by-step trace of autofill for local debugging. It prints labels,
 * options and values, so it runs only in an unpacked build (the exception in
 * spec 16): Chrome adds `update_url` to the manifest of a Web Store install.
 * Test stubs give a manifest without `manifest_version`, so tests stay quiet
 * too. Errors print as their class only.
 */
const on = ((): boolean => {
  try {
    const manifest = chrome.runtime.getManifest()
    return manifest.manifest_version === 3 && manifest.update_url === undefined
  } catch {
    return false
  }
})()

/** One line of the trace. */
export function trace(step: string, ...details: unknown[]): void {
  if (on) console.log(`[autofill] ${step}`, ...details)
}

/** A line of the trace with a table under it. */
export function traceTable(step: string, rows: object[]): void {
  if (!on) return
  console.log(`[autofill] ${step}`)
  if (rows.length > 0) console.table(rows)
}

/** An error's code or class, never its message: API errors can quote input. */
export function errorClass(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code !== ""
  )
    return error.code
  if (error instanceof Error) return error.name || "Error"
  return typeof error
}

/** What a fill puts in its field, in words. */
export function fillText(fill: Fill): string {
  switch (fill.kind) {
    case "text":
      return JSON.stringify(fill.value)
    case "options":
      return fill.labels.join(" + ")
    case "search":
      return `search ${JSON.stringify(fill.query)}`
    case "check":
      return fill.checked ? "checked" : "unchecked"
    case "resume-file":
      return "resume PDF"
  }
}

/** A scanned field as one table row. */
export function fieldRow(
  field: FieldDescriptor
): Record<string, string | boolean> {
  return {
    label: field.label,
    control: field.control,
    options: (field.options ?? []).map(({ label }) => label).join(" | "),
    required: field.required,
    hasValue: field.hasValue,
    section: field.section ?? "",
    id: field.id,
  }
}
