import { describe, expect, it } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { validateDraft, type DraftInput } from "@workspace/resume-core"
import { createAutofillDrafter } from "../src/autofill/drafter"
import { testModels, textGenerate } from "./mock"

const input: DraftInput = {
  fieldId: "f1",
  fieldRevision: 2,
  question: "Describe your TypeScript experience.",
  evidence: [
    {
      evidenceId: "e1",
      text: "Built a scheduling tool in TypeScript.",
      sourceRef: {
        kind: "resume_head",
        resumeId: "550e8400-e29b-41d4-a716-446655440000",
        revision: 1,
        contentHash: "a".repeat(64),
        key: "bullet",
      },
      confirmed: true,
    },
  ],
}
const response = {
  text: "I built a scheduling tool in TypeScript.",
  citations: [
    { evidenceId: "e1", quote: "Built a scheduling tool in TypeScript." },
  ],
  missingInformation: [],
}

describe("autofill draft grounding", () => {
  it("always returns a review draft even when all cited references validate", () => {
    const draft = validateDraft(response, input, "test-model")
    expect(draft?.requiresConfirmation).toBe(true)
    expect(draft?.grounding).toBe("references_validated")
    expect(draft).not.toHaveProperty("action")
  })

  it.each([
    { ...response, citations: [] },
    {
      ...response,
      citations: [{ evidenceId: "other", quote: response.citations[0]?.quote }],
    },
    {
      ...response,
      citations: [{ evidenceId: "e1", quote: "Managed 100 employees." }],
    },
    { ...response, text: "", missingInformation: [] },
  ])("rejects ungrounded source references %#", (raw) => {
    expect(validateDraft(raw, input, "test-model")).toBeNull()
  })

  it("reports missing motivation rather than inventing an answer", () => {
    expect(
      validateDraft(
        {
          text: "",
          citations: [],
          missingInformation: ["Why you want to join this employer"],
        },
        input,
        "test-model"
      )?.text
    ).toBe("")
  })

  it("rejects text exceeding the page's character limit", () => {
    expect(
      validateDraft(response, { ...input, maxLength: 10 }, "test-model")
    ).toBeNull()
  })
})

describe("createAutofillDrafter", () => {
  it("reserves one attempt, uses confirmed sources, and exposes review-only output", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [textGenerate(JSON.stringify(response))],
    })
    let attempts = 0
    const draft = await createAutofillDrafter(testModels(model)).draft(input, {
      signal: new AbortController().signal,
      beforeAttempt: async () => {
        attempts++
      },
    })
    expect(draft.requiresConfirmation).toBe(true)
    expect(attempts).toBe(1)
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    expect(prompt).toContain(input.evidence[0]?.text)
    expect(prompt).not.toContain("550e8400-e29b-41d4-a716-446655440000")
  })

  it("does not call the provider when quota cannot be reserved", async () => {
    const model = new MockLanguageModelV3({ doGenerate: [] })
    await expect(
      createAutofillDrafter(testModels(model)).draft(input, {
        signal: new AbortController().signal,
        beforeAttempt: async () => {
          throw new Error("quota")
        },
      })
    ).rejects.toThrow("quota")
    expect(model.doGenerateCalls).toHaveLength(0)
  })
})
