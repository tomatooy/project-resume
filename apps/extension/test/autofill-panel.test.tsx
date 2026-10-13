import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AutofillPanel } from "../src/autofill/Panel"
import {
  SessionSchema,
  PanelCommandSchema,
  type PanelState,
  type PanelCommand,
} from "../src/autofill/messages"
import { FieldSnapshotSchema } from "@workspace/resume-core/contracts"

const nonce = "00000000-0000-4000-8000-000000000001"
const resumeId = "00000000-0000-4000-8000-000000000002"
const sendMessage = vi.fn()
let client: QueryClient
const ready: PanelState = {
  origin: "https://jobs.ashbyhq.com",
  account: { id: "account", email: "synthetic@example.test" },
  resumes: [
    {
      id: resumeId,
      title: "Synthetic",
      subtitle: "",
      templateId: "lisbon",
      updatedAt: "2026-09-26T00:00:00Z",
    },
  ],
  nextCursor: null,
  preselected: resumeId,
  session: null,
}
beforeEach(() => {
  location.hash = `#autofill=${nonce}`
  sendMessage.mockReset().mockResolvedValue({ ok: true, state: ready })
  vi.stubGlobal("chrome", { runtime: { sendMessage } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
  location.hash = ""
  vi.unstubAllGlobals()
})
function mount() {
  render(
    <QueryClientProvider client={client}>
      <AutofillPanel />
    </QueryClientProvider>
  )
}
it("fills the bound current page without asking the user to choose a frame", async () => {
  mount()
  const fill = await screen.findByRole("button", { name: "Fill current page" })
  await waitFor(() => expect(fill).toHaveProperty("disabled", false))
  expect(screen.queryByText("Application frame")).toBeNull()
  fireEvent.click(fill)
  await waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      protocolVersion: 1,
      nonce,
      type: "af.start",
      resumeId,
      countryCode: undefined,
      currency: undefined,
      salaryPeriod: undefined,
      formId: undefined,
    })
  )
})
it("retries a service error in the same panel without reporting a session failure", async () => {
  sendMessage.mockResolvedValueOnce({
    ok: false,
    code: "service",
    message: "private upstream details",
  })
  mount()
  expect(
    await screen.findByText(/Could not load your saved resumes/)
  ).toBeTruthy()
  expect(screen.queryByText(/trusted session/)).toBeNull()
  expect(screen.queryByText("private upstream details")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await screen.findByRole("button", { name: "Fill current page" })
  expect(sendMessage.mock.calls).toEqual([
    [{ type: "af.state", protocolVersion: 1, nonce }],
    [{ type: "af.state", protocolVersion: 1, nonce }],
  ])
})
it("offers reconnect for an expired account connection", async () => {
  sendMessage.mockResolvedValueOnce({
    ok: false,
    code: "auth",
    message: "private auth details",
  })
  mount()
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect account" })
  )
  await screen.findByRole("button", { name: "Fill current page" })
  expect(sendMessage).toHaveBeenCalledWith({
    type: "af.connect",
    protocolVersion: 1,
    nonce,
  })
})
it("shows safe recovery guidance if the background connection is lost", async () => {
  sendMessage.mockRejectedValue(new Error("private transport details"))
  mount()
  expect(
    await screen.findByText(/Could not connect to the extension/)
  ).toBeTruthy()
  expect(screen.queryByText("private transport details")).toBeNull()
})

function reviewedPage() {
  const fields = ["Email", "Phone"].map((label, i) =>
    FieldSnapshotSchema.parse({
      fieldId: `f${i}`,
      fieldRevision: 1,
      control: "text",
      label,
      description: "",
      section: "Contact",
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
      guardRef: `guard${i}`,
    })
  )
  const session = SessionSchema.parse({
    id: "00000000-0000-4000-8000-000000000003",
    generation: 1,
    accountId: "account",
    resumeId,
    sourceStamp: {
      resumeId,
      resumeSource: { kind: "head", revision: 1, contentHash: "a".repeat(64) },
      profileRevision: 1,
      overridesRevision: 0,
    },
    tabId: 1,
    frameId: 0,
    documentId: "document",
    instanceId: nonce,
    origin: ready.origin,
    documentEpoch: 1,
    status: "completed",
    message: "Review current page",
    updatedAt: Date.now(),
    decisions: fields.map((field, i) => ({
      decisionId: crypto.randomUUID(),
      fieldId: field.fieldId,
      fieldRevision: 1,
      label: field.label,
      status: "review",
      reasonCode: "confirmation_required",
      semanticKey: i === 0 ? "contact_email" : "contact_phone",
      value: i === 0 ? "person@example.test" : "+15555555555",
    })),
    results: [],
    selections: [],
    overrides: [],
    attempts: 0,
    applicationContext: { applicationId: "job1", countryCode: "CA" },
    observation: {
      forms: [],
      uncovered: false,
      snapshot: {
        schemaVersion: 1,
        snapshotId: "s1",
        documentEpoch: 1,
        formRevision: 1,
        formId: "page",
        formLabel: "Application",
        fields,
        groups: [],
        coverage: "complete",
        coverageReasons: [],
        observedAt: new Date().toISOString(),
      },
    },
  })
  return { ...ready, session }
}

it("queues multiple confirmations and fills them only after one explicit batch action", async () => {
  const state = reviewedPage()
  sendMessage.mockResolvedValue({ ok: true, state })
  mount()
  const buttons = await screen.findAllByRole("button", {
    name: "Confirm this answer",
  })
  const [first, second] = buttons
  if (!first || !second) throw new Error("Expected two questions")
  fireEvent.click(first)
  fireEvent.click(second)
  expect(
    sendMessage.mock.calls.filter(([command]) => command.type === "af.continue")
  ).toHaveLength(0)
  fireEvent.click(
    screen.getByRole("button", { name: "Fill confirmed answers" })
  )
  await waitFor(() =>
    expect(
      sendMessage.mock.calls.filter(
        ([command]) => command.type === "af.continue"
      )
    ).toHaveLength(1)
  )
  const command = PanelCommandSchema.parse(
    sendMessage.mock.calls.find(
      ([command]) => command.type === "af.continue"
    )?.[0]
  )
  expect(command.type).toBe("af.continue")
  if (command.type !== "af.continue") throw new Error("Expected confirmations")
  expect(command.confirmations?.map((item) => item.selection.fieldId)).toEqual([
    "f0",
    "f1",
  ])
  expect(command.confirmations?.every((item) => item.selection.confirmed)).toBe(
    true
  )
})

it("invalidates queued references when the session generation changes", async () => {
  const state = reviewedPage()
  sendMessage.mockResolvedValue({ ok: true, state })
  mount()
  const [first] = await screen.findAllByRole("button", {
    name: "Confirm this answer",
  })
  if (!first) throw new Error("Expected a question")
  fireEvent.click(first)
  expect(
    screen.getByRole("button", { name: "Fill confirmed answers" })
  ).toBeTruthy()
  await act(async () => {
    client.setQueryData(["autofill", nonce], {
      ...state,
      session: { ...state.session, generation: 2 },
    })
  })
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Fill confirmed answers" })
    ).toBeNull()
  )
  expect(
    sendMessage.mock.calls.filter(([command]) => command.type === "af.continue")
  ).toHaveLength(0)
})

it("keeps a generated draft unfilled until review and batch confirmation", async () => {
  const state = reviewedPage()
  const firstDecision = state.session.decisions[0]
  if (!firstDecision) throw new Error("Expected a question")
  state.session.decisions = [
    {
      ...firstDecision,
      status: "needs_draft",
      semanticKey: "open_answer",
      reasonCode: "needs_draft",
      value: undefined,
    },
  ]
  sendMessage.mockImplementation(async (command: PanelCommand) => {
    if (command.type === "af.draft")
      state.session.drafts = [
        {
          fieldId: "f0",
          question: "Email",
          text: "I built a scheduling tool.",
          factIds: ["fact1"],
          missingInformation: ["Your motivation for this employer"],
        },
      ]
    return { ok: true, state: structuredClone(state) }
  })
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "Generate draft" }))
  await screen.findByDisplayValue("I built a scheduling tool.")
  expect(
    screen.getByText("Still needed: Your motivation for this employer")
  ).toBeTruthy()
  expect(
    sendMessage.mock.calls.filter(([command]) => command.type === "af.continue")
  ).toHaveLength(0)
  fireEvent.click(screen.getByRole("button", { name: "Confirm this answer" }))
  expect(
    sendMessage.mock.calls.filter(([command]) => command.type === "af.continue")
  ).toHaveLength(0)
  fireEvent.click(
    screen.getByRole("button", { name: "Fill confirmed answers" })
  )
  await waitFor(() =>
    expect(
      sendMessage.mock.calls.filter(
        ([command]) => command.type === "af.continue"
      )
    ).toHaveLength(1)
  )
  const command = PanelCommandSchema.parse(
    sendMessage.mock.calls.find(
      ([command]) => command.type === "af.continue"
    )?.[0]
  )
  if (command.type !== "af.continue") throw new Error("Expected confirmation")
  expect(command.confirmations?.[0]?.override?.value).toBe(
    "I built a scheduling tool."
  )
  expect(command.confirmations?.[0]?.selection.concept).toBe("open_answer")
})

it("requires a separate future-use choice before saving a confirmed application answer", async () => {
  const state = reviewedPage()
  state.session.applicationAnswers = [
    {
      answerId: crypto.randomUUID(),
      applicationId: "job1",
      meaning: { concept: "contact_email" },
      conditions: { countryCode: "CA" },
      value: "person@example.test",
      confirmed: true,
      provenance: { kind: "user" },
    },
  ]
  sendMessage.mockResolvedValue({ ok: true, state })
  mount()
  await screen.findByText("Confirmed for this application")
  expect(
    screen.queryByRole("button", { name: "Confirm save to Profile" })
  ).toBeNull()
  fireEvent.click(screen.getByRole("combobox", { name: "Save contact email" }))
  const option = await screen.findByRole("option", {
    name: "Save to Autofill Profile",
  })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  expect(
    sendMessage.mock.calls.filter(
      ([command]) => command.type === "af.saveAnswer"
    )
  ).toHaveLength(0)
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm save to Profile" })
  )
  await waitFor(() =>
    expect(
      sendMessage.mock.calls.filter(
        ([command]) => command.type === "af.saveAnswer"
      )
    ).toHaveLength(1)
  )
})

it("adds a confirmed supplemental record only to the current application", async () => {
  const state = reviewedPage()
  sendMessage.mockResolvedValue({ ok: true, state })
  mount()
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Add missing experience or education",
    })
  )
  fireEvent.change(screen.getByLabelText("Company"), {
    target: { value: "Acme" },
  })
  fireEvent.change(screen.getByLabelText("Role"), {
    target: { value: "Engineer" },
  })
  fireEvent.change(screen.getByLabelText("Start month"), {
    target: { value: "2022-01" },
  })
  fireEvent.change(screen.getByLabelText("End month"), {
    target: { value: "2024-01" },
  })
  expect(
    sendMessage.mock.calls.filter(([command]) => command.type === "af.continue")
  ).toHaveLength(0)
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm record and fill current page" })
  )
  await waitFor(() =>
    expect(
      sendMessage.mock.calls.filter(
        ([command]) => command.type === "af.continue"
      )
    ).toHaveLength(1)
  )
  const command = PanelCommandSchema.parse(
    sendMessage.mock.calls.find(
      ([command]) => command.type === "af.continue"
    )?.[0]
  )
  if (command.type !== "af.continue")
    throw new Error("Expected supplemental record")
  expect(command.supplementalRecord).toMatchObject({
    applicationId: "job1",
    confirmed: true,
    record: {
      kind: "experience",
      company: "Acme",
      role: "Engineer",
      start: "2022-01",
      end: "2024-01",
    },
  })
  expect(
    sendMessage.mock.calls.filter(
      ([command]) => command.type === "af.saveAnswer"
    )
  ).toHaveLength(0)
})
