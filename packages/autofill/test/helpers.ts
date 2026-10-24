import type { FieldDescriptor } from "../src/fields"

/** A required, empty text field; tests override only what they exercise. */
export function field(
  over: Partial<FieldDescriptor> & { id: string }
): FieldDescriptor {
  return {
    label: "Field",
    control: "text",
    required: true,
    hasValue: false,
    ...over,
  }
}
