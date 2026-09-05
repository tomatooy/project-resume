import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { checkFitState } from "../src/turn"

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

  it("is none for a message that never called it", () => {
    expect(
      checkFitState(message([{ type: "text", text: "Tightened two bullets." }]))
    ).toBe("none")
  })
})
