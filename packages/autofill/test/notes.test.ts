import { describe, expect, it } from "vitest"

import { ProfileSectionSchema } from "../src/keys"
import {
  applyNoteOps,
  diffLines,
  NoteMergeProposalSchema,
  NoteOpSchema,
  NOTE_VERSIONS_KEPT,
  NOTES_LIMIT,
  NOTES_WARN,
  numberLines,
  PROFILE_FIELDS,
  ProfileFieldKeySchema,
  plainQuestions,
} from "../src/notes"
import { field } from "./helpers"

const notes =
  "## Work style\n- Likes pairing.\n\n## Logistics\n- Lives in SF.  "

describe("limits", () => {
  it("keeps 10,000 characters, warns from 9,000 and keeps 20 versions", () => {
    expect([NOTES_LIMIT, NOTES_WARN, NOTE_VERSIONS_KEPT]).toEqual([
      10_000, 9_000, 20,
    ])
  })
})

describe("numberLines", () => {
  it("numbers lines for the model", () =>
    expect(numberLines("## Work\n- a")).toBe("1| ## Work\n2| - a"))

  it("numbers no lines in empty Notes", () => {
    expect(numberLines("")).toBe("")
  })
})

describe("applyNoteOps", () => {
  it("appends under an existing heading and keeps other lines byte-identical", () => {
    const result = applyNoteOps(notes, [
      { op: "add", heading: "work style", text: "Comfortable with on-call." },
    ])
    expect(result).toEqual({
      ok: true,
      added: 1,
      changed: 0,
      deleted: 0,
      content:
        "## Work style\n- Likes pairing.\n- Comfortable with on-call.\n\n## Logistics\n- Lives in SF.  ",
    })
  })

  it("creates a missing heading at the end", () => {
    const result = applyNoteOps(notes, [
      {
        op: "add",
        heading: "Companies",
        text: "- Has not applied to Stripe before.",
      },
    ])
    expect(result).toEqual({
      ok: true,
      added: 1,
      changed: 0,
      deleted: 0,
      content: `${notes}\n\n## Companies\n- Has not applied to Stripe before.`,
    })
  })

  it("creates a new heading once for several facts", () => {
    const result = applyNoteOps("## Work style\n- Likes pairing.\n", [
      { op: "add", heading: "Companies", text: "Has not applied to Stripe." },
      { op: "add", heading: "companies", text: "Knows the Airbnb team." },
      { op: "add", heading: "Logistics", text: "Lives in SF." },
    ])
    expect(result).toMatchObject({
      ok: true,
      added: 3,
      content:
        "## Work style\n- Likes pairing.\n\n## Companies\n- Has not applied to Stripe.\n- Knows the Airbnb team.\n\n## Logistics\n- Lives in SF.",
    })
  })

  it("starts empty Notes with the heading", () => {
    expect(
      applyNoteOps("", [
        { op: "add", heading: "Logistics", text: "Lives in SF." },
      ])
    ).toMatchObject({ ok: true, content: "## Logistics\n- Lives in SF." })
  })

  it("adds right under a heading that has no facts yet", () => {
    const result = applyNoteOps("## Companies\nFree text.\n## Logistics", [
      { op: "add", heading: "Companies", text: "Knows the Airbnb team." },
    ])
    expect(result).toMatchObject({
      content:
        "## Companies\n- Knows the Airbnb team.\nFree text.\n## Logistics",
    })
  })

  it("matches a heading the model wrote with its marks", () => {
    const result = applyNoteOps(notes, [
      { op: "add", heading: "## Work style", text: "Pairs daily." },
    ])
    expect(result).toMatchObject({
      content:
        "## Work style\n- Likes pairing.\n- Pairs daily.\n\n## Logistics\n- Lives in SF.  ",
    })
  })

  it("keeps an added fact on one line", () => {
    const result = applyNoteOps("## Logistics\n- Lives in SF.", [
      {
        op: "add",
        heading: "Logistics",
        text: "Can travel monthly.\n## Injected\n- Fake.",
      },
    ])
    expect(result).toMatchObject({
      content:
        "## Logistics\n- Lives in SF.\n- Can travel monthly. ## Injected - Fake.",
    })
  })

  it("skips a fact the Notes already hold", () => {
    expect(
      applyNoteOps(notes, [
        { op: "add", heading: "Logistics", text: "Lives in SF." },
      ])
    ).toEqual({ ok: true, content: notes, added: 0, changed: 0, deleted: 0 })
  })

  it("moves a fact by deleting and adding it", () => {
    expect(
      applyNoteOps(notes, [
        { op: "delete", line: 5 },
        { op: "add", heading: "Work style", text: "Lives in SF." },
      ])
    ).toEqual({
      ok: true,
      content:
        "## Work style\n- Likes pairing.\n- Lives in SF.\n\n## Logistics",
      added: 1,
      changed: 0,
      deleted: 1,
    })
  })

  it("replaces and deletes only fact lines", () => {
    expect(
      applyNoteOps(notes, [
        { op: "replace", line: 2, text: "Prefers pairing on hard problems." },
      ])
    ).toEqual({
      ok: true,
      content:
        "## Work style\n- Prefers pairing on hard problems.\n\n## Logistics\n- Lives in SF.  ",
      added: 0,
      changed: 1,
      deleted: 0,
    })
    expect(
      applyNoteOps(notes, [{ op: "replace", line: 1, text: "Work" }])
    ).toEqual({ ok: false, reason: "line" })
    expect(applyNoteOps(notes, [{ op: "delete", line: 3 }])).toEqual({
      ok: false,
      reason: "line",
    })
    expect(applyNoteOps(notes, [{ op: "delete", line: 99 }])).toEqual({
      ok: false,
      reason: "line",
    })
  })

  it("names lines by the original text", () => {
    const before = "## Logistics\n- Lives in SF.\n- Has a car.\n- Can travel."
    expect(
      applyNoteOps(before, [
        { op: "delete", line: 2 },
        { op: "replace", line: 3, text: "- Has no car." },
        { op: "delete", line: 4 },
      ])
    ).toEqual({
      ok: true,
      content: "## Logistics\n- Has no car.",
      added: 0,
      changed: 1,
      deleted: 2,
    })
  })

  it("does not count a replacement that changes nothing", () => {
    expect(
      applyNoteOps(notes, [{ op: "replace", line: 2, text: "Likes pairing." }])
    ).toEqual({ ok: true, content: notes, added: 0, changed: 0, deleted: 0 })
  })

  it("rejects a line named twice", () => {
    expect(
      applyNoteOps(notes, [
        { op: "replace", line: 2, text: "Pairs daily." },
        { op: "delete", line: 2 },
      ])
    ).toEqual({ ok: false, reason: "duplicate" })
  })
})

describe("NoteMergeProposalSchema", () => {
  it("accepts line operations and Profile hints", () => {
    const proposal = {
      ops: [
        { op: "add", heading: "Work style", text: "Pairs daily." },
        { op: "replace", line: 2, text: "Lives in Oakland." },
        { op: "delete", line: 3 },
      ],
      hints: ["preferences.relocation"],
    }
    expect(NoteMergeProposalSchema.parse(proposal)).toEqual(proposal)
  })

  it.each([
    ["an empty heading", { op: "add", heading: " ", text: "Pairs daily." }],
    ["a heading of marks only", { op: "add", heading: "##", text: "Pairs." }],
    ["a long heading", { op: "add", heading: "h".repeat(81), text: "Pairs." }],
    ["a long fact", { op: "replace", line: 2, text: "f".repeat(501) }],
    ["a blank fact", { op: "add", heading: "Work style", text: "  " }],
    ["line 0", { op: "delete", line: 0 }],
    ["a fractional line", { op: "delete", line: 1.5 }],
    ["an unknown op", { op: "move", line: 2 }],
  ])("rejects %s", (_, op) => {
    expect(NoteOpSchema.safeParse(op).success).toBe(false)
  })

  it("rejects more than 50 ops, 10 hints or an unknown hint", () => {
    const op = { op: "delete", line: 2 }
    expect(
      NoteMergeProposalSchema.safeParse({
        ops: Array(51).fill(op),
        hints: [],
      }).success
    ).toBe(false)
    expect(
      NoteMergeProposalSchema.safeParse({
        ops: [],
        hints: Array(11).fill("links"),
      }).success
    ).toBe(false)
    expect(
      NoteMergeProposalSchema.safeParse({ ops: [], hints: ["eeo.gender"] })
        .success
    ).toBe(false)
  })
})

describe("PROFILE_FIELDS", () => {
  it("names each Profile field and the section that holds it", () => {
    expect(PROFILE_FIELDS["preferences.relocation"]).toEqual({
      label: "Open to relocation",
      anchor: "preferences",
    })
    expect(PROFILE_FIELDS["preferences.cities"]).toEqual({
      label: "Preferred cities",
      anchor: "preferences",
    })
    expect(PROFILE_FIELDS["workAuth.sponsorship"].anchor).toBe(
      "work-authorization"
    )
    for (const key of ProfileFieldKeySchema.options) {
      const { label, anchor } = PROFILE_FIELDS[key]
      expect(label).not.toBe("")
      expect(ProfileSectionSchema.options).toContain(anchor)
      expect(key.split(".")[0]).toBe(
        anchor === "work-authorization" ? "workAuth" : anchor
      )
    }
  })
})

describe("diffLines", () => {
  it("diffs lines", () =>
    expect(diffLines("a\nb", "a\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "c" },
    ]))

  it("keeps the longest run of shared lines", () => {
    expect(diffLines("x\na\nb\nc\ny", "a\nq\nb\nc\nz")).toEqual([
      { kind: "remove", text: "x" },
      { kind: "same", text: "a" },
      { kind: "add", text: "q" },
      { kind: "same", text: "b" },
      { kind: "same", text: "c" },
      { kind: "remove", text: "y" },
      { kind: "add", text: "z" },
    ])
  })

  it("has no lines for empty text", () => {
    expect(diffLines("", "a")).toEqual([{ kind: "add", text: "a" }])
    expect(diffLines("a", "")).toEqual([{ kind: "remove", text: "a" }])
    expect(diffLines("", "")).toEqual([])
  })

  it("stays exact on text too large to compare line by line", () => {
    const before = Array.from({ length: 2_500 }, (_, i) => `- fact ${i}`)
    const after = ["- new first", ...before.slice(1, -1), "- new last"]
    const diff = diffLines(before.join("\n"), after.join("\n"))
    const side = (kind: "add" | "remove") =>
      diff.filter((line) => line.kind !== kind).map(({ text }) => text)
    expect(side("add")).toEqual(before)
    expect(side("remove")).toEqual(after)
  })
})

describe("plainQuestions", () => {
  const fields = [
    field({ id: "name", label: "Name" }),
    field({
      id: "relocate",
      label: "Are you open to relocation?",
      control: "select",
      options: [
        { id: "#1", label: "Yes" },
        { id: "#2", label: "No" },
      ],
    }),
    field({ id: "why", label: "Why  us?\n", control: "textarea" }),
    field({ id: "blank", label: "", help: "Tell us about a project." }),
  ]

  it("builds plain questions from fields", () => {
    expect(plainQuestions(fields, ["relocate"])).toEqual([
      {
        id: "p1",
        text: "Are you open to relocation?",
        options: ["Yes", "No"],
        original: [
          { fieldId: "relocate", label: "Are you open to relocation?" },
        ],
        companySpecific: false,
      },
    ])
  })

  it("keeps page order and numbers the questions", () => {
    const questions = plainQuestions(fields, ["blank", "why", "name", "gone"])
    expect(questions.map(({ id, text }) => [id, text])).toEqual([
      ["p1", "Name"],
      ["p2", "Why us?"],
      ["p3", "Tell us about a project."],
    ])
    expect(questions[1]).toEqual({
      id: "p2",
      text: "Why us?",
      original: [{ fieldId: "why", label: "Why  us?\n" }],
      companySpecific: false,
    })
  })

  it("names a field with no label or help", () => {
    const [question] = plainQuestions([field({ id: "x", label: " " })], ["x"])
    expect(question?.text).toBe("Unlabeled question")
  })
})
