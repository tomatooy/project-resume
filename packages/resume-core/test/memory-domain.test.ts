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

  it("fills the playbook limit on a row stored before the limit existed", () => {
    // The transcript read path drops a part it cannot parse, so a stored
    // `load_skill` row written before `overCap` existed has to keep parsing.
    // A required key here would silently erase the chips of every old turn.
    const parsed = MessagePartSchema.safeParse({
      type: "tool-load_skill",
      toolCallId: "call_2",
      state: "output-available",
      output: {
        loaded: [],
        unknown: [],
        alreadyLoaded: ["bullet_rewrite"],
        validIds: ["bullet_rewrite"],
      },
    })

    expect(parsed.success).toBe(true)
    expect(
      parsed.success && parsed.data.type === "tool-load_skill"
        ? parsed.data.output?.overCap
        : undefined
    ).toEqual([])
  })

  it("rejects parts the app does not know how to render", () => {
    expect(
      MessagePartSchema.safeParse({ type: "reasoning", text: "..." }).success
    ).toBe(false)
  })
})
