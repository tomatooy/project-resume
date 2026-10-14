import { describe, expect, it } from "vitest"
import {
  type CandidateQuestion,
  CandidateQuestionSchema,
} from "../src/dom-agent/question"
import { attachmentTargets } from "../src/dom-agent/attachment"

function fileQuestion(ref: string, text: string): CandidateQuestion {
  return CandidateQuestionSchema.parse({
    ref,
    controlRef: `n-${ref}`,
    groupRef: null,
    recordRef: null,
    kind: "file",
    controlKind: "file",
    text,
    description: null,
    options: [],
    requiredness: { state: "required", evidence: ["native_attribute"] },
    scope: [],
  })
}

function textQuestion(ref: string, text: string): CandidateQuestion {
  return CandidateQuestionSchema.parse({
    ref,
    controlRef: `n-${ref}`,
    groupRef: null,
    recordRef: null,
    kind: "short_text",
    controlKind: "text",
    text,
    description: null,
    options: [],
    requiredness: { state: "optional", evidence: [] },
    scope: [],
  })
}

describe("choosing the field the resume is attached to", () => {
  it("takes the field whose wording is the resume", () => {
    const targets = attachmentTargets([
      fileQuestion("q1", "Resume/CV"),
      fileQuestion("q2", "Cover letter"),
    ])
    expect(targets.target).toEqual({ questionRef: "q1", wording: "Resume/CV" })
    expect(targets.importAreas).toEqual([])
  })

  it("reads the page's own typography, not its accents", () => {
    expect(
      attachmentTargets([fileQuestion("q1", "Upload your Résumé (PDF)")]).target
        ?.questionRef
    ).toBe("q1")
  })

  it("keeps the resume field and an autofill import area apart", () => {
    // Both mention a resume. Only one receives the document: the other would
    // start an import the run never chose.
    const targets = attachmentTargets([
      fileQuestion("q1", "Upload Resume"),
      fileQuestion("q2", "Autofill from resume"),
    ])
    expect(targets.target?.questionRef).toBe("q1")
    expect(targets.importAreas).toEqual([
      { questionRef: "q2", wording: "Autofill from resume" },
    ])
    expect(targets.ambiguous).toEqual([])
  })

  it("never targets an import area on its own", () => {
    const targets = attachmentTargets([
      fileQuestion("q1", "Import a resume to prefill this application"),
    ])
    expect(targets.target).toBeNull()
    expect(targets.importAreas.map((area) => area.questionRef)).toEqual(["q1"])
  })

  it("refuses to choose when two fields both ask for a resume", () => {
    const targets = attachmentTargets([
      fileQuestion("q1", "Resume"),
      fileQuestion("q2", "CV or resume upload"),
    ])
    expect(targets.target).toBeNull()
    expect(targets.ambiguous).toEqual(["q1", "q2"])
  })

  it("leaves upload fields it cannot name unidentified", () => {
    const targets = attachmentTargets([fileQuestion("q1", "Attachment")])
    expect(targets.target).toBeNull()
    expect(targets.unidentified).toEqual(["q1"])
  })

  it("ignores a question that only talks about a resume", () => {
    const targets = attachmentTargets([
      textQuestion(
        "q1",
        "Why do you want to work here? Attach your resume later."
      ),
    ])
    expect(targets).toEqual({
      target: null,
      importAreas: [],
      unidentified: [],
      ambiguous: [],
    })
  })

  it("finds nothing when the page asks for no file at all", () => {
    expect(attachmentTargets([textQuestion("q1", "Email")]).target).toBeNull()
  })
})
