import type { ProposedSuggestion } from "@workspace/resume-core"
import type { ResumePatch } from "@workspace/resume-schema"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it, vi } from "vitest"

import { runSkill } from "../src/turn"
import { skills } from "../src/skills/index"
import {
  fixture,
  rewrite,
  testModels,
  textStream,
  toolCallStream,
} from "./mock"

function persistStub() {
  return vi.fn(
    async (valid: ResumePatch[]): Promise<ProposedSuggestion[]> =>
      valid.map((patch, ordinal) => ({ id: `s${ordinal}`, ordinal, patch }))
  )
}

function propose(patches: ResumePatch[], id = "call-1") {
  return toolCallStream("propose_patches", { patches }, id)
}

describe("runSkill", () => {
  const { resume, bullet, otherBullet } = fixture()
  const good = rewrite(bullet, `${bullet.text} Shipped on time.`)
  // 317 appears nowhere in the resume or the message, so grounding refuses it.
  const ungrounded = rewrite(bullet, `${bullet.text} Raised revenue 317%.`)

  function start(
    model: MockLanguageModelV3,
    overrides: Partial<Parameters<typeof runSkill>[0]> = {}
  ) {
    const persist = persistStub()
    const result = runSkill({
      skill: skills.bullet_rewrite,
      ctx: { resume, userMessage: "Tighten this", selectedNodeId: bullet.id },
      models: testModels(model),
      runId: "run-1",
      persist,
      memory: {
        summaryText: null,
        messages: [{ role: "user", content: "Tighten this" }],
      },
      ...overrides,
    })
    return { result, persist }
  }

  it("validates and persists only the valid patches, then lets the model explain", async () => {
    // One refusal earns the model one more turn; here it answers in text.
    const model = new MockLanguageModelV3({
      doStream: [
        propose([good, ungrounded]),
        textStream(
          "Kept the first; the second added a number I cannot source."
        ),
      ],
    })
    const { result, persist } = start(model)
    await result.consumeStream()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]?.[0]).toEqual([good])
    expect(model.doStreamCalls).toHaveLength(2)
    expect(await result.text).toContain("Kept the first")

    const steps = await result.steps
    const output = steps[0]?.toolResults[0]?.output
    expect(output).toMatchObject({
      runId: "run-1",
      suggestions: [{ id: "s0", ordinal: 0, patch: good }],
      rejected: [{ index: 1, code: "UNGROUNDED_NUMBER" }],
      gaps: [],
    })
  })

  it("sends a scoped resume and the patch contract in the system prompt", async () => {
    const model = new MockLanguageModelV3({ doStream: [propose([good])] })
    const { result } = start(model)
    await result.consumeStream()

    const call = model.doStreamCalls[0]
    const system = call?.prompt[0]
    expect(system?.role).toBe("system")
    const text = system?.role === "system" ? system.content : ""
    expect(text).toContain(bullet.id)
    expect(text).toContain(bullet.text)
    expect(text).not.toContain(otherBullet.text)
    expect(text).toContain("propose_patches")
    expect(text).toContain("replace_text")
    expect(text).not.toContain("insert_after")
    expect(call?.tools?.map((t) => t.name)).toEqual(["propose_patches"])
  })

  it("offers check_fit only to skills that declare it", async () => {
    const model = new MockLanguageModelV3({ doStream: [propose([])] })
    const { result } = start(model, {
      skill: skills.condense_to_pages,
      ctx: { resume, userMessage: "One page please", targetPages: 1 },
    })
    await result.consumeStream()
    const names = model.doStreamCalls[0]?.tools?.map((t) => t.name) ?? []
    expect(names.sort()).toEqual(["check_fit", "propose_patches"])
  })

  it("lets the model correct a rejected proposal and persists only the additions", async () => {
    const model = new MockLanguageModelV3({
      doStream: [propose([ungrounded], "call-1"), propose([good], "call-2")],
    })
    const { result, persist } = start(model)
    await result.consumeStream()

    expect(model.doStreamCalls).toHaveLength(2)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[0]?.[0]).toEqual([])
    expect(persist.mock.calls[1]?.[0]).toEqual([good])

    // The second call saw why the first was refused.
    const replay = JSON.stringify(model.doStreamCalls[1]?.prompt)
    expect(replay).toContain("UNGROUNDED_NUMBER")
  })

  it("stops at the step budget when proposals keep failing", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => propose([ungrounded]),
    })
    const { result, persist } = start(model)
    await result.consumeStream()
    expect(model.doStreamCalls).toHaveLength(6)
    expect(persist).toHaveBeenCalledTimes(6)
  })

  it("ends on a plain text answer without persisting anything", async () => {
    const model = new MockLanguageModelV3({
      doStream: [textStream("Which bullet do you mean?")],
    })
    const { result, persist } = start(model)
    await result.consumeStream()
    expect(await result.text).toBe("Which bullet do you mean?")
    expect(persist).not.toHaveBeenCalled()
  })

  it("puts the conversation summary in front of the model", async () => {
    const model = new MockLanguageModelV3({ doStream: [propose([good])] })
    const { result } = start(model, {
      memory: {
        summaryText: "Goal: land a staff engineer role",
        messages: [{ role: "user", content: "Tighten this" }],
      },
    })
    await result.consumeStream()
    const system = model.doStreamCalls[0]?.prompt[0]
    const text = system?.role === "system" ? system.content : ""
    expect(text).toContain("Goal: land a staff engineer role")
  })

  it("stops the loop when the proposal has no valid patch but nothing was rejected", async () => {
    const model = new MockLanguageModelV3({
      doStream: [propose([])],
    })
    const { result, persist } = start(model)
    await result.consumeStream()
    expect(model.doStreamCalls).toHaveLength(1)
    expect(persist).toHaveBeenCalledWith([])
  })
})
