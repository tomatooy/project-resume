import type { FieldDescriptor } from "@workspace/autofill"
import { describe, expect, it, vi } from "vitest"

import {
  type AutofillModels,
  type GenerateInput,
  GenerateInputSchema,
  type GenerateResult,
  GenerateResultSchema,
} from "../src"
import {
  COUNTS,
  field,
  originJob,
  PAGE,
  type Session,
  session,
  USAGE,
} from "./autofill-session"
import { only } from "./harness"

const FIRST =
  "Stripe's API shaped how I think about developer tools, and I want to help build what comes next."
const SECOND =
  "I spent six years on payment systems and would bring that to the team from day one."

const why = field("why", "Why do you want to work at Stripe?", "textarea")

const writing =
  (text: string): AutofillModels["generate"] =>
  async () => ({ text, usage: USAGE })

/** Drafts through the contract, so a shape the schemas refuse fails here. */
async function generate(
  s: Session,
  target: FieldDescriptor,
  over: Partial<GenerateInput> = {}
): Promise<GenerateResult> {
  const input = GenerateInputSchema.parse({
    page: PAGE,
    resumeId: s.resumeId,
    applicationId: s.applicationId,
    useJob: false,
    counts: COUNTS,
    field: target,
    ...over,
  })
  return GenerateResultSchema.parse(await s.h.autofillService.generate(input))
}

describe("AutofillService.generate", () => {
  it("drafts within the field's limit", async () => {
    const model = vi.fn(writing(`${FIRST} ${SECOND}`))
    const s = await session({ generate: model })

    const result = await generate(s, { ...why, maxLength: 100 })

    expect(result.text).toBe(FIRST)
    expect(model.mock.calls[0]?.[0].limit).toEqual({
      kind: "characters",
      value: 100,
    })
    expect(only(s.h.db.runs)).toMatchObject({
      hintSkillId: "autofill.generate",
      status: "completed",
      inputTokens: 10,
    })

    await generate(s, field("us", "In 50 words or less, why us?", "textarea"))
    expect(model.mock.calls[1]?.[0].limit).toEqual({
      kind: "words",
      value: 50,
    })
  })

  it("refuses to draft a field outside the write zone", async () => {
    const model = vi.fn(writing(FIRST))
    const s = await session({ generate: model })

    await expect(generate(s, field("gender", "Gender"))).rejects.toMatchObject({
      code: "VALIDATION",
    })
    expect(s.h.db.runs).toEqual([])
    expect(model).not.toHaveBeenCalled()
  })

  it("uses the job description only when asked", async () => {
    const model = vi.fn(writing(FIRST))
    const s = await session({ generate: model })
    const job = await originJob(s)

    await generate(s, why, { useJob: false })
    await generate(s, why, { useJob: true })

    expect(model.mock.calls[0]?.[0].context).toMatchObject({ job: null })
    expect(model.mock.calls[1]?.[0].context).toMatchObject({
      job: { company: "Stripe", description: job.rawText },
    })
  })
})
