import { defaultTemplateOptions, type Resume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { ApiError, type ResumeRecord } from "@/lib/types"
import { fakeClock } from "./fake-clock"
import { ResumeSession, type SessionApi } from "./store"

/**
 * Everything here goes through the session's interface: patches in, state and
 * writes out. The api and the clock are the two seams the session takes as
 * dependencies, so a test can watch a write and decide what it answers.
 */

const BUL_ID = "bul_aaaaaaaaaa"

function doc(): Resume {
  return {
    schemaVersion: 1,
    basics: {
      id: "basics",
      name: "Jo Rivera",
      email: "jo@example.com",
      links: [],
    },
    sections: [
      {
        id: "sec_aaaaaaaaaa",
        type: "experience",
        title: "Experience",
        items: [
          {
            id: "exp_aaaaaaaaaa",
            kind: "experience",
            company: "Acme",
            role: "Engineer",
            start: "2020-01",
            end: "present",
            bullets: [{ id: BUL_ID, text: "Shipped 3 things" }],
          },
        ],
      },
    ],
  }
}

function record(): ResumeRecord {
  return {
    id: "res_1",
    title: "Test",
    subtitle: "",
    templateId: "lisbon",
    updatedAt: "2026-01-01T00:00:00.000Z",
    data: doc(),
    schemaVersion: 1,
    templateOptions: defaultTemplateOptions,
    currentVersionId: null,
    revision: 1,
  }
}

type Write = Parameters<SessionApi["updateResume"]>[0]

/** An api whose every write is answered by the test. */
function fakeApi() {
  const writes: Write[] = []
  const settle: {
    resolve: (value: { revision: number; updatedAt: string }) => void
    reject: (error: unknown) => void
  }[] = []
  let revision = 1

  const api: SessionApi = {
    updateResume: (input) => {
      writes.push(input)
      return new Promise((resolve, reject) => settle.push({ resolve, reject }))
    },
    setTemplate: async () => ({ ok: true }),
  }

  const drain = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  return {
    api,
    writes,
    get open(): number {
      return settle.length
    },
    async accept(): Promise<void> {
      const next = settle.shift()
      if (!next) throw new Error("no write in flight")
      revision += 1
      next.resolve({
        revision,
        updatedAt: `2026-01-01T00:00:0${revision}.000Z`,
      })
      await drain()
    },
    async refuse(error: unknown): Promise<void> {
      const next = settle.shift()
      if (!next) throw new Error("no write in flight")
      next.reject(error)
      await drain()
    },
  }
}

function setup() {
  const clock = fakeClock()
  const api = fakeApi()
  const session = new ResumeSession(record(), "con_1", {
    api: api.api,
    clock: clock.clock,
  })
  session.activate()
  return { session, clock, api }
}

function bullet(session: ResumeSession): string {
  const item = session.state.doc.sections[0]?.items[0]
  if (item?.kind !== "experience") throw new Error("lost the item")
  return item.bullets[0]?.text ?? ""
}

function type(session: ResumeSession, from: string, to: string) {
  return session.apply(
    [
      {
        op: "replace_text",
        targetNodeId: BUL_ID,
        field: "text",
        before: from,
        after: to,
        reason: "Manual edit",
        skillId: "manual",
      },
    ],
    { coalesceKey: `${BUL_ID}.text` }
  )
}

describe("applying patches", () => {
  it("moves the document and marks it dirty", () => {
    const { session } = setup()
    const result = type(session, "Shipped 3 things", "Shipped 4 things")
    expect(result.failed).toBe(0)
    expect(bullet(session)).toBe("Shipped 4 things")
    expect(session.state.saveStatus).toBe("dirty")
    expect(session.canUndo).toBe(true)
  })

  it("reports a patch whose guard no longer matches and leaves the document alone", () => {
    const { session } = setup()
    const result = type(session, "not the text", "Shipped 4 things")
    expect(result.failed).toBe(1)
    expect(bullet(session)).toBe("Shipped 3 things")
    expect(session.state.saveStatus).toBe("saved")
    expect(session.canUndo).toBe(false)
  })

  it("keeps validity in step with the document", () => {
    const { session } = setup()
    session.apply([
      {
        op: "update_fields",
        targetNodeId: "basics",
        before: { name: "Jo Rivera" },
        after: { name: "" },
        reason: "Manual edit",
        skillId: "manual",
      },
    ])
    expect(session.state.doc.basics.name).toBe("")
    expect(session.state.validity.savable).toBe(false)
  })
})

describe("undo and redo", () => {
  it("undoes one gesture and redoes it", () => {
    const { session } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    expect(session.undo()).toBe(true)
    expect(bullet(session)).toBe("Shipped 3 things")
    expect(session.canRedo).toBe(true)
    expect(session.redo()).toBe(true)
    expect(bullet(session)).toBe("Shipped 4 things")
  })

  it("undoes a run of keystrokes on one field as a single edit", () => {
    const { session } = setup()
    type(session, "Shipped 3 things", "Shipped 3 things.")
    type(session, "Shipped 3 things.", "Shipped 3 things. ")
    type(session, "Shipped 3 things. ", "Shipped 3 things. Twice")
    expect(session.undo()).toBe(true)
    expect(bullet(session)).toBe("Shipped 3 things")
    expect(session.canUndo).toBe(false)
  })

  it("starts a new entry when typing moves to another field", () => {
    const { session } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    session.apply(
      [
        {
          op: "update_fields",
          targetNodeId: "basics",
          before: { name: "Jo Rivera" },
          after: { name: "Jo R" },
          reason: "Manual edit",
          skillId: "manual",
        },
      ],
      { coalesceKey: "basics.name" }
    )
    session.undo()
    expect(session.state.doc.basics.name).toBe("Jo Rivera")
    expect(bullet(session)).toBe("Shipped 4 things")
    session.undo()
    expect(bullet(session)).toBe("Shipped 3 things")
  })

  it("drops the redo stack on a fresh edit", () => {
    const { session } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    session.undo()
    type(session, "Shipped 3 things", "Shipped 5 things")
    expect(session.canRedo).toBe(false)
  })

  it("treats a whole-document replace as one undoable edit", () => {
    const { session } = setup()
    const next = doc()
    next.sections.push({
      id: "sec_bbbbbbbbbb",
      type: "custom",
      title: "Volunteering",
      items: [],
    })
    session.replaceDocument(next)
    expect(session.state.doc.sections).toHaveLength(2)
    expect(session.state.saveStatus).toBe("dirty")
    session.undo()
    expect(session.state.doc.sections).toHaveLength(1)
    session.redo()
    expect(session.state.doc.sections).toHaveLength(2)
  })

  it("forgets history when the head is replaced from the server", () => {
    const { session } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    session.replaceHead(doc(), 7, "2026-02-01T00:00:00.000Z")
    expect(session.canUndo).toBe(false)
    expect(session.state.revision).toBe(7)
    expect(session.state.saveStatus).toBe("saved")
  })
})

describe("autosave", () => {
  it("writes the document with the current revision after the debounce", async () => {
    const { session, clock, api } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    expect(api.writes).toHaveLength(0)
    clock.tick()
    expect(api.writes).toHaveLength(1)
    expect(api.writes[0]).toMatchObject({ id: "res_1", expectedRevision: 1 })
    expect(session.state.saveStatus).toBe("saving")
    await api.accept()
    expect(session.state.saveStatus).toBe("saved")
    expect(session.state.revision).toBe(2)
    expect(session.state.savedDoc).toBe(session.state.doc)
  })

  it("stays dirty when the document moved during the write", async () => {
    const { session, clock, api } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    clock.tick()
    type(session, "Shipped 4 things", "Shipped 5 things")
    await api.accept()
    expect(session.state.saveStatus).toBe("dirty")
    expect(session.state.revision).toBe(2)
  })

  it("does not write a document that fails its schema", () => {
    const { session, clock, api } = setup()
    session.apply([
      {
        op: "update_fields",
        targetNodeId: "basics",
        before: { name: "Jo Rivera" },
        after: { name: "" },
        reason: "Manual edit",
        skillId: "manual",
      },
    ])
    clock.tick()
    expect(api.writes).toHaveLength(0)
    expect(session.state.saveStatus).toBe("dirty")
  })

  it("backs off and keeps the edits after a network error", async () => {
    const { session, clock, api } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    clock.tick()
    await api.refuse(new ApiError("INTERNAL", "boom", 500))
    expect(session.state.saveStatus).toBe("error")
    expect(bullet(session)).toBe("Shipped 4 things")
    expect(clock.armed).toBe(true)
    clock.tick()
    expect(api.writes).toHaveLength(2)
  })

  it("flushes on demand instead of waiting out the debounce", async () => {
    const { session, api } = setup()
    type(session, "Shipped 3 things", "Shipped 4 things")
    const flushed = session.flush()
    await Promise.resolve()
    expect(api.open).toBe(1)
    await api.accept()
    await flushed
    expect(session.state.saveStatus).toBe("saved")
  })
})

describe("conflict", () => {
  async function conflicted() {
    const s = setup()
    type(s.session, "Shipped 3 things", "Shipped 4 things")
    s.clock.tick()
    await s.api.refuse(new ApiError("CONFLICT", "moved", 409))
    return s
  }

  it("stops saving and waits for the user", async () => {
    const { session, clock } = await conflicted()
    expect(session.state.saveStatus).toBe("conflict")
    expect(clock.armed).toBe(false)
  })

  it("overwrites the server copy on request, without a revision guard", async () => {
    const { session, api } = await conflicted()
    const done = session.overwrite()
    expect(api.writes[1]?.expectedRevision).toBeUndefined()
    await api.accept()
    await done
    expect(session.state.saveStatus).toBe("saved")
    expect(session.state.revision).toBe(2)
  })

  it("discards local edits on request", async () => {
    const { session } = await conflicted()
    const theirs = record()
    theirs.revision = 5
    session.discardLocal(theirs)
    expect(bullet(session)).toBe("Shipped 3 things")
    expect(session.state.revision).toBe(5)
    expect(session.state.saveStatus).toBe("saved")
    expect(session.canUndo).toBe(false)
  })
})
