import type { FieldDescriptor } from "./fields"

/** Legacy descriptors remain readable while producers adopt explicit states. */
export function optionState(
  field: FieldDescriptor
): FieldDescriptor["optionState"] {
  if (field.optionState) return field.optionState
  if (field.options?.length) return "ready"
  if (field.searchable) return "search"
  if (field.optionsPending) return "pending"
  return field.control === "combobox" ? "search" : undefined
}
