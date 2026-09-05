import { describe, expect, it } from "vitest"

import type { ChatUIMessage } from "@/lib/types"
import { checkFitAnswered } from "./use-assistant"

type Part = ChatUIMessage["parts"][number]

function assistant(...parts: Part[]): ChatUIMessage {
  return { id: "m1", role: "assistant", parts }
}

const stepStart = { type: "step-start" } as Part

function fitCall(state: "input-available" | "output-available"): Part {
  const call = {
    type: "tool-check_fit",
    toolCallId: "c1",
    input: { patches: [] },
  }
  return (
    state === "output-available"
      ? { ...call, state, output: { pageCount: 2, pageSize: "Letter" } }
      : { ...call, state }
  ) as Part
}

function proposeResult(): Part {
  return {
    type: "tool-propose_patches",
    toolCallId: "c2",
    state: "output-available",
    input: { patches: [] },
    output: { runId: "r1", suggestions: [], rejected: [], gaps: [] },
  } as Part
}

describe("checkFitAnswered", () => {
  it("sends the turn back once the browser answered the fit check", () => {
    const messages = [stepStart, fitCall("output-available")]
    expect(checkFitAnswered({ messages: [assistant(...messages)] })).toBe(true)
  })

  it("waits while the fit check is still unanswered", () => {
    const messages = [stepStart, fitCall("input-available")]
    expect(checkFitAnswered({ messages: [assistant(...messages)] })).toBe(false)
  })

  // The regression this predicate exists for: `propose_patches` runs on the
  // server and ends the run, so a resubmission has no turn to continue.
  it("does not resend on the proposal that ends the run", () => {
    const message = assistant(stepStart, proposeResult())
    expect(checkFitAnswered({ messages: [message] })).toBe(false)
  })

  it("does not resend on a fit check answered in an earlier step", () => {
    const message = assistant(
      stepStart,
      fitCall("output-available"),
      stepStart,
      proposeResult()
    )
    expect(checkFitAnswered({ messages: [message] })).toBe(false)
  })

  it("ignores a transcript that ends with the user", () => {
    const message = { id: "m0", role: "user", parts: [] } as ChatUIMessage
    expect(checkFitAnswered({ messages: [message] })).toBe(false)
    expect(checkFitAnswered({ messages: [] })).toBe(false)
  })
})
