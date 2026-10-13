import {
  AUTOFILL_LIMITS,
  projectPageView,
  type PlanInput,
} from "@workspace/resume-core/contracts"

export function partitionSnapshot(input: PlanInput): PlanInput[] {
  const size = (value: PlanInput) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength
  const subset = (fields: PlanInput["snapshot"]["fields"]): PlanInput => ({
    ...input,
    pageView: input.pageView
      ? projectPageView(
          input.pageView,
          fields.map((field) => field.fieldId)
        )
      : undefined,
    snapshot: {
      ...input.snapshot,
      pageView: input.snapshot.pageView
        ? projectPageView(
            input.snapshot.pageView,
            fields.map((field) => field.fieldId)
          )
        : undefined,
      fields,
      groups: input.snapshot.groups.filter((g) =>
        fields.some((f) => f.groupId === g.groupId)
      ),
    },
    selections: input.selections.filter((s) =>
      fields.some((f) => f.fieldId === s.fieldId)
    ),
    overrides: input.overrides.filter((s) =>
      fields.some((f) => f.fieldId === s.fieldId)
    ),
  })
  const batches: PlanInput[] = []
  let fields: PlanInput["snapshot"]["fields"] = []
  const groups = new Map<string, PlanInput["snapshot"]["fields"]>()
  for (const field of input.snapshot.fields) {
    const key = field.groupId
      ? `group:${field.groupId}`
      : `field:${field.fieldId}`
    const group = groups.get(key) ?? []
    group.push(field)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    if (
      size(subset([...fields, ...group])) > AUTOFILL_LIMITS.bodyBytes &&
      fields.length
    ) {
      batches.push(subset(fields))
      fields = []
    }
    fields.push(...group)
    if (size(subset(fields)) > AUTOFILL_LIMITS.bodyBytes)
      throw new Error("A dependent field group exceeds the request budget")
  }
  if (fields.length || !batches.length) batches.push(subset(fields))
  return batches
}
