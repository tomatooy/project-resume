import type { Json } from "@workspace/autofill"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"

import { createAutofillText } from "../src/autofill/text"
import { testModels, textGenerate } from "./mock"

const answer = (value: string, evidence: string[], blocked = false) => ({
  answers: [{ key: "f1", value, evidence, applicant: false, blocked }],
})
async function run(context: Json, outputs: ReturnType<typeof answer>[]) {
  const model = new MockLanguageModelV3({
    doGenerate: outputs.map((output) => textGenerate(JSON.stringify(output))),
  })
  const result = await createAutofillText(testModels(model)).shortText({
    context,
    fields: [{ key: "f1", label: "Required notice period", control: "text" }],
    signal: new AbortController().signal,
    deadline: Date.now() + 10_000,
  })
  return { result, model }
}

describe("autofill short text sources", () => {
  it("keeps Profile ahead of contradictory Notes and separates the prompts", async () => {
    const notes =
      "## Logistics\n- Requires 2 weeks notice.\n## Companies\n- Quora hours are acceptable."
    const { result, model } = await run(
      {
        notes,
        profile: { preferences: { noticeWeeks: 1, startKind: "notice" } },
        job: { description: "IMPORTED JOB" },
        page: { company: "IMPORTED COMPANY" },
      },
      [answer("2 weeks", ["notes"]), answer("1 week", ["profile"])]
    )
    expect(result.answers[0]).toMatchObject({
      value: "1 week",
      evidence: ["profile"],
    })
    expect(model.doGenerateCalls).toHaveLength(2)
    const notesPrompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    const recordsPrompt = JSON.stringify(model.doGenerateCalls[1]?.prompt)
    expect(notesPrompt).toContain("Quora hours are acceptable")
    expect(notesPrompt).not.toContain("noticeWeeks")
    expect(recordsPrompt).not.toContain("Quora hours")
    expect(recordsPrompt).toContain("noticeWeeks")
    expect(JSON.stringify(model.doGenerateCalls)).not.toMatch(
      /IMPORTED JOB|IMPORTED COMPANY/
    )
    expect(result.usage).toEqual({ inputTokens: 240, outputTokens: 60 })
  })

  it("uses Notes before a resume answer", async () => {
    const { result } = await run(
      {
        notes: "- Requires 2 weeks notice.",
        resume: { basics: { summary: "Available immediately" } },
      },
      [answer("2 weeks", ["notes"]), answer("Immediately", ["resume"])]
    )
    expect(result.answers[0]?.value).toBe("2 weeks")
  })

  it("does not use Notes to replace an ambiguous Profile answer", async () => {
    const { result } = await run(
      {
        notes: "- Requires 2 weeks notice.",
        profile: { preferences: { noticeWeeks: 1 } },
      },
      [answer("2 weeks", ["notes"]), answer("", [], true)]
    )
    expect(result.answers[0]).toMatchObject({ value: null, blocked: true })
  })

  it("lets explicit Notes resolve conflicting lower-priority resume facts", async () => {
    const { result } = await run(
      {
        notes: "- Requires 2 weeks notice.",
        resume: { basics: { summary: "Conflicting availability statements" } },
      },
      [answer("2 weeks", ["notes"]), answer("", ["resume"], true)]
    )
    expect(result.answers[0]).toMatchObject({
      value: "2 weeks",
      evidence: ["notes"],
      blocked: false,
    })
  })

  it("skips empty sources without manufacturing an answer", async () => {
    const { result, model } = await run(
      { notes: "", profile: {}, resume: null },
      []
    )
    expect(result.answers[0]?.value).toBeNull()
    expect(model.doGenerateCalls).toHaveLength(0)
    expect(result.usage.inputTokens).toBe(0)
  })
})
