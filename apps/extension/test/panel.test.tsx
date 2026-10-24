import { afterEach, expect, it, vi } from "vitest"
import {
  cleanup,
  renderHook,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useOperationRecovery } from "../src/panel/queries"
import { App } from "../src/panel/App"
import { ExtensionError, type Snapshot } from "../src/lib/messages"
const mock = vi.hoisted(() => ({
  send: vi.fn(),
  page: vi.fn(),
  preview: vi.fn(),
}))
let updateListener: ((message: { type: string }) => void) | undefined
let routeListener:
  | ((tabId: number, change: chrome.tabs.OnUpdatedInfo) => void)
  | undefined
const runtimeSend = vi.fn(async () => ({ ok: true }))
const preferences = new Map<string, string>()
const storageSet = vi.fn(async (values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) preferences.set(key, value)
})
vi.mock("../src/lib/messages", async (original) => ({
  ...(await original<typeof import("../src/lib/messages")>()),
  send: mock.send,
  sendResumePage: mock.page,
  sendResumePreview: mock.preview,
}))
const id = "00000000-0000-4000-8000-000000000001"
function snapshot(
  status: "queued" | "succeeded" | "failed" | "cancelled",
  externalJobId = "123456"
): Snapshot {
  return {
    tabId: 1,
    page: {
      kind: "job",
      identity: { platform: "linkedin", externalJobId },
      sourceUrl: `https://www.linkedin.com/jobs/view/${externalJobId}`,
    },
    account: { id, email: "test@example.test" },
    resumes: [],
    nextResumeCursor: null,
    lastBaseId: null,
    autofill: null,
    lookup: {
      kind: "bound",
      identity: { platform: "linkedin", externalJobId },
      resumeId: id,
      canRetry: status === "failed" || status === "cancelled",
      canCancel: status === "queued",
      operation: {
        legacy: false,
        id,
        bindingId: id,
        resumeId: id,
        jobTargetId: id,
        attempt: 1,
        status,
        expectedRevision: 1,
        inputVersionId: id,
        instructions: "",
        idempotencyKey: id,
        deadline: new Date(Date.now() + 300_000).toISOString(),
        errorClass: null,
        agentRunId: id,
      },
    },
  }
}
function other(page: Snapshot["page"], signedIn = true): Snapshot {
  return {
    ...snapshot("succeeded"),
    page,
    account: signedIn ? { id, email: "test@example.test" } : null,
    lookup: null,
  }
}
function mount() {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: preferences.get(key) }),
        set: storageSet,
      },
      session: {
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
    runtime: {
      sendMessage: runtimeSend,
      connect: vi.fn(() => ({
        onMessage: {
          addListener: (listener: typeof updateListener) => {
            updateListener = listener
          },
        },
        onDisconnect: { addListener: vi.fn() },
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      })),
    },
    tabs: {
      onUpdated: {
        addListener: (listener: typeof routeListener) => {
          routeListener = listener
        },
        removeListener: (listener: typeof routeListener) => {
          if (routeListener === listener) routeListener = undefined
        },
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  )
  return client
}
afterEach(() => {
  cleanup()
  updateListener = undefined
  routeListener = undefined
  preferences.clear()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
it("keeps the current view visible while a server event refreshes it", async () => {
  mock.send.mockResolvedValue(snapshot("queued"))
  const client = mount()
  expect(await screen.findByText("Creating a tailored resume…")).toBeTruthy()
  await waitFor(() => expect(updateListener).toBeDefined())
  mock.send.mockReturnValue(new Promise(() => {}))
  updateListener?.({ type: "changed" })
  expect(screen.getByText("Creating a tailored resume…")).toBeTruthy()
  expect(screen.queryByText("Checking this page…")).toBeNull()
  client.clear()
})
it("reopens a saved success without offering generation", async () => {
  mock.send.mockResolvedValue(snapshot("succeeded"))
  const client = mount()
  expect(await screen.findByText("Your tailored resume is ready")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Tailor resume" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Edit in app" }))
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "edit", resumeId: id })
    )
  )
  client.clear()
})

it("loads preview only on request and exits it when its tab changes jobs", async () => {
  mock.send.mockResolvedValue(snapshot("succeeded"))
  mock.preview.mockReturnValue(new Promise(() => {}))
  const client = mount()
  const preview = await screen.findByRole("button", { name: "Preview resume" })
  expect(mock.preview).not.toHaveBeenCalled()
  fireEvent.click(preview)
  await screen.findByRole("region", { name: "Resume preview" })
  expect(mock.preview).toHaveBeenCalledWith({
    accountId: id,
    resumeId: id,
    operationId: id,
    identity: { platform: "linkedin", externalJobId: "123456" },
  })
  mock.send.mockResolvedValue(other({ kind: "select-job" }))
  routeListener?.(1, { url: "https://www.linkedin.com/jobs/search-results/" })
  await screen.findByText("Select a job on LinkedIn")
  expect(screen.queryByRole("region", { name: "Resume preview" })).toBeNull()
  client.clear()
})

it.each(["queued", "failed", "cancelled"] as const)(
  "offers no generated preview for %s",
  async (status) => {
    mock.send.mockResolvedValue(snapshot(status))
    const client = mount()
    await screen.findByText("Resume tailoring")
    expect(screen.queryByRole("button", { name: "Preview resume" })).toBeNull()
    client.clear()
  }
)

it("minimizes or closes itself from the header", async () => {
  mock.send.mockResolvedValue(snapshot("succeeded"))
  const client = mount()
  await screen.findByText("Your tailored resume is ready")
  expect(screen.getByText("Resume tailoring")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Minimize to widget" }))
  fireEvent.click(screen.getByRole("button", { name: "Close for this tab" }))
  expect(runtimeSend.mock.calls).toEqual([
    [{ type: "panel-minimize" }],
    [{ type: "panel-close" }],
  ])
  client.clear()
})
it("reloads only when its own tab changes URL", async () => {
  mock.send.mockResolvedValue(snapshot("succeeded"))
  const client = mount()
  await screen.findByText("Your tailored resume is ready")
  await waitFor(() => expect(routeListener).toBeDefined())
  routeListener?.(2, { url: "https://www.linkedin.com/jobs/view/654321/" })
  routeListener?.(1, { status: "complete" })
  expect(mock.send).toHaveBeenCalledOnce()
  routeListener?.(1, { url: "https://www.linkedin.com/jobs/view/654321/" })
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(2))
  client.clear()
})

it("keeps the panel mounted across job changes and ignores repeat URLs for that job", async () => {
  mock.send.mockResolvedValue(untailored())
  const client = mount()
  const field = await screen.findByRole("textbox", {
    name: /Additional instructions/,
  })
  await waitFor(() => expect(field.hasAttribute("disabled")).toBe(false))
  fireEvent.change(field, { target: { value: "No summary." } })
  let resolve = (_snapshot: Snapshot) => {}
  mock.send.mockReturnValueOnce(
    new Promise<Snapshot>((done) => {
      resolve = done
    })
  )
  await act(async () => {
    routeListener?.(1, {
      url: "https://www.linkedin.com/jobs/search-results/?currentJobId=654321",
    })
  })
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(2))
  expect(screen.getByRole("textbox", { name: /Additional instructions/ })).toBe(
    field
  )
  expect(screen.queryByText("Checking this page…")).toBeNull()
  expect(field.closest("section")?.hasAttribute("inert")).toBe(true)
  expect(screen.getByText("test@example.test")).toBeTruthy()
  await act(async () => {
    routeListener?.(1, {
      url: "https://www.linkedin.com/jobs/search-results/?currentJobId=654321&trackingId=changed",
    })
  })
  expect(mock.send).toHaveBeenCalledTimes(2)
  const next: Snapshot = {
    ...untailored(),
    page: snapshot("succeeded", "654321").page,
  }
  await act(async () => resolve(next))
  await waitFor(() =>
    expect(field.closest("section")?.hasAttribute("inert")).toBe(false)
  )
  expect(screen.getByDisplayValue("No summary.")).toBe(field)
  await act(async () => {
    routeListener?.(1, { url: "https://www.linkedin.com/jobs/view/654321/" })
  })
  expect(mock.send).toHaveBeenCalledTimes(2)
  client.clear()
})

it("keeps an open preview when only the selected job's URL metadata changes", async () => {
  mock.send.mockResolvedValue(snapshot("succeeded"))
  mock.preview.mockReturnValue(new Promise(() => {}))
  const client = mount()
  fireEvent.click(await screen.findByRole("button", { name: "Preview resume" }))
  const preview = await screen.findByRole("region", { name: "Resume preview" })
  await act(async () => {
    routeListener?.(1, {
      url: "https://www.linkedin.com/jobs/search-results/?currentJobId=123456&trackingId=changed",
    })
  })
  expect(mock.send).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("region", { name: "Resume preview" })).toBe(preview)
  client.clear()
})

it("keeps listening during job switches and discards an earlier job's late response", async () => {
  mock.send.mockResolvedValue(snapshot("succeeded"))
  const client = mount()
  await screen.findByText("Your tailored resume is ready")
  let resolveFirst = (_snapshot: Snapshot) => {}
  let resolveLatest = (_snapshot: Snapshot) => {}
  mock.send
    .mockReturnValueOnce(
      new Promise<Snapshot>((resolve) => {
        resolveFirst = resolve
      })
    )
    .mockReturnValueOnce(
      new Promise<Snapshot>((resolve) => {
        resolveLatest = resolve
      })
    )
  await act(async () => {
    routeListener?.(1, { url: "https://www.linkedin.com/jobs/view/654321/" })
  })
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(2))
  expect(routeListener).toBeDefined()
  await act(async () => {
    routeListener?.(1, { url: "https://www.linkedin.com/jobs/view/987654/" })
  })
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(3))
  await act(async () => resolveLatest(snapshot("failed", "987654")))
  await screen.findByText("Could not finish tailoring")
  await act(async () => resolveFirst(snapshot("succeeded", "654321")))
  expect(screen.getByText("Could not finish tailoring")).toBeTruthy()
  expect(screen.queryByText("Your tailored resume is ready")).toBeNull()
  client.clear()
})

it("asks to connect an account before anything else", async () => {
  mock.send.mockResolvedValue(other({ kind: "ats", vendor: "lever" }, false))
  const client = mount()
  expect(await screen.findByText("Connect your account")).toBeTruthy()
  expect(screen.queryByText("Autofill is coming soon")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Connect account" }))
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith({ type: "connect" })
  )
  client.clear()
})
it("holds a place for autofill on application pages", async () => {
  mock.send.mockResolvedValue(other({ kind: "ats", vendor: "lever" }))
  const client = mount()
  expect(await screen.findByText("Autofill is coming soon")).toBeTruthy()
  expect(screen.getByText(/this Lever application/)).toBeTruthy()
  expect(screen.getByText("Autofill")).toBeTruthy()
  expect(
    screen.getByRole("button", { name: "Minimize to widget" })
  ).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Open VS:Résumé" }))
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith({ type: "open-app" })
  )
  client.clear()
})
it("says when a page has no job or application", async () => {
  mock.send.mockResolvedValue(other({ kind: "unsupported" }))
  const client = mount()
  expect(await screen.findByText("No job or application detected")).toBeTruthy()
  expect(
    screen.getByText(
      "Open a LinkedIn job, or an application on Workday, Greenhouse, Lever, Ashby, SmartRecruiters, or iCIMS."
    )
  ).toBeTruthy()
  expect(
    screen.queryByRole("button", { name: "Minimize to widget" })
  ).toBeNull()
  expect(
    screen.getByRole("button", { name: "Close for this tab" })
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: "Open VS:Résumé" })).toBeTruthy()
  client.clear()
})
it("cancels to authoritative saved state and retries the same attempt", async () => {
  mock.send.mockResolvedValue(snapshot("queued"))
  const client = mount()
  await screen.findByRole("button", { name: "Cancel" })
  mock.send.mockResolvedValue(snapshot("cancelled"))
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await screen.findByRole("button", { name: "Retry" })
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retry", operationId: id })
    )
  )
  client.clear()
})
it("does not present a network failure as no resume or failed generation", async () => {
  mock.send.mockRejectedValue(
    new ExtensionError(
      "Could not reach VS:Résumé. Try again.",
      "unavailable",
      undefined,
      snapshot("queued").page
    )
  )
  const client = mount()
  expect(await screen.findByText("Could not check this job")).toBeTruthy()
  expect(
    screen.getByText(
      "We couldn’t load your resume’s status for this job. Try again in a moment."
    )
  ).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Tailor resume" })).toBeNull()
  expect(screen.queryByText("Could not finish tailoring")).toBeNull()
  client.clear()
})
it("reports a failure away from a job without job wording", async () => {
  mock.send.mockRejectedValue(new Error("Offline"))
  const client = mount()
  expect(await screen.findByText("Could not reach VS:Résumé")).toBeTruthy()
  expect(screen.queryByText("Could not check this job")).toBeNull()
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  client.clear()
})

it("uses a successful action snapshot without another state request", async () => {
  mock.send.mockResolvedValue(snapshot("queued"))
  const client = mount()
  await screen.findByRole("button", { name: "Cancel" })
  mock.send.mockResolvedValue(snapshot("cancelled"))
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await screen.findByRole("button", { name: "Retry" })
  expect(
    mock.send.mock.calls.filter(([request]) => request.type === "state")
  ).toHaveLength(1)
  client.clear()
})
it("coalesces a burst of Realtime notifications", async () => {
  mock.send.mockResolvedValue(snapshot("queued"))
  const client = mount()
  await screen.findByRole("button", { name: "Cancel" })
  updateListener?.({ type: "changed" })
  updateListener?.({ type: "changed" })
  updateListener?.({ type: "changed" })
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(2))
  client.clear()
})

it("loads more bases without rereading job state and retains pages after unchanged refresh", async () => {
  const first: Snapshot = {
    ...snapshot("succeeded"),
    lookup: { kind: "none" },
    nextResumeCursor: "next",
    resumes: [
      {
        id,
        title: "First base",
        subtitle: "",
        templateId: "lisbon",
        createdAt: "2026-09-25T00:00:00Z",
        updatedAt: "2026-09-25T00:00:00Z",
        job: null,
      },
    ],
  }
  mock.send.mockResolvedValue(first)
  mock.page.mockResolvedValue({
    items: [
      {
        ...first.resumes[0],
        id: "00000000-0000-4000-8000-000000000002",
        title: "Older base",
      },
    ],
    nextCursor: null,
  })
  const client = mount()
  const more = await screen.findByRole("button", { name: "Load more" })
  fireEvent.click(more)
  await waitFor(() => expect(mock.page).toHaveBeenCalled())
  fireEvent.click(screen.getByRole("combobox"))
  await screen.findByRole("option", { name: "Older base" })
  expect(mock.page).toHaveBeenCalledExactlyOnceWith(id, "next")
  expect(mock.send).toHaveBeenCalledTimes(1)
  updateListener?.({ type: "changed" })
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(2))
  expect(screen.getByRole("option", { name: "Older base" })).toBeTruthy()
  client.clear()
})

it("retries queued recovery after a failed refresh even with a healthy Realtime connection", async () => {
  vi.useFakeTimers()
  const client = new QueryClient()
  const refresh = vi
    .spyOn(client, "invalidateQueries")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined)
  const state = snapshot("queued")
  if (state.lookup?.kind !== "bound") throw new Error()
  state.lookup.operation.dispatchAfter = new Date(
    Date.now() + 1000
  ).toISOString()
  const hook = renderHook(() => useOperationRecovery(state), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  try {
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(refresh).toHaveBeenCalledTimes(2)
    hook.unmount()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(refresh).toHaveBeenCalledTimes(2)
  } finally {
    hook.unmount()
    client.clear()
    vi.useRealTimers()
  }
})

function untailored(): Snapshot {
  return {
    ...snapshot("succeeded"),
    lookup: { kind: "none" },
    resumes: [
      {
        id,
        title: "Base resume",
        subtitle: "",
        templateId: "lisbon",
        createdAt: "2026-09-25T00:00:00Z",
        updatedAt: "2026-09-25T00:00:00Z",
        job: null,
      },
    ],
  }
}

it("keeps typing stable and waits for instruction persistence only on submit", async () => {
  mock.send.mockResolvedValue(untailored())
  const client = mount()
  const field = await screen.findByRole("textbox", {
    name: /Additional instructions/,
  })
  const tailor = screen.getByRole("button", { name: "Tailor resume" })
  await waitFor(() => expect(field.hasAttribute("disabled")).toBe(false))

  let finishSave = () => {}
  const saving = new Promise<void>((resolve) => {
    finishSave = resolve
  })
  storageSet.mockImplementationOnce(async (values) => {
    await saving
    for (const [key, value] of Object.entries(values))
      preferences.set(key, value)
  })
  field.focus()
  fireEvent.change(field, { target: { value: "No summary." } })
  await waitFor(() => expect(storageSet).toHaveBeenCalled())
  expect(document.activeElement).toBe(field)
  expect(
    screen.getByText(
      "Instructions save automatically in this browser. Edit or clear anytime."
    )
  ).toBeTruthy()
  expect(tailor.hasAttribute("disabled")).toBe(false)

  fireEvent.change(field, {
    target: { value: "No summary. Emphasize backend experience." },
  })
  fireEvent.click(tailor)
  await waitFor(() => expect(tailor.hasAttribute("disabled")).toBe(true))
  expect(mock.send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "tailor" })
  )

  await act(async () => finishSave())
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tailor",
        instructions: "No summary. Emphasize backend experience.",
      })
    )
  )
  expect(preferences.get(`tailor-instructions:${id}`)).toBe(
    "No summary. Emphasize backend experience."
  )
  client.clear()
})

it("saves instructions before generation, restores them on reopen, and sends edits", async () => {
  mock.send.mockResolvedValue(untailored())
  const first = mount()
  const field = await screen.findByRole("textbox", {
    name: /Additional instructions/,
  })
  await waitFor(() => expect(field.hasAttribute("disabled")).toBe(false))
  fireEvent.change(field, { target: { value: "Do not include a summary." } })
  await waitFor(() =>
    expect(preferences.get(`tailor-instructions:${id}`)).toBe(
      "Do not include a summary."
    )
  )
  cleanup()
  first.clear()

  const reopened = mount()
  await screen.findByDisplayValue("Do not include a summary.")
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "No summary. Emphasize backend experience." },
  })
  const tailor = screen.getByRole("button", { name: "Tailor resume" })
  await waitFor(() => expect(tailor.hasAttribute("disabled")).toBe(false))
  fireEvent.click(tailor)
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith({
      type: "tailor",
      sourceResumeId: id,
      identity: { platform: "linkedin", externalJobId: "123456" },
      instructions: "No summary. Emphasize backend experience.",
    })
  )
  reopened.clear()
})

it("persists cleared instructions and keeps another account's preference separate", async () => {
  preferences.set(`tailor-instructions:${id}`, "No summary.")
  preferences.set("tailor-instructions:another-account", "Keep it concise.")
  mock.send.mockResolvedValue(untailored())
  const first = mount()
  const field = await screen.findByDisplayValue("No summary.")
  fireEvent.change(field, { target: { value: "" } })
  await waitFor(() =>
    expect(preferences.get(`tailor-instructions:${id}`)).toBe("")
  )
  cleanup()
  first.clear()
  mock.send.mockResolvedValue({
    ...untailored(),
    account: { id: "another-account", email: "another@example.test" },
  })
  const another = mount()
  await screen.findByDisplayValue("Keep it concise.")
  expect(preferences.get(`tailor-instructions:${id}`)).toBe("")
  another.clear()
})

it("reports failed instruction saves and retries without losing the draft", async () => {
  mock.send.mockResolvedValue(untailored())
  const client = mount()
  const field = await screen.findByRole("textbox", {
    name: /Additional instructions/,
  })
  await waitFor(() => expect(field.hasAttribute("disabled")).toBe(false))
  storageSet.mockRejectedValueOnce(new Error("Storage unavailable"))
  fireEvent.change(field, { target: { value: "No summary." } })
  await screen.findByText("Could not save your instructions.")
  expect(
    screen
      .getByRole("button", { name: "Tailor resume" })
      .hasAttribute("disabled")
  ).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  await waitFor(() =>
    expect(preferences.get(`tailor-instructions:${id}`)).toBe("No summary.")
  )
  expect(screen.getByDisplayValue("No summary.")).toBeTruthy()
  client.clear()
})
