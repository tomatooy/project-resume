import { defaultTemplateOptions, type Resume } from "@workspace/resume-schema"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ResumeRecord } from "@/lib/types"

vi.mock("@/lib/api", () => ({
  updateResume: vi.fn(async () => ({
    revision: 2,
    updatedAt: new Date().toISOString(),
  })),
  setTemplate: vi.fn(async () => undefined),
}))

import { setFields, setText } from "./actions"
import { ResumeSession } from "./store"

/**
 * The editor writes each keystroke straight into the document, so these are the
 * states a field passes through on the way to a new value. If one of them is
 * refused, `doc` does not move, the controlled input re-renders with the old
 * text, and the character the user just typed or deleted reappears.
 */

const EXP_ID = "exp_aaaaaaaaaa"

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
            id: EXP_ID,
            kind: "experience",
            company: "Acme",
            role: "Engineer",
            start: "2020-01",
            end: "present",
            bullets: [{ id: "bul_aaaaaaaaaa", text: "Shipped 3 things" }],
          },
        ],
      },
    ],
  }
}

function session(): ResumeSession {
  const record: ResumeRecord = {
    id: "res_1",
    title: "Test",
    subtitle: "",
    templateId: "lisbon",
    updatedAt: new Date().toISOString(),
    data: doc(),
    schemaVersion: 1,
    templateOptions: defaultTemplateOptions,
    currentVersionId: null,
    revision: 1,
  }
  return new ResumeSession(record, "con_1")
}

function experience(s: ResumeSession) {
  const item = s.state.doc.sections[0]?.items[0]
  if (item?.kind !== "experience") throw new Error("lost the item")
  return item
}

describe("retyping a required field", () => {
  let s: ResumeSession
  beforeEach(() => {
    s = session()
  })

  it("lets the field be cleared", () => {
    setText(s, EXP_ID, "company", "")
    expect(experience(s).company).toBe("")
  })

  it("survives a full delete-then-retype, character by character", () => {
    for (const value of ["Acm", "Ac", "A", "", "G", "Gl", "Glo", "Globex"]) {
      setText(s, EXP_ID, "company", value)
      expect(experience(s).company).toBe(value)
    }
  })
})

describe("retyping a formatted field", () => {
  it("accepts every prefix of an email address", () => {
    const s = session()
    for (const value of ["", "n", "ne", "new@", "new@co", "new@co.uk"]) {
      setFields(s, "basics", { email: value || undefined })
      expect(s.state.doc.basics.email ?? "").toBe(value)
    }
  })

  it("lets a month be cleared before a new one is picked", () => {
    const s = session()
    setFields(s, EXP_ID, { start: "" })
    expect(experience(s).start).toBe("")
    setFields(s, EXP_ID, { start: "2021-06" })
    expect(experience(s).start).toBe("2021-06")
  })
})

describe("an optional field that is not set yet", () => {
  it("accepts the first character typed into it", () => {
    const s = session()
    expect(experience(s).location).toBeUndefined()

    setText(s, EXP_ID, "location", "B")

    expect(experience(s).location).toBe("B")
  })

  it("accepts a whole word typed into it", () => {
    const s = session()
    for (const value of ["B", "Be", "Ber", "Berlin"]) {
      setText(s, EXP_ID, "location", value)
      expect(experience(s).location).toBe(value)
    }
  })

  it("accepts text typed into an unset summary", () => {
    const s = session()
    setText(s, "basics", "summary", "H")
    expect(s.state.doc.basics.summary).toBe("H")
  })
})

describe("undo after an edit that passed through an invalid state", () => {
  it("puts the original value back", () => {
    const s = session()
    for (const value of ["Acm", "", "Globex"]) {
      setText(s, EXP_ID, "company", value)
    }
    expect(experience(s).company).toBe("Globex")

    s.undo()

    expect(experience(s).company).toBe("Acme")
  })
})

/**
 * `validity` moves with `doc`, not with the autosave debounce, so the save bar
 * can say "Fix errors to save" the moment a field breaks. It used to be
 * derived inside `save`, which meant the document was unsavable for the length
 * of the debounce before anything said so.
 */
describe("document validity", () => {
  it("goes unsavable on the keystroke that breaks a field", () => {
    const s = session()
    expect(s.state.validity.savable).toBe(true)

    setText(s, EXP_ID, "company", "")

    expect(s.state.validity.savable).toBe(false)
    expect(s.state.validity.byNode[EXP_ID]?.company).toBeTruthy()
  })

  it("clears the error on the keystroke that fixes it", () => {
    const s = session()
    setText(s, EXP_ID, "company", "")
    setText(s, EXP_ID, "company", "G")

    expect(s.state.validity.savable).toBe(true)
    expect(s.state.validity.byNode).toEqual({})
  })
})
