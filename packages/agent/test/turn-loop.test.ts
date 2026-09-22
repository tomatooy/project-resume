import type { CustomSkill, ProposedSuggestion } from "@workspace/resume-core"
import type { ResumePatch } from "@workspace/resume-schema"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it, vi } from "vitest"

import { resolveSkills } from "../src/skills/index"
import { SKILLS } from "../src/skills/library"
import { MAX_PLAYBOOKS_PER_TURN } from "../src/tools"
import { type TurnState, runTurn } from "../src/turn"
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

function propose(
  patches: ResumePatch[],
  summary = "Tightened the selected bullet.",
  id = "call-1"
) {
  return toolCallStream("propose_patches", { patches, summary }, id)
}

function turnState(overrides: Partial<TurnState> = {}): TurnState {
  return {
    loadedSkillIds: [],
    allowStructural: false,
    ...overrides,
  }
}

describe("runTurn", () => {
  const { resume, bullet, otherBullet } = fixture()
  const good = rewrite(bullet, `${bullet.text} Shipped on time.`)
  // `otherBullet` lives in a different item than the selection, so the scope
  // rule refuses it.
  const outOfScope = rewrite(otherBullet, `${otherBullet.text} Reworded.`)

  function start(
    model: MockLanguageModelV3,
    overrides: Partial<Parameters<typeof runTurn>[0]> = {}
  ) {
    const persist = persistStub()
    const recordPlan = vi.fn(async () => undefined)
    const addSkill = vi.fn(async () => undefined)
    // The turn's library is the built-in one unless a case supplies an
    // overlay, which is what the chat route's `resolveSkills` would do.
    const { skills = SKILLS, ...rest } = overrides
    const { result } = runTurn({
      state: turnState({ selectedNodeId: bullet.id }),
      resume,
      skills,
      models: testModels(model),
      runId: "run-1",
      persist,
      recordPlan,
      addSkill,
      memory: {
        summaryText: null,
        messages: [{ role: "user", content: "Tighten this" }],
      },
      ...rest,
    })
    return { result, persist, recordPlan, addSkill }
  }

  it("validates and persists only the valid patches, then lets the model explain", async () => {
    // One refusal earns the model one more turn; here it answers in text.
    const model = new MockLanguageModelV3({
      doStream: [
        propose([good, outOfScope]),
        textStream("Kept the first; the second was outside the selected item."),
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
      rejected: [{ index: 1, code: "OUT_OF_SCOPE" }],
      gaps: [],
      summary: "Tightened the selected bullet.",
    })
  })

  it("sends the whole document, the contract and every tool", async () => {
    const model = new MockLanguageModelV3({ doStream: [propose([good])] })
    const { result } = start(model)
    await result.consumeStream()

    const call = model.doStreamCalls[0]
    const system = call?.prompt[0]
    expect(system?.role).toBe("system")
    const text = system?.role === "system" ? system.content : ""
    expect(text).toContain(bullet.id)
    expect(text).toContain(bullet.text)
    // The selection scopes what may change; the model still reads everything.
    expect(text).toContain(otherBullet.text)
    for (const op of [
      "replace_text",
      "update_fields",
      "insert_after",
      "delete",
      "move",
    ]) {
      expect(text).toContain(op)
    }
    expect(text).toContain('"root"')
    expect(text).toContain("A value of `null` in `after` clears the field")
    expect(text).toContain("Structural edits")
    expect(call?.tools?.map((t) => t.name)).toEqual([
      "plan",
      "find_skills",
      "load_skill",
      "check_fit",
      "propose_patches",
    ])
  })

  it("keeps the tool set identical on every step and every turn", async () => {
    // The whole reason the tools-versus-skills split exists: a request prefix
    // that does not change between steps is one the provider can cache.
    const model = new MockLanguageModelV3({
      doStream: [propose([outOfScope], "Retrying."), propose([good])],
    })
    const { result } = start(model)
    await result.consumeStream()

    const [first, second] = model.doStreamCalls
    expect(model.doStreamCalls).toHaveLength(2)
    expect(JSON.stringify(first?.tools)).toBe(JSON.stringify(second?.tools))
    expect(JSON.stringify(first?.prompt[0])).toBe(
      JSON.stringify(second?.prompt[0])
    )
  })

  it("assembles the same system prompt for two turns with the same state", async () => {
    const model = new MockLanguageModelV3({
      doStream: [propose([good]), propose([good])],
    })
    const { result } = start(model)
    await result.consumeStream()
    const { result: again } = start(model, { runId: "run-2" })
    await again.consumeStream()

    expect(JSON.stringify(model.doStreamCalls[0]?.prompt[0])).toBe(
      JSON.stringify(model.doStreamCalls[1]?.prompt[0])
    )
  })

  it("carries the summary, gaps and question through the proposal", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("propose_patches", {
          patches: [good],
          summary: "Rewrote the first bullet to lead with the outcome.",
          gaps: ["team size on the migration bullet"],
          followUpQuestion: "How large was the team?",
        }),
      ],
    })
    const { result } = start(model)
    await result.consumeStream()

    const steps = await result.steps
    expect(steps[0]?.toolResults[0]?.output).toMatchObject({
      summary: "Rewrote the first bullet to lead with the outcome.",
      gaps: ["team size on the migration bullet"],
      followUpQuestion: "How large was the team?",
    })
  })

  it("refuses a proposal without a summary and gives the model the step to fix it", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () =>
        toolCallStream("propose_patches", { patches: [good] }),
    })
    const { result, persist } = start(model)
    await result.consumeStream()

    // The field is required, so the tool never runs and the model is handed
    // the schema error instead. The step budget is what ends the loop.
    expect(persist).not.toHaveBeenCalled()
    expect(model.doStreamCalls).toHaveLength(6)
  })

  it("records the plan and hands back the line", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("plan", {
          summary: "Tightening the three Acme bullets.",
        }),
        propose([good]),
      ],
    })
    const { result, recordPlan } = start(model)
    await result.consumeStream()

    expect(recordPlan).toHaveBeenCalledWith({
      summary: "Tightening the three Acme bullets.",
    })
    const steps = await result.steps
    expect(steps[0]?.toolResults[0]?.output).toMatchObject({
      summary: "Tightening the three Acme bullets.",
    })
  })

  it("loads a playbook once, records it, and answers a repeat with no body", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("load_skill", { ids: ["bullet_rewrite", "nope"] }),
        toolCallStream("load_skill", { ids: ["bullet_rewrite"] }, "call-2"),
        propose([good], "Done.", "call-3"),
      ],
    })
    const state = turnState({ selectedNodeId: bullet.id })
    const { result, addSkill } = start(model, { state })
    await result.consumeStream()

    const steps = await result.steps
    expect(steps[0]?.toolResults[0]?.output).toMatchObject({
      unknown: ["nope"],
      alreadyLoaded: [],
      validIds: expect.arrayContaining(["bullet_rewrite", "jd_match"]),
    })
    const repeated = steps[1]?.toolResults[0]?.output
    expect(repeated).toMatchObject({
      loaded: [],
      alreadyLoaded: ["bullet_rewrite"],
    })
    expect(JSON.stringify(repeated)).not.toContain("Responsible for")
    expect(addSkill).toHaveBeenCalledTimes(1)
    expect(state.loadedSkillIds).toEqual(["bullet_rewrite"])
  })

  it("loads three playbooks and answers the fourth as over cap", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("load_skill", {
          ids: [
            "bullet_rewrite",
            "grammar_clarity",
            "jd_match",
            "condense_to_pages",
          ],
        }),
        propose([good], "Done.", "call-2"),
      ],
    })
    const state = turnState({ selectedNodeId: bullet.id })
    const { result, addSkill } = start(model, { state })
    await result.consumeStream()

    // The library holds four and the call asked for all four, so the fourth is
    // the one the turn's ceiling refuses. It comes back named rather than
    // dropped, which is what tells the model to stop asking for it.
    const steps = await result.steps
    expect(steps[0]?.toolResults[0]?.output).toMatchObject({
      loaded: [
        { id: "bullet_rewrite" },
        { id: "grammar_clarity" },
        { id: "jd_match" },
      ],
      overCap: ["condense_to_pages"],
    })
    expect(addSkill).toHaveBeenCalledTimes(MAX_PLAYBOOKS_PER_TURN)
    expect(state.loadedSkillIds).toEqual([
      "bullet_rewrite",
      "grammar_clarity",
      "jd_match",
    ])
  })

  it("finds playbooks by query without returning a body", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("find_skills", { query: "grammar" }),
        propose([good], "Done.", "call-2"),
      ],
    })
    const { result } = start(model)
    await result.consumeStream()

    const steps = await result.steps
    const output = steps[0]?.toolResults[0]?.output
    expect(output).toMatchObject({ skills: [{ id: "grammar_clarity" }] })
    expect(JSON.stringify(output)).not.toContain("past tense for past roles")
  })

  it("carries a playbook's not-for line through find_skills", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("find_skills", { query: "grammar" }),
        propose([good], "Done.", "call-2"),
      ],
    })
    const { result } = start(model)
    await result.consumeStream()

    const steps = await result.steps
    const output = steps[0]?.toolResults[0]?.output as {
      skills: { id: string; notFor?: string }[]
    }
    expect(output.skills[0]?.notFor).toContain("Rewriting for impact")
  })

  it("answers unknown for a playbook the user switched off", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("load_skill", { ids: ["bullet_rewrite"] }),
        propose([good], "Done.", "call-2"),
      ],
    })
    const { result, addSkill } = start(model, {
      skills: resolveSkills({ custom: [], disabledIds: ["bullet_rewrite"] }),
    })
    await result.consumeStream()

    const steps = await result.steps
    expect(steps[0]?.toolResults[0]?.output).toMatchObject({
      loaded: [],
      unknown: ["bullet_rewrite"],
    })
    // Absent from `validIds` too, so the model learns the library it has.
    const output = steps[0]?.toolResults[0]?.output as { validIds: string[] }
    expect(output.validIds).not.toContain("bullet_rewrite")
    expect(addSkill).not.toHaveBeenCalled()
  })

  it("keeps bodies out of the tool result while the model still receives them", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("load_skill", { ids: ["bullet_rewrite"] }),
        propose([good], "Done.", "call-2"),
      ],
    })
    const { result } = start(model)
    await result.consumeStream()

    const steps = await result.steps
    // What the transcript, the panel and the browser see: ids and names only.
    expect(JSON.stringify(steps[0]?.toolResults[0]?.output)).not.toContain(
      "Responsible for"
    )
    // What the next step reads: the text, attached by `toModelOutput`.
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      "Responsible for"
    )
  })

  it("wraps a user-written body as untrusted guidance", async () => {
    const custom: CustomSkill = {
      id: "usr_11111111-1111-4111-8111-111111111111",
      category: "editor",
      name: "Terse sentences",
      description: "Make sentences shorter.",
      whenToUse: "The prose is wordy and the user wants it shorter.",
      notFor: "Adding detail.",
      body: "Prefer one clause per sentence. SENTINEL_CUSTOM_BODY",
      createdAt: "2026-09-12T00:00:00.000Z",
    }
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("load_skill", { ids: [custom.id] }),
        propose([good], "Done.", "call-2"),
      ],
    })
    const { result } = start(model, {
      skills: resolveSkills({ custom: [custom], disabledIds: [] }),
    })
    await result.consumeStream()

    const steps = await result.steps
    expect(JSON.stringify(steps[0]?.toolResults[0]?.output)).not.toContain(
      "SENTINEL_CUSTOM_BODY"
    )
    const replay = JSON.stringify(model.doStreamCalls[1]?.prompt)
    expect(replay).toContain("User-authored playbook")
    expect(replay).toContain("SENTINEL_CUSTOM_BODY")
  })

  it("refuses a structural patch when the turn did not allow it", async () => {
    const section = resume.sections[0]
    if (!section) throw new Error("bad fixture")
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("propose_patches", {
          patches: [
            {
              op: "delete",
              skillId: "bullet_rewrite",
              targetNodeId: section.id,
              before: section,
              reason: "Not needed.",
            },
          ],
          summary: "Removing the section.",
        }),
      ],
    })
    const { result, persist } = start(model)
    await result.consumeStream()

    const steps = await result.steps
    expect(steps[0]?.toolResults[0]?.output).toMatchObject({
      suggestions: [],
      rejected: [{ code: "STRUCTURAL_NOT_REQUESTED" }],
      summary: "Removing the section.",
    })
    expect(persist).toHaveBeenCalledWith([])
  })

  it("lets the model correct a rejected proposal and persists only the additions", async () => {
    const model = new MockLanguageModelV3({
      doStream: [propose([outOfScope]), propose([good], "Fixed.")],
    })
    const { result, persist } = start(model)
    await result.consumeStream()

    expect(model.doStreamCalls).toHaveLength(2)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[0]?.[0]).toEqual([])
    expect(persist.mock.calls[1]?.[0]).toEqual([good])

    // The second call saw why the first was refused.
    const replay = JSON.stringify(model.doStreamCalls[1]?.prompt)
    expect(replay).toContain("OUT_OF_SCOPE")
  })

  it("stops at the step budget when proposals keep failing", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => propose([outOfScope]),
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
      doStream: [propose([], "Nothing to change.")],
    })
    const { result, persist } = start(model)
    await result.consumeStream()
    expect(model.doStreamCalls).toHaveLength(1)
    expect(persist).toHaveBeenCalledWith([])
  })
})
