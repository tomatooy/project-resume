import { type NoteMergeProposal, NOTES_LIMIT } from "@workspace/autofill"
import { describe, expect, it, vi } from "vitest"

import type { NotesOutcome } from "../src/domain/autofill"
import { harness } from "./harness"

const before = "## Logistics\n- Lives in SF."
const UNKNOWN = "00000000-0000-4000-8000-000000000999"

/** The service over Notes that hold `content` at revision 1 (none when empty). */
async function withNotes(content = before) {
  const h = harness()
  const notes = h.autofillNotesService
  if (content !== "") {
    await notes.save({ content, expectedRevision: 0, snapshot: false })
  }
  return { h, notes }
}

/** A model that adds one fact under Logistics. */
function adding(text: string, hints: NoteMergeProposal["hints"] = []) {
  return async (): Promise<NoteMergeProposal> => ({
    ops: [{ op: "add", heading: "Logistics", text }],
    hints,
  })
}

/** Narrows to a saved outcome so a test can reach its Undo handle. */
function saved(outcome: NotesOutcome) {
  if (outcome.kind !== "saved") {
    throw new Error(`expected a saved merge, got ${outcome.kind}`)
  }
  return outcome
}

describe("AutofillNotesService.merge", () => {
  it("saves the merged text with a snapshot for Undo", async () => {
    const { notes } = await withNotes("## Work style\n- Likes pairing.")
    const outcome = saved(
      await notes.merge(async () => ({
        ops: [
          {
            op: "add",
            heading: "Work style",
            text: "Comfortable with on-call.",
          },
        ],
        hints: ["preferences.relocation"],
      }))
    )
    expect(outcome).toMatchObject({
      kind: "saved",
      added: 1,
      changed: 0,
      deleted: 0,
      revision: 2,
      diff: [
        { kind: "same", text: "## Work style" },
        { kind: "same", text: "- Likes pairing." },
        { kind: "add", text: "- Comfortable with on-call." },
      ],
      hints: ["preferences.relocation"],
    })
    expect(await notes.version(outcome.undoVersionId ?? UNKNOWN)).toMatchObject(
      { reason: "merge", content: "## Work style\n- Likes pairing." }
    )
    expect((await notes.get()).content).toBe(
      "## Work style\n- Likes pairing.\n- Comfortable with on-call."
    )
  })

  it("snapshots empty Notes before the first merge", async () => {
    const { notes } = await withNotes("")
    const outcome = saved(await notes.merge(adding("Lives in SF.")))
    expect(outcome).toMatchObject({ added: 1, revision: 1 })
    expect(await notes.version(outcome.undoVersionId ?? UNKNOWN)).toMatchObject(
      { reason: "merge", content: "" }
    )
    expect((await notes.get()).content).toBe(before)
  })

  it("reruns once when Notes change during the merge", async () => {
    const { notes } = await withNotes()
    const seen: string[] = []
    const outcome = await notes.merge(async (numbered) => {
      seen.push(numbered)
      if (seen.length === 1) {
        await notes.save({
          content: "## Logistics\n- Lives in Oakland.",
          expectedRevision: 1,
          snapshot: false,
        })
      }
      return {
        ops: [{ op: "add", heading: "Logistics", text: "Can travel monthly." }],
        hints: [],
      }
    })
    expect(seen).toEqual([
      "1| ## Logistics\n2| - Lives in SF.",
      "1| ## Logistics\n2| - Lives in Oakland.",
    ])
    expect(outcome).toMatchObject({ kind: "saved", added: 1, revision: 3 })
    expect((await notes.get()).content).toBe(
      "## Logistics\n- Lives in Oakland.\n- Can travel monthly."
    )
  })

  it("fails after a second conflict", async () => {
    const { notes } = await withNotes()
    let calls = 0
    const outcome = await notes.merge(async () => {
      calls += 1
      const { revision } = await notes.get()
      await notes.save({
        content: `## Logistics\n- Edit ${calls}.`,
        expectedRevision: revision,
        snapshot: false,
      })
      return {
        ops: [{ op: "add", heading: "Logistics", text: "Can travel monthly." }],
        hints: [],
      }
    })
    expect(outcome).toEqual({ kind: "failed" })
    expect(calls).toBe(2)
    expect((await notes.get()).content).toBe("## Logistics\n- Edit 2.")
  })

  it("reports failure when the proposal names a bad line", async () => {
    const { notes } = await withNotes()
    expect(
      await notes.merge(async () => ({
        ops: [{ op: "replace", line: 99, text: "Lives in Oakland." }],
        hints: [],
      }))
    ).toEqual({ kind: "failed" })
    expect(await notes.get()).toMatchObject({ content: before, revision: 1 })
    expect(await notes.versions()).toEqual([])
  })

  it("passes on a storage failure instead of retrying", async () => {
    const { h, notes } = await withNotes()
    const save = vi
      .spyOn(h.autofillNotes, "save")
      .mockRejectedValue(new Error("connection lost"))
    await expect(notes.merge(adding("Can travel monthly."))).rejects.toThrow(
      "connection lost"
    )
    expect(save).toHaveBeenCalledTimes(1)
  })

  it("reports failure when the model call throws", async () => {
    const { notes } = await withNotes()
    expect(
      await notes.merge(async () => {
        throw new Error("model unavailable")
      })
    ).toEqual({ kind: "failed" })
    expect(await notes.get()).toMatchObject({ content: before, revision: 1 })
  })

  it("reports full instead of saving past 10,000 characters", async () => {
    const content = `## Logistics\n- ${"x".repeat(9_975)}`
    expect(content).toHaveLength(9_990)
    const { notes } = await withNotes(content)
    expect(await notes.merge(adding("y".repeat(50)))).toEqual({
      kind: "full",
      hints: [],
    })
    expect(
      await notes.merge(adding("y".repeat(50), ["preferences.cities"]))
    ).toEqual({ kind: "full", hints: ["preferences.cities"] })
    expect(await notes.get()).toMatchObject({ content, revision: 1 })
  })

  it("saves a merge that reaches exactly 10,000 characters", async () => {
    const { notes } = await withNotes(`## Logistics\n- ${"x".repeat(9_932)}`)
    expect(await notes.merge(adding("y".repeat(50)))).toMatchObject({
      kind: "saved",
      added: 1,
    })
    expect((await notes.get()).content).toHaveLength(NOTES_LIMIT)
  })

  it("writes nothing when the merge changes nothing", async () => {
    const { h, notes } = await withNotes()
    const save = vi.spyOn(h.autofillNotes, "save")
    expect(await notes.merge(adding("Lives in SF.", ["links"]))).toEqual({
      kind: "saved",
      added: 0,
      changed: 0,
      deleted: 0,
      undoVersionId: null,
      revision: 1,
      diff: [
        { kind: "same", text: "## Logistics" },
        { kind: "same", text: "- Lives in SF." },
      ],
      hints: ["links"],
    })
    expect(save).not.toHaveBeenCalled()
    expect(await notes.versions()).toEqual([])
  })

  it("points Undo at the latest snapshot when it holds the same text", async () => {
    const { notes } = await withNotes()
    await notes.save({
      content: "## Logistics\n- Lives in Oakland.",
      expectedRevision: 1,
      snapshot: true,
    })
    await notes.save({ content: before, expectedRevision: 2, snapshot: false })
    const [edit] = await notes.versions()
    const outcome = saved(await notes.merge(adding("Can travel monthly.")))
    expect(outcome.undoVersionId).toBe(edit?.id)
    expect(await notes.versions()).toHaveLength(1)
  })
})

describe("AutofillNotesService.undo", () => {
  it("restores the text from before the merge", async () => {
    const { notes } = await withNotes()
    const outcome = saved(await notes.merge(adding("Can travel monthly.")))
    expect(
      await notes.undo({
        versionId: outcome.undoVersionId ?? UNKNOWN,
        revision: outcome.revision,
      })
    ).toEqual({ kind: "restored", revision: 3 })
    expect((await notes.get()).content).toBe(before)
    expect((await notes.versions()).map(({ reason }) => reason)).toEqual([
      "restore",
      "merge",
    ])
  })

  it("refuses Undo after Notes changed", async () => {
    const { notes } = await withNotes()
    const outcome = saved(await notes.merge(adding("Can travel monthly.")))
    await notes.save({
      content: "## Logistics\n- Lives in Oakland.",
      expectedRevision: outcome.revision,
      snapshot: false,
    })
    expect(
      await notes.undo({
        versionId: outcome.undoVersionId ?? UNKNOWN,
        revision: outcome.revision,
      })
    ).toEqual({ kind: "changed" })
    expect((await notes.get()).content).toBe(
      "## Logistics\n- Lives in Oakland."
    )
  })

  it("passes on an unknown version", async () => {
    const { notes } = await withNotes()
    await expect(
      notes.undo({ versionId: UNKNOWN, revision: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Version not found" })
  })
})

describe("AutofillNotesService manual edits and History", () => {
  it("rejects a manual save over 10,000 characters", async () => {
    const { notes } = await withNotes("")
    await expect(
      notes.save({
        content: "x".repeat(NOTES_LIMIT + 1),
        expectedRevision: 0,
        snapshot: false,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Notes are too long",
    })
    expect(
      await notes.save({
        content: "x".repeat(NOTES_LIMIT),
        expectedRevision: 0,
        snapshot: false,
      })
    ).toMatchObject({ revision: 1 })
  })

  it("saves with a revision check", async () => {
    const { notes } = await withNotes()
    await expect(
      notes.save({ content: "- Other.", expectedRevision: 0, snapshot: false })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Notes changed" })
    expect(await notes.get()).toMatchObject({ content: before, revision: 1 })
  })

  it("takes no snapshot when an edit save changes nothing", async () => {
    const { notes } = await withNotes()
    expect(
      await notes.save({ content: before, expectedRevision: 1, snapshot: true })
    ).toMatchObject({ revision: 1 })
    expect(await notes.versions()).toEqual([])
  })

  it("snapshots the previous text for an edit save", async () => {
    const { notes } = await withNotes()
    expect(
      await notes.save({
        content: "## Logistics\n- Lives in Oakland.",
        expectedRevision: 1,
        snapshot: true,
      })
    ).toEqual({ revision: 2, updatedAt: (await notes.get()).updatedAt })
    const [edit] = await notes.versions()
    expect(edit).toMatchObject({ reason: "edit", length: before.length })
    expect(await notes.version(edit?.id ?? UNKNOWN)).toMatchObject({
      id: edit?.id,
      reason: "edit",
      content: before,
    })
  })

  it("lists the newest 20 snapshots first", async () => {
    const { notes } = await withNotes("")
    for (let i = 1; i <= 25; i++) {
      await notes.save({
        content: `- Fact ${i}.`,
        expectedRevision: i - 1,
        snapshot: true,
      })
    }
    const versions = await notes.versions()
    const contents = await Promise.all(
      versions.map(async ({ id }) => (await notes.version(id)).content)
    )
    expect(contents).toEqual(
      Array.from({ length: 20 }, (_, i) => `- Fact ${24 - i}.`)
    )
  })

  it("restores a snapshot from History", async () => {
    const { notes } = await withNotes()
    await notes.save({
      content: "## Logistics\n- Lives in Oakland.",
      expectedRevision: 1,
      snapshot: true,
    })
    const [edit] = await notes.versions()
    const restored = await notes.restore({
      id: edit?.id ?? UNKNOWN,
      expectedRevision: 2,
    })
    expect(restored).toMatchObject({ content: before, revision: 3 })
    expect(restored).toEqual(await notes.get())
    expect((await notes.versions()).map(({ reason }) => reason)).toEqual([
      "restore",
      "edit",
    ])
    await expect(
      notes.restore({ id: edit?.id ?? UNKNOWN, expectedRevision: 2 })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Notes changed" })
  })

  it("names an unknown version", async () => {
    const { notes } = await withNotes()
    await expect(notes.version(UNKNOWN)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Version not found",
    })
    await expect(
      notes.restore({ id: UNKNOWN, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Version not found" })
  })
})
