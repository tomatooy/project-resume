import { expect, it } from "vitest"
import type { FieldSnapshot, PlanInput } from "@workspace/resume-core/contracts"
import { SessionSchema } from "../src/autofill/messages"
import { acceptConfirmation } from "../src/autofill/confirmed-answers"

function fixture() {
  const field: FieldSnapshot = {
    fieldId: "permission",
    fieldRevision: 2,
    control: "single_select",
    label: "Are you authorized to work in Canada?",
    description: "",
    section: "Eligibility",
    attributes: {},
    constraints: { required: true },
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
      adapterId: "native",
      read: true,
      write: true,
      discover: false,
      search: false,
      scroll: false,
      verify: true,
    },
    guardRef: "guard",
    options: {
      fieldId: "permission",
      fieldRevision: 2,
      optionsRevision: 3,
      queryRevision: 4,
      query: "",
      loadState: "ready",
      coverage: "complete",
      hasMore: false,
      canSearch: false,
      canScroll: false,
      options: ["Yes", "No", "Requires assessment"].map((label, index) => ({
        optionId: `option-${index}`,
        label,
        description: "",
        disabled: false,
        placeholder: false,
        selected: false,
      })),
    },
  }
  const resumeId = crypto.randomUUID()
  const session = SessionSchema.parse({
    id: crypto.randomUUID(),
    generation: 1,
    accountId: "account",
    resumeId,
    sourceStamp: {
      resumeId,
      resumeSource: { kind: "head", revision: 1, contentHash: "a".repeat(64) },
      profileRevision: 1,
      overridesRevision: 0,
    },
    applicationContext: { applicationId: "application", jobId: "job" },
    tabId: 1,
    frameId: 0,
    documentId: "document",
    instanceId: crypto.randomUUID(),
    origin: "https://jobs.example.test",
    documentEpoch: 1,
    status: "completed",
    message: "",
    updatedAt: Date.now(),
    decisions: [],
    results: [],
    selections: [],
    overrides: [],
    attempts: 0,
    observation: {
      forms: [],
      uncovered: false,
      snapshot: {
        schemaVersion: 1,
        snapshotId: "snapshot",
        documentEpoch: 1,
        formRevision: 1,
        formId: "page",
        formLabel: "Application",
        fields: [field],
        groups: [],
        coverage: "complete",
        coverageReasons: [],
        observedAt: new Date().toISOString(),
      },
    },
  })
  const observed = session.observation?.snapshot?.fields[0]
  if (!observed) throw new Error("Missing fixture field")
  const selection: PlanInput["selections"][number] = {
    fieldId: field.fieldId,
    fieldRevision: field.fieldRevision,
    concept: "work_authorized",
    optionIds: ["option-2"],
    optionsRevision: 3,
    queryRevision: 4,
    confirmed: true,
    replace: false,
    guardRef: field.guardRef,
    profileRevision: 1,
  }
  return { session, field: observed, selection }
}

it("remembers exactly the confirmed option label without inferring a boolean fact", () => {
  const { session, selection } = fixture()
  const stamp = structuredClone(session.sourceStamp)
  acceptConfirmation(session, selection)
  expect(session.applicationAnswers).toHaveLength(1)
  expect(session.applicationAnswers[0]).toMatchObject({
    applicationId: "application",
    meaning: { concept: "work_authorized" },
    conditions: { countryCode: "CA", jobId: "job" },
    value: "Requires assessment",
    confirmed: true,
    provenance: { kind: "user", sourceStamp: stamp },
  })
  expect(session.sourceStamp?.overridesRevision).toBe(1)
  expect(session.sourceSnapshot).toBeNull()
  expect(session.overrides).toEqual([])
})

it("joins a confirmed multiselect set and replaces its older temporary answer", () => {
  const { session, field, selection } = fixture()
  field.control = "multi_select"
  acceptConfirmation(session, selection)
  acceptConfirmation(session, {
    ...selection,
    optionIds: ["option-0", "option-2"],
  })
  expect(session.applicationAnswers).toHaveLength(1)
  expect(session.applicationAnswers[0]?.value).toBe("Yes, Requires assessment")
  expect(session.selections).toHaveLength(1)
  expect(session.sourceStamp?.overridesRevision).toBe(2)
})

it.each([
  { optionIds: ["unknown"] },
  { optionIds: [] },
  { optionIds: ["option-0", "option-0"] },
  { optionIds: ["option-0", "option-1"] },
  { optionsRevision: 2 },
  { optionsRevision: undefined },
  { queryRevision: 3 },
  { queryRevision: undefined },
  { fieldRevision: 1 },
  { guardRef: "old" },
  { profileRevision: 0 },
  { confirmed: false },
])("rejects a stale or invalid confirmation without mutation: %j", (change) => {
  const { session, selection } = fixture()
  const before = structuredClone(session)
  expect(() =>
    acceptConfirmation(session, { ...selection, ...change })
  ).toThrow()
  expect(session).toEqual(before)
})

it.each([
  "disabled",
  "placeholder",
  "duplicate",
  "loading",
  "field",
  "revision",
  "blank",
  "long",
])("rejects unusable observed choices: %s", (condition) => {
  const { session, field, selection } = fixture()
  const options = field.options
  const selected = options?.options[2]
  if (!options || !selected) throw new Error("Missing fixture options")
  if (condition === "disabled") selected.disabled = true
  if (condition === "placeholder") selected.placeholder = true
  if (condition === "duplicate") options.options.push({ ...selected })
  if (condition === "loading") options.loadState = "loading"
  if (condition === "field") options.fieldId = "other-field"
  if (condition === "revision") options.fieldRevision = 1
  if (condition === "blank") selected.label = " "
  if (condition === "long") {
    field.control = "multi_select"
    options.options = Array.from({ length: 5 }, (_, i) => ({
      ...selected,
      optionId: `long-${i}`,
      label: "a".repeat(1000),
    }))
    selection.optionIds = options.options.map((option) => option.optionId)
  }
  const before = structuredClone(session)
  expect(() => acceptConfirmation(session, selection)).toThrow()
  expect(session).toEqual(before)
})

it("requires a current per-field preview before remembering a replacement", () => {
  const { session, field, selection } = fixture()
  field.state.empty = false
  field.state.hasUserValue = true
  selection.replace = true
  const preview = {
    fieldId: field.fieldId,
    fieldRevision: 2,
    guardRef: "guard",
    value: "No",
  }
  for (const previews of [
    [],
    [{ ...preview, fieldRevision: 1 }],
    [{ ...preview, guardRef: "old" }],
  ]) {
    session.replacementPreviews = previews
    expect(() => acceptConfirmation(session, selection)).toThrow(/Preview/)
    expect(session.applicationAnswers).toEqual([])
  }
  session.replacementPreviews = [preview]
  acceptConfirmation(session, selection)
  expect(session.applicationAnswers[0]?.value).toBe("Requires assessment")
})

it("retains explicit override provenance and removes it when a later choice replaces it", () => {
  const { session, field, selection } = fixture()
  const textSelection = { ...selection, optionIds: undefined }
  const override: PlanInput["overrides"][number] = {
    overrideId: crypto.randomUUID(),
    concept: selection.concept,
    fieldId: field.fieldId,
    value: "Confirmed explanation",
  }
  session.drafts.push({
    fieldId: field.fieldId,
    question: field.label,
    text: override.value,
    factIds: [],
    missingInformation: [],
  })
  acceptConfirmation(session, textSelection, override)
  expect(session.applicationAnswers[0]?.provenance.kind).toBe("confirmed_draft")
  expect(session.overrides[0]).toEqual({ ...override, documentId: "document" })
  acceptConfirmation(session, textSelection, {
    ...override,
    value: "My correction",
  })
  expect(session.applicationAnswers[0]?.provenance.kind).toBe("user")
  acceptConfirmation(session, selection)
  expect(session.overrides).toEqual([])
  expect(session.applicationAnswers[0]?.provenance.kind).toBe("user")
  expect(session.applicationAnswers[0]?.value).toBe("Requires assessment")
})

it("rejects mismatched override scope before recording the confirmation", () => {
  const { session, selection } = fixture()
  const before = structuredClone(session)
  expect(() =>
    acceptConfirmation(session, selection, {
      overrideId: crypto.randomUUID(),
      fieldId: "another",
      concept: selection.concept,
      value: "No",
    })
  ).toThrow(/Confirm/)
  expect(session).toEqual(before)
})
