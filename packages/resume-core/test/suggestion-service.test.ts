import type { ResumePatch } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { firstBullet, harness, only, rewriteBullet } from "./harness"

async function seeded(skillId = "bullet_rewrite") {
  const h = harness()
  const { id: resumeId } = await h.resumeService.create({ title: "CV" })
  const { id: conversationId } = await h.conversations.getOrCreate(resumeId)
  const run = await h.runService.start({
    conversationId,
    resumeId,
    skillId,
    model: "test-model",
    input: {},
  })
  const record = await h.resumeService.get(resumeId)
  return { ...h, resumeId, run, bullet: firstBullet(record.data) }
}

describe("SuggestionService.decide", () => {
  it("applies an accepted patch and writes an agent version", async () => {
    const h = await seeded()
    const suggestion = only(
      await h.suggestionService.persistProposal(h.run.id, [
        rewriteBullet(h.bullet, "Shipped the thing, and it mattered."),
      ])
    )

    const result = await h.suggestionService.decide({
      runId: h.run.id,
      decisions: [{ suggestionId: suggestion.id, status: "accepted" }],
    })

    expect(result.results).toEqual([
      { suggestionId: suggestion.id, status: "accepted" },
    ])
    expect(result.version?.createdBy).toBe("agent")
    expect(result.version?.label).toBe("AI suggestions accepted")
    expect(firstBullet(result.head).text).toBe(
      "Shipped the thing, and it mattered."
    )

    // The client swaps this token into its store; a stale one would turn the
    // next keystroke into a phantom conflict.
    const record = await h.resumeService.get(h.resumeId)
    expect(result.revision).toBe(record.revision)
    expect(firstBullet(record.data).text).toBe(
      "Shipped the thing, and it mattered."
    )
  })

  it("marks a patch stale when the user edited the target since", async () => {
    const h = await seeded()
    const suggestion = only(
      await h.suggestionService.persistProposal(h.run.id, [
        rewriteBullet(h.bullet, "Rewritten by the assistant."),
      ])
    )

    // The user keeps typing while the card is on screen.
    const record = await h.resumeService.get(h.resumeId)
    await h.resumeService.update({
      id: h.resumeId,
      data: {
        ...record.data,
        sections: record.data.sections.map((section) => ({
          ...section,
          items: section.items.map((item) =>
            "bullets" in item
              ? {
                  ...item,
                  bullets: item.bullets.map((b) =>
                    b.id === h.bullet.id ? { ...b, text: "Typed by hand." } : b
                  ),
                }
              : item
          ),
        })),
      },
      expectedRevision: record.revision,
    })

    const result = await h.suggestionService.decide({
      runId: h.run.id,
      decisions: [{ suggestionId: suggestion.id, status: "accepted" }],
    })

    expect(result.results[0]?.status).toBe("stale")
    expect(result.version).toBeUndefined()
    // The user's own text survives; the assistant does not overwrite it.
    expect(firstBullet(result.head).text).toBe("Typed by hand.")
  })

  it("creates no version when everything is rejected", async () => {
    const h = await seeded()
    const suggestion = only(
      await h.suggestionService.persistProposal(h.run.id, [
        rewriteBullet(h.bullet, "Never applied."),
      ])
    )

    const result = await h.suggestionService.decide({
      runId: h.run.id,
      decisions: [{ suggestionId: suggestion.id, status: "rejected" }],
    })

    expect(result.results[0]?.status).toBe("rejected")
    expect(result.version).toBeUndefined()
    // Only the "Before AI run" snapshot that starting the run wrote.
    expect(await h.versionService.list(h.resumeId)).toHaveLength(1)
    expect(firstBullet(result.head).text).toBe(h.bullet.text)
  })

  it("re-applies the skill's op whitelist on the server", async () => {
    // `bullet_rewrite` may only replace text. A delete reaching accept time,
    // however it got persisted, must not land.
    const h = await seeded("bullet_rewrite")
    const deletion: ResumePatch = {
      op: "delete",
      targetNodeId: h.bullet.id,
      before: { id: h.bullet.id, text: h.bullet.text },
      reason: "Not needed.",
      skillId: "bullet_rewrite",
    }
    const suggestion = only(
      await h.suggestionService.persistProposal(h.run.id, [deletion])
    )

    const result = await h.suggestionService.decide({
      runId: h.run.id,
      decisions: [{ suggestionId: suggestion.id, status: "accepted" }],
    })

    expect(result.results[0]?.status).toBe("stale")
    expect(result.version).toBeUndefined()
  })

  it("keeps the grounded numbers a suggestion was proposed with", async () => {
    // The number came from a job description that is not retained past the
    // run. Re-deriving grounding text from the resume alone would reject it.
    const h = await seeded()
    const suggestion = only(
      await h.suggestionService.persistProposal(h.run.id, [
        rewriteBullet(h.bullet, "Cut render time by 40% across the fleet."),
      ])
    )

    const result = await h.suggestionService.decide({
      runId: h.run.id,
      decisions: [{ suggestionId: suggestion.id, status: "accepted" }],
    })

    expect(result.results[0]?.status).toBe("accepted")
    expect(firstBullet(result.head).text).toContain("40%")
  })

  it("applies several accepted patches in ordinal order", async () => {
    const h = await seeded()
    const record = await h.resumeService.get(h.resumeId)
    const suggestions = await h.suggestionService.persistProposal(h.run.id, [
      rewriteBullet(h.bullet, "First rewrite."),
      {
        op: "replace_text",
        targetNodeId: "basics",
        field: "headline",
        before: record.data.basics.headline ?? "",
        after: "Staff engineer",
        reason: "Sharper.",
        skillId: "bullet_rewrite",
      },
    ])

    const result = await h.suggestionService.decide({
      runId: h.run.id,
      decisions: suggestions.map((s) => ({
        suggestionId: s.id,
        status: "accepted" as const,
      })),
    })

    expect(result.results.every((r) => r.status === "accepted")).toBe(true)
    expect(result.head.basics.headline).toBe("Staff engineer")
    expect(firstBullet(result.head).text).toBe("First rewrite.")
    // The system snapshot from starting the run, then the agent version.
    expect(await h.versionService.list(h.resumeId)).toHaveLength(2)
  })

  it("refuses an unknown or already-decided suggestion", async () => {
    const h = await seeded()
    const suggestion = only(
      await h.suggestionService.persistProposal(h.run.id, [
        rewriteBullet(h.bullet, "Once."),
      ])
    )

    await expect(
      h.suggestionService.decide({
        runId: h.run.id,
        decisions: [{ suggestionId: "nope", status: "accepted" }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await h.suggestionService.decide({
      runId: h.run.id,
      decisions: [{ suggestionId: suggestion.id, status: "rejected" }],
    })

    await expect(
      h.suggestionService.decide({
        runId: h.run.id,
        decisions: [{ suggestionId: suggestion.id, status: "accepted" }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })
})

describe("SuggestionService.persistProposal", () => {
  it("stores each distinct patch once per run, keeping ordinals stable", async () => {
    // The model may call propose_patches again after rejections. Only the
    // patches it did not already submit are new rows.
    const h = await seeded()
    const record = await h.resumeService.get(h.resumeId)
    const first = rewriteBullet(h.bullet, "First rewrite.")
    const second: ResumePatch = {
      op: "replace_text",
      targetNodeId: "basics",
      field: "headline",
      before: record.data.basics.headline ?? "",
      after: "Staff engineer",
      reason: "Sharper.",
      skillId: "bullet_rewrite",
    }

    const initial = await h.suggestionService.persistProposal(h.run.id, [first])
    const again = await h.suggestionService.persistProposal(h.run.id, [
      { ...first, reason: "Same change, reworded reason." },
      second,
    ])

    expect(initial.map((s) => s.ordinal)).toEqual([0])
    expect(again.map((s) => s.ordinal)).toEqual([0, 1])
    expect(again[0]?.id).toBe(initial[0]?.id)
    expect(await h.suggestions.listForRun(h.run.id)).toHaveLength(2)
  })
})
