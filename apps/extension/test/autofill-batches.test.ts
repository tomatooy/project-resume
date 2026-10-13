import { expect, it } from "vitest"
import {
  AUTOFILL_LIMITS,
  PlanInputSchema,
  type FieldSnapshot,
  type PlanInput,
} from "@workspace/resume-core/contracts"
import { partitionSnapshot } from "../src/autofill/batches"

function field(groupId: string, index: number): FieldSnapshot {
  const fieldId = `${groupId}-${index}`
  return {
    fieldId,
    groupId,
    fieldRevision: 1,
    control: "single_select",
    label: "School",
    description: "",
    section: "Education",
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
      adapterId: "native-v1",
      read: true,
      write: true,
      discover: false,
      search: false,
      scroll: false,
      verify: true,
    },
    guardRef: fieldId,
    options: {
      fieldId,
      fieldRevision: 1,
      optionsRevision: 1,
      queryRevision: 0,
      query: "",
      loadState: "ready",
      coverage: "complete",
      hasMore: false,
      canSearch: false,
      canScroll: false,
      options: Array.from({ length: 40 }, (_, i) => ({
        optionId: `option-${i}`,
        label: "界".repeat(300),
        description: "",
        disabled: false,
        placeholder: false,
        selected: false,
      })),
    },
  }
}
function fixture(): PlanInput {
  return {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    generation: 1,
    sourceStamp: {
      resumeId: crypto.randomUUID(),
      resumeSource: { kind: "head", revision: 1, contentHash: "a".repeat(64) },
      profileRevision: 0,
      overridesRevision: 0,
    },
    target: {
      tabId: 1,
      frameId: 0,
      documentId: "document",
      origin: "https://jobs.example.test",
      formId: "form",
    },
    snapshot: {
      schemaVersion: 1,
      snapshotId: "snapshot",
      documentEpoch: 1,
      formRevision: 1,
      formId: "form",
      formLabel: "Application",
      observedAt: new Date().toISOString(),
      coverage: "complete",
      coverageReasons: [],
      fields: ["a", "b"].flatMap((g) =>
        Array.from({ length: 6 }, (_, i) => field(g, i))
      ),
      groups: ["a", "b"].map((groupId) => ({
        groupId,
        kind: "education",
        label: "Education",
      })),
    },
    selections: ["a", "b"].map((g) => ({
      fieldId: `${g}-0`,
      fieldRevision: 1,
      guardRef: `${g}-0`,
      concept: "education_school",
      profileRevision: 0,
      confirmed: true,
      replace: false,
      recordId: `record-${g}`,
    })),
    overrides: [],
    remainingAttempts: 8,
  }
}
it("splits by UTF-8 bytes while keeping dependent records and their choices together", () => {
  const input = fixture()
  const batches = partitionSnapshot(input)
  expect(batches).toHaveLength(2)
  expect(batches.flatMap((b) => b.snapshot.fields)).toEqual(
    input.snapshot.fields
  )
  for (const batch of batches) {
    expect(
      new TextEncoder().encode(JSON.stringify(batch)).byteLength
    ).toBeLessThanOrEqual(AUTOFILL_LIMITS.bodyBytes)
    expect(PlanInputSchema.safeParse(batch).success).toBe(true)
    expect(batch.snapshot.groups).toHaveLength(1)
    expect(batch.selections).toHaveLength(1)
    expect(
      batch.snapshot.fields.every(
        (f) => f.groupId === batch.snapshot.groups[0]?.groupId
      )
    ).toBe(true)
  }
})
it("refuses an oversized dependent group instead of truncating it or splitting its binding", () => {
  const input = fixture()
  input.snapshot.fields = Array.from({ length: 8 }, (_, i) => field("a", i))
  expect(() => partitionSnapshot(input)).toThrow("dependent field group")
})

it("projects each model page view to the batch fields and their context", () => {
  const input = fixture()
  input.snapshot.pageView = {
    snapshotId: input.snapshot.snapshotId,
    documentEpoch: input.snapshot.documentEpoch,
    roots: [{ rootId: "document", kind: "document" }],
    nodes: [
      {
        ref: "region",
        rootId: "document",
        tag: "form",
        text: "Application",
        relations: [],
      },
      ...input.snapshot.fields.map((field) => ({
        ref: field.fieldId,
        fieldId: field.fieldId,
        rootId: "document",
        parentRef: "region",
        tag: "input",
        text: field.label,
        relations: [],
      })),
    ],
    coverage: { complete: true, truncated: false, unobservedFrames: 0 },
  }
  const batches = partitionSnapshot(input)
  expect(batches.length).toBeGreaterThan(1)
  for (const batch of batches) {
    expect(
      batch.snapshot.pageView?.nodes
        .filter((node) => node.fieldId)
        .map((node) => node.fieldId)
    ).toEqual(batch.snapshot.fields.map((field) => field.fieldId))
    expect(
      batch.snapshot.pageView?.nodes.some((node) => node.ref === "region")
    ).toBe(true)
    expect(PlanInputSchema.safeParse(batch).success).toBe(true)
  }
})
