import type { UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"

import { checkFitState, startTurn } from "../src/turn"
import {
  fixture,
  rewrite,
  testModels,
  textStream,
  textThenToolStream,
} from "./mock"

function message(parts: UIMessage["parts"]): UIMessage {
  return { id: "m1", role: "assistant", parts }
}

/**
 * The three routes through the chat handler all turn on this one question, and
 * each used to answer it with its own inline part scan: whether to continue a
 * run, whether to supersede an abandoned one, and whether the turn paused
 * rather than ended.
 */
describe("checkFitState", () => {
  it("is awaiting while the call is open", () => {
    expect(
      checkFitState(
        message([
          {
            type: "tool-check_fit",
            toolCallId: "c1",
            state: "input-available",
            input: { patches: [] },
          },
        ])
      )
    ).toBe("awaiting")
  })

  it("is answered once a page count comes back", () => {
    expect(
      checkFitState(
        message([
          {
            type: "tool-check_fit",
            toolCallId: "c1",
            state: "output-available",
            input: { patches: [] },
            output: { pageCount: 2, pageSize: "LETTER" },
          },
        ])
      )
    ).toBe("answered")
  })

  it("counts a browser-side failure as answered, so the model can react", () => {
    expect(
      checkFitState(
        message([
          {
            type: "tool-check_fit",
            toolCallId: "c1",
            state: "output-error",
            input: { patches: [] },
            errorText: "Patches could not be applied",
          },
        ])
      )
    ).toBe("answered")
  })

  it("refuses output that is not a fit result", () => {
    expect(
      checkFitState(
        message([
          {
            type: "tool-check_fit",
            toolCallId: "c1",
            state: "output-available",
            input: { patches: [] },
            output: { pages: "two" },
          },
        ])
      )
    ).toBe("awaiting")
  })

  /**
   * The regression: a continued turn keeps the call it already answered, so
   * reading the first answer closed a run the browser was still measuring
   * for. `condense_to_pages` checks again whenever its first cut misses.
   */
  it("is awaiting when a fresh call follows an answered one", () => {
    expect(
      checkFitState(
        message([
          {
            type: "tool-check_fit",
            toolCallId: "c1",
            state: "output-available",
            input: { patches: [] },
            output: { pageCount: 3, pageSize: "LETTER" },
          },
          { type: "text", text: "Still over. Cutting further." },
          {
            type: "tool-check_fit",
            toolCallId: "c2",
            state: "input-available",
            input: { patches: [] },
          },
        ])
      )
    ).toBe("awaiting")
  })

  it("is answered once the newest of several calls comes back", () => {
    expect(
      checkFitState(
        message([
          {
            type: "tool-check_fit",
            toolCallId: "c1",
            state: "output-available",
            input: { patches: [] },
            output: { pageCount: 3, pageSize: "LETTER" },
          },
          {
            type: "tool-check_fit",
            toolCallId: "c2",
            state: "output-available",
            input: { patches: [] },
            output: { pageCount: 1, pageSize: "LETTER" },
          },
        ])
      )
    ).toBe("answered")
  })

  it("is none for a message that never called it", () => {
    expect(
      checkFitState(message([{ type: "text", text: "Tightened two bullets." }]))
    ).toBe("none")
  })
})

/**
 * What the browser actually receives. The store rule is tested in
 * `messages.test.ts`; this is the wire, and the two have to agree or a reload
 * shows something the stream never did.
 */
describe("startTurn", () => {
  const { resume, bullet } = fixture()
  const good = rewrite(bullet, `${bullet.text} Shipped on time.`)

  function turn(model: MockLanguageModelV3): Response {
    return startTurn({
      state: {
        loadedSkillIds: [],
        selectedNodeId: bullet.id,
        allowStructural: false,
      },
      resume,
      models: testModels(model),
      runId: "run-1",
      persist: async () => [],
      recordPlan: async () => undefined,
      addSkill: async () => undefined,
      memory: {
        summaryText: null,
        messages: [{ role: "user", content: "Tighten this" }],
      },
      originalMessages: [],
      metadata: { hintSkillId: "bullet_rewrite" },
      onSettled: async () => undefined,
    })
  }

  async function chunkTypes(response: Response): Promise<string[]> {
    const body = await response.text()
    return body
      .split("\n\n")
      .map((line) => line.replace(/^data: /, ""))
      .filter((line) => line.length > 0 && line !== "[DONE]")
      .map((line) => (JSON.parse(line) as { type: string }).type)
  }

  it("never streams the notes of a step that called a tool", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        textThenToolStream(
          "Let me think about which bullet to change.",
          "propose_patches",
          { patches: [good], summary: "Tightened the selected bullet." }
        ),
      ],
    })
    const types = await chunkTypes(turn(model))
    expect(types).not.toContain("text-delta")
    expect(types).toContain("tool-input-available")
  })

  it("still streams a turn that never proposed", async () => {
    const model = new MockLanguageModelV3({
      doStream: [textStream("Which bullet do you mean?")],
    })
    const types = await chunkTypes(turn(model))
    expect(types).toContain("text-delta")
  })
})
