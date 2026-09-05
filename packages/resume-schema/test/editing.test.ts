import { describe, expect, it } from "vitest"
import { applyDraft, applyStrict, type ResumePatch } from "../src/index"
import { onePage } from "../src/fixtures/index"

/**
 * The editor writes on every keystroke, so a field is invalid for as long as it
 * takes to retype it: empty between the old value and the new one, half an
 * email address, a month with no month yet. Those states have to survive in the
 * live document, because rejecting them puts the old character straight back on
 * screen and the field can never be changed.
 */

const meta = { reason: "Manual edit", skillId: "manual" } as const

function firstExperienceId(): string {
  const item = onePage.sections[0]?.items[0]
  if (!item) throw new Error("bad fixture")
  return item.id
}

describe("editing a field through to a new value", () => {
  it("lets a required field go empty on the way to being retyped", () => {
    const id = firstExperienceId()
    const item = onePage.sections[0]?.items[0]
    if (item?.kind !== "experience") throw new Error("bad fixture")

    const clear: ResumePatch = {
      ...meta,
      op: "update_fields",
      targetNodeId: id,
      before: { company: item.company },
      after: { company: "" },
    }

    const result = applyDraft(onePage, [clear])

    expect(result.applied).toHaveLength(1)
    const next = result.resume.sections[0]?.items[0]
    if (next?.kind !== "experience") throw new Error("lost the item")
    expect(next.company).toBe("")
  })

  it("accepts a half-typed email address", () => {
    const patch: ResumePatch = {
      ...meta,
      op: "update_fields",
      targetNodeId: "basics",
      before: { email: onePage.basics.email },
      after: { email: "jo@" },
    }

    const result = applyDraft(onePage, [patch])

    expect(result.applied).toHaveLength(1)
    expect(result.resume.basics.email).toBe("jo@")
  })

  it("accepts a month that has not been fully picked yet", () => {
    const id = firstExperienceId()
    const item = onePage.sections[0]?.items[0]
    if (item?.kind !== "experience") throw new Error("bad fixture")

    const patch: ResumePatch = {
      ...meta,
      op: "update_fields",
      targetNodeId: id,
      before: { start: item.start },
      after: { start: "" },
    }

    const result = applyDraft(onePage, [patch])

    expect(result.applied).toHaveLength(1)
  })

  it("still refuses an invalid document on the strict, AI-facing path", () => {
    const id = firstExperienceId()
    const item = onePage.sections[0]?.items[0]
    if (item?.kind !== "experience") throw new Error("bad fixture")

    const patch: ResumePatch = {
      ...meta,
      op: "update_fields",
      targetNodeId: id,
      before: { company: item.company },
      after: { company: "" },
    }

    const result = applyStrict(onePage, [patch])

    expect(result.ok).toBe(false)
    expect(result.failed[0]?.code).toBe("SCHEMA_INVALID")
  })

  it("gives the strict path no document to mistake for the patched one", () => {
    // The whole point of the split. One entry point used to answer both
    // questions, and its failure branch returned the *input* document, so a
    // caller reading `.resume` measured and previewed an unpatched resume
    // while believing the patches had landed.
    const id = firstExperienceId()
    const item = onePage.sections[0]?.items[0]
    if (item?.kind !== "experience") throw new Error("bad fixture")

    const patch: ResumePatch = {
      ...meta,
      op: "update_fields",
      targetNodeId: id,
      before: { company: item.company },
      after: { company: "" },
    }

    const strict = applyStrict(onePage, [patch])
    const draft = applyDraft(onePage, [patch])

    expect(strict.ok).toBe(false)
    expect(strict).not.toHaveProperty("resume")
    expect(draft.applied).toHaveLength(1)
    expect(draft.resume).not.toBe(onePage)
  })

  it("keeps structural guarantees even when the schema is relaxed", () => {
    // `applyDraft` waives the document schema, not the patch engine's own
    // rules: writing a protected field must still fail.
    const patch: ResumePatch = {
      ...meta,
      op: "update_fields",
      targetNodeId: firstExperienceId(),
      before: { id: firstExperienceId() },
      after: { id: "exp_0000000000" },
    }

    const result = applyDraft(onePage, [patch])

    expect(result.applied).toHaveLength(0)
    expect(result.failed[0]?.code).toBe("FIELD_NOT_ALLOWED")
  })
})
