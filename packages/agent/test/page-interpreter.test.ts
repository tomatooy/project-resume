import { describe, expect, it, vi } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import type { FieldSnapshot, PageView } from "@workspace/resume-core"
import {
  reconcilePageInterpretation,
  projectPageView,
  validatePageView,
} from "@workspace/resume-core"
import { createPageInterpreter } from "../src/autofill/page-interpreter"
import { testModels, textGenerate } from "./mock"

const field = (fieldId: string): FieldSnapshot => ({
  fieldId,
  fieldRevision: 0,
  control: "text",
  label: "",
  description: "",
  section: "",
  attributes: {},
  constraints: { required: false },
  state: {
    visible: true,
    editable: true,
    empty: true,
    hasUserValue: false,
    validationState: "unknown",
    truncated: false,
  },
  userEditEpoch: 0,
  capabilities: {
    adapterId: "text",
    read: true,
    write: true,
    discover: false,
    search: false,
    scroll: false,
    verify: true,
  },
  guardRef: "g1",
})

const pageView: PageView = {
  snapshotId: "s1",
  documentEpoch: 1,
  roots: [{ rootId: "document", kind: "document" }],
  nodes: [
    {
      ref: "work1",
      rootId: "document",
      tag: "fieldset",
      text: "",
      relations: [],
    },
    {
      ref: "label1",
      parentRef: "work1",
      rootId: "document",
      tag: "label",
      text: "Employer",
      relations: [],
    },
    {
      ref: "f1",
      parentRef: "work1",
      rootId: "document",
      tag: "input",
      text: "",
      fieldId: "f1",
      relations: [{ kind: "label", ref: "label1" }],
    },
    {
      ref: "work2",
      rootId: "document",
      tag: "fieldset",
      text: "",
      relations: [],
    },
    {
      ref: "label2",
      parentRef: "work2",
      rootId: "document",
      tag: "label",
      text: "Previous employer",
      relations: [],
    },
    {
      ref: "f2",
      parentRef: "work2",
      rootId: "document",
      tag: "input",
      text: "",
      fieldId: "f2",
      relations: [{ kind: "label", ref: "label2" }],
    },
  ],
  coverage: { complete: true, truncated: false, unobservedFrames: 0 },
}
const input = { pageView, fields: [field("f1"), field("f2")] }
const interpreted = {
  snapshotId: "s1",
  regions: [{ regionRef: "work1", evidenceRefs: ["label1"] }],
  fields: [
    {
      fieldId: "f1",
      fieldRevision: 0,
      regionRef: "work1",
      concept: "experience_company",
      evidenceRefs: ["label1"],
      groupId: "work1",
      requiresDraft: false,
    },
  ],
  groups: [
    {
      groupId: "work1",
      kind: "experience",
      fieldIds: ["f1"],
      evidenceRefs: ["label1"],
    },
  ],
  excluded: [],
  needsContext: [],
}

describe("page interpretation grounding", () => {
  it("keeps fields the model omitted in the unresolved inventory", () => {
    expect(reconcilePageInterpretation(interpreted, input)).toEqual({
      ...interpreted,
      unresolvedFieldIds: ["f2"],
    })
  })

  it("revalidates interpreted output and recomputes its unresolved inventory", () => {
    expect(
      reconcilePageInterpretation(
        { ...interpreted, unresolvedFieldIds: [] },
        input
      )?.unresolvedFieldIds
    ).toEqual(["f2"])
  })

  it.each([
    { ...interpreted, snapshotId: "other" },
    {
      ...interpreted,
      fields: [{ ...interpreted.fields[0], regionRef: "work2" }],
    },
    {
      ...interpreted,
      regions: [{ regionRef: "work1", evidenceRefs: ["label2"] }],
    },
    {
      ...interpreted,
      fields: [{ ...interpreted.fields[0], fieldId: "invented" }],
    },
    {
      ...interpreted,
      fields: [{ ...interpreted.fields[0], fieldRevision: 2 }],
    },
    {
      ...interpreted,
      fields: [{ ...interpreted.fields[0], evidenceRefs: ["invented"] }],
    },
    {
      ...interpreted,
      fields: [{ ...interpreted.fields[0], evidenceRefs: ["label2"] }],
    },
    {
      ...interpreted,
      groups: [{ ...interpreted.groups[0], fieldIds: ["f1", "f2"] }],
    },
    {
      ...interpreted,
      excluded: [{ fieldId: "f1", reason: "search", evidenceRefs: ["label1"] }],
    },
  ])("rejects stale, fabricated or cross-record evidence %#", (output) => {
    expect(reconcilePageInterpretation(output, input)).toBeNull()
  })

  it("rejects cyclic or dangling observation references", () => {
    expect(
      validatePageView(
        {
          ...pageView,
          nodes: pageView.nodes.map((node) =>
            node.ref === "work1" ? { ...node, parentRef: "f1" } : node
          ),
        },
        input.fields
      )
    ).toBe(false)
    expect(
      validatePageView(
        {
          ...pageView,
          nodes: pageView.nodes.filter((node) => node.ref !== "label1"),
        },
        input.fields
      )
    ).toBe(false)
  })

  it("preserves needs-context fields without claiming they are interpreted", () => {
    const output = reconcilePageInterpretation(
      {
        ...interpreted,
        needsContext: [
          {
            fieldId: "f2",
            relation: "siblings",
            reason: "Question context is incomplete",
          },
        ],
      },
      input
    )
    expect(output?.needsContext[0]?.fieldId).toBe("f2")
    expect(output?.unresolvedFieldIds).toEqual(["f2"])
  })

  it("projects control batches with ancestor and relation closure", () => {
    const projected = projectPageView(pageView, ["f1"])
    expect(projected.nodes.map((node) => node.ref)).toEqual([
      "work1",
      "label1",
      "f1",
    ])
    expect(projected.coverage.complete).toBe(false)
    expect(validatePageView(projected, [field("f1")])).toBe(true)
  })
})

describe("createPageInterpreter", () => {
  it("uses one bounded structured call and never sends current field values", async () => {
    const snapshotId = "bound-request-snapshot"
    const model = new MockLanguageModelV3({
      doGenerate: [
        textGenerate(JSON.stringify({ ...interpreted, snapshotId })),
      ],
    })
    let attempts = 0
    const result = await createPageInterpreter(testModels(model)).interpret(
      { ...input, pageView: { ...pageView, snapshotId } },
      {
        signal: new AbortController().signal,
        beforeAttempt: async () => {
          attempts++
        },
      }
    )
    expect(result.unresolvedFieldIds).toEqual(["f2"])
    expect(attempts).toBe(1)
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "Untrusted page observation"
    )
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      snapshotId
    )
    expect(result.snapshotId).toBe(snapshotId)
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBeLessThanOrEqual(6000)
  })

  it("rejects a fresh model response bound to a different snapshot", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        textGenerate(JSON.stringify({ ...interpreted, snapshotId: "stale" })),
      ],
    })
    const result = await createPageInterpreter(testModels(model)).interpret(
      input,
      {
        signal: new AbortController().signal,
        beforeAttempt: async () => {},
      }
    )
    expect(result.fields).toEqual([])
    expect(result.unresolvedFieldIds).toEqual(["f1", "f2"])
  })

  it("does not call the model after cancellation or invalid observations", async () => {
    const model = new MockLanguageModelV3({ doGenerate: [] })
    const interpreter = createPageInterpreter(testModels(model))
    const controller = new AbortController()
    controller.abort()
    await expect(
      interpreter.interpret(input, {
        signal: controller.signal,
        beforeAttempt: async () => {},
      })
    ).rejects.toThrow()
    const result = await interpreter.interpret(
      { ...input, pageView: { ...pageView, nodes: [] } },
      { signal: new AbortController().signal, beforeAttempt: async () => {} }
    )
    expect(result.unresolvedFieldIds).toEqual(["f1", "f2"])
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it("keeps oversized structural groups unresolved instead of splitting records", async () => {
    const fields = Array.from({ length: 33 }, (_, i) => ({
      ...field(`f${i}`),
      groupId: "group",
    }))
    const view: PageView = {
      ...pageView,
      nodes: fields.map((field) => ({
        ref: field.fieldId,
        fieldId: field.fieldId,
        rootId: "document",
        tag: "input",
        text: "",
        relations: [],
      })),
    }
    const model = new MockLanguageModelV3({ doGenerate: [] })
    const result = await createPageInterpreter(testModels(model)).interpret(
      { pageView: view, fields },
      { signal: new AbortController().signal, beforeAttempt: async () => {} }
    )
    expect(result.unresolvedFieldIds).toHaveLength(33)
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it("preserves valid batches when a later model response fails", async () => {
    const firstFields = Array.from({ length: 32 }, (_, i) => field(`f${i}`))
    const fields = [...firstFields, field("last")]
    const view: PageView = {
      ...pageView,
      nodes: [
        {
          ref: "region",
          rootId: "document",
          tag: "form",
          text: "Application",
          relations: [],
        },
        ...fields.map((field) => ({
          ref: field.fieldId,
          fieldId: field.fieldId,
          parentRef: "region",
          rootId: "document",
          tag: "input",
          text: "",
          relations: [],
        })),
      ],
    }
    const output = {
      snapshotId: "s1",
      regions: [{ regionRef: "region", evidenceRefs: ["region"] }],
      fields: firstFields.map((field) => ({
        fieldId: field.fieldId,
        fieldRevision: 0,
        regionRef: "region",
        concept: "ambiguous",
        evidenceRefs: ["region"],
        requiresDraft: false,
      })),
      groups: [],
      excluded: [],
      needsContext: [],
    }
    const model = new MockLanguageModelV3({
      doGenerate: [
        textGenerate(JSON.stringify(output)),
        textGenerate("invalid"),
      ],
    })
    let attempts = 0
    const result = await createPageInterpreter(testModels(model)).interpret(
      { pageView: view, fields },
      {
        signal: new AbortController().signal,
        beforeAttempt: async () => {
          attempts++
        },
      }
    )
    expect(result.fields).toHaveLength(32)
    expect(result.unresolvedFieldIds).toEqual(["last"])
    expect(attempts).toBe(2)
  })
})

describe("interpretation cache", () => {
  const completeInput = {
    fields: [field("f1")],
    pageView: projectPageView(pageView, ["f1"]),
  }
  const options = {
    signal: new AbortController().signal,
    beforeAttempt: async () => {},
  }

  it("reuses semantic understanding across snapshots without consuming another attempt", async () => {
    const scope = crypto.randomUUID()
    const model = new MockLanguageModelV3({
      modelId: "cache-test",
      doGenerate: [textGenerate(JSON.stringify(interpreted))],
    })
    let attempts = 0
    const interpreter = createPageInterpreter(testModels(model), scope)
    const beforeAttempt = async () => {
      attempts++
    }
    const first = await interpreter.interpret(completeInput, {
      ...options,
      beforeAttempt,
    })
    first.groups[0]?.fieldIds.push("invented")
    const next = await createPageInterpreter(
      testModels(model),
      scope
    ).interpret(
      {
        fields: completeInput.fields.map((field) => ({
          ...field,
          guardRef: "new-guard",
          state: { ...field.state, empty: false, editable: false },
        })),
        pageView: { ...completeInput.pageView, snapshotId: "s2" },
      },
      { ...options, beforeAttempt }
    )
    expect(next.snapshotId).toBe("s2")
    expect(next.groups[0]?.fieldIds).toEqual(["f1"])
    expect(attempts).toBe(1)
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it("invalidates changed evidence and field revisions", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        textGenerate(JSON.stringify(interpreted)),
        textGenerate(JSON.stringify(interpreted)),
        textGenerate(
          JSON.stringify({
            ...interpreted,
            fields: interpreted.fields.map((field) => ({
              ...field,
              fieldRevision: 1,
            })),
          })
        ),
      ],
    })
    const interpreter = createPageInterpreter(
      testModels(model),
      crypto.randomUUID()
    )
    await interpreter.interpret(completeInput, options)
    await interpreter.interpret(
      {
        ...completeInput,
        pageView: {
          ...completeInput.pageView,
          nodes: completeInput.pageView.nodes.map((node) =>
            node.ref === "label1"
              ? { ...node, text: "Previous employer" }
              : node
          ),
        },
      },
      options
    )
    await interpreter.interpret(
      {
        ...completeInput,
        fields: completeInput.fields.map((field) => ({
          ...field,
          fieldRevision: 1,
        })),
      },
      options
    )
    expect(model.doGenerateCalls).toHaveLength(3)
  })

  it("does not share entries between accounts or cache invalid record groups", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        textGenerate(JSON.stringify(interpreted)),
        textGenerate(
          JSON.stringify({
            ...interpreted,
            groups: [{ ...interpreted.groups[0], fieldIds: ["f1", "f2"] }],
          })
        ),
        textGenerate(JSON.stringify(interpreted)),
      ],
    })
    await createPageInterpreter(
      testModels(model),
      crypto.randomUUID()
    ).interpret(completeInput, options)
    const interpreter = createPageInterpreter(
      testModels(model),
      crypto.randomUUID()
    )
    expect(
      (await interpreter.interpret(completeInput, options)).unresolvedFieldIds
    ).toEqual(["f1"])
    expect(
      (await interpreter.interpret(completeInput, options)).unresolvedFieldIds
    ).toEqual([])
    expect(model.doGenerateCalls).toHaveLength(3)
  })

  it("expires cached interpretations after five minutes", async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(now)
    try {
      const model = new MockLanguageModelV3({
        doGenerate: [
          textGenerate(JSON.stringify(interpreted)),
          textGenerate(JSON.stringify(interpreted)),
        ],
      })
      const interpreter = createPageInterpreter(
        testModels(model),
        crypto.randomUUID()
      )
      await interpreter.interpret(completeInput, options)
      clock.mockReturnValue(now + 300001)
      await interpreter.interpret(completeInput, options)
      expect(model.doGenerateCalls).toHaveLength(2)
    } finally {
      clock.mockRestore()
    }
  })
})
