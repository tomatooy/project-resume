import { describe, expect, it } from "vitest"

import { FieldDescriptorSchema, FieldsSchema, FillSchema } from "../src/fields"
import { field } from "./helpers"

function fields(count: number) {
  return Array.from({ length: count }, (_, i) => field({ id: `f${i}` }))
}

describe("FieldsSchema", () => {
  it("rejects more than 200 fields", () => {
    expect(FieldsSchema.safeParse(fields(200)).success).toBe(true)
    expect(FieldsSchema.safeParse(fields(201)).success).toBe(false)
  })

  it("rejects duplicate field ids", () => {
    const distinct = [field({ id: "a" }), field({ id: "b" })]
    const duplicate = [field({ id: "a" }), field({ id: "a" })]
    expect(FieldsSchema.safeParse(distinct).success).toBe(true)
    expect(FieldsSchema.safeParse(duplicate).success).toBe(false)
  })
})

describe("FieldDescriptorSchema", () => {
  it("rejects a label over 500 characters", () => {
    const at = field({ id: "a", label: "x".repeat(500) })
    const over = field({ id: "a", label: "x".repeat(501) })
    expect(FieldDescriptorSchema.safeParse(at).success).toBe(true)
    expect(FieldDescriptorSchema.safeParse(over).success).toBe(false)
  })
})

describe("FillSchema", () => {
  it("accepts every fill kind", () => {
    const base = { fieldId: "a", source: "rule" } as const
    const fills = [
      { ...base, kind: "text", value: "Ada" },
      { ...base, kind: "options", optionIds: ["#2"], labels: ["No"] },
      {
        ...base,
        kind: "search",
        query: "San Francisco",
        target: "San Francisco, CA",
      },
      { ...base, kind: "check", checked: true },
      { ...base, kind: "resume-file" },
    ]
    expect(fills.map((fill) => FillSchema.safeParse(fill).success)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
  })

  it("rejects options fills whose labels do not line up", () => {
    const fill = {
      fieldId: "a",
      source: "rule",
      kind: "options",
      optionIds: ["#1", "#2"],
      labels: ["Yes"],
    }
    expect(FillSchema.safeParse(fill).success).toBe(false)
  })
})
