import type { FieldDescriptor } from "@workspace/autofill/fields"

/** Discovered choices and value presence do not change the question's identity. */
export function fieldIdentity(field: FieldDescriptor): string {
  return JSON.stringify([
    field.id,
    field.control,
    field.label,
    field.help,
    field.section,
    field.required,
    field.multiple,
    field.maxLength,
    field.autocomplete,
    field.control === "combobox" ? null : field.options,
  ])
}

/** Only questions still matching the snapshot that produced an answer. */
export function matchingFields(
  expected: readonly FieldDescriptor[],
  current: readonly FieldDescriptor[]
): Set<string> {
  const identities = new Set(current.map(fieldIdentity))
  return new Set(
    expected
      .filter((field) => identities.has(fieldIdentity(field)))
      .map((field) => field.id)
  )
}
