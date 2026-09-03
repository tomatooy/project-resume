import { describe, expect, it } from "vitest"

import { MessagePartSchema } from "../src/domain/chat"
import { renderSummaryText } from "../src/domain/memory"

describe("renderSummaryText", () => {
  it("renders each populated field as a labelled line", () => {
    const text = renderSummaryText({
      user_goal: "Move into product management",
      resume_focus: ["roadmaps", "stakeholders"],
      preferences: ["no jargon"],
      decisions: ["dropped the internship"],
      open_tasks: ["quantify the launch bullet"],
    })

    expect(text.split("\n")).toEqual([
      "Goal: Move into product management",
      "Focus: roadmaps; stakeholders",
      "Preferences: no jargon",
      "Decisions: dropped the internship",
      "Open tasks: quantify the launch bullet",
    ])
  })

  it("omits empty fields rather than printing blank labels", () => {
    const text = renderSummaryText({
      resume_focus: [],
      preferences: [],
      decisions: ["kept the summary as is"],
      open_tasks: [],
    })

    expect(text).toBe("Decisions: kept the summary as is")
  })
})

describe("MessagePartSchema", () => {
  it("accepts the parts the app stores", () => {
    expect(
      MessagePartSchema.safeParse({ type: "text", text: "hello" }).success
    ).toBe(true)
    expect(
      MessagePartSchema.safeParse({
        type: "tool-check_fit",
        toolCallId: "call_1",
        state: "output-available",
        output: { pageCount: 2, pageSize: "LETTER" },
      }).success
    ).toBe(true)
  })

  it("rejects parts the app does not know how to render", () => {
    expect(
      MessagePartSchema.safeParse({ type: "reasoning", text: "..." }).success
    ).toBe(false)
  })
})
