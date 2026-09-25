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
import type { Snapshot } from "../src/lib/messages"
const mock = vi.hoisted(() => ({ send: vi.fn(), page: vi.fn() }))
let updateListener: ((message: { type: string }) => void) | undefined
vi.mock("../src/lib/messages", async (original) => ({
  ...(await original<typeof import("../src/lib/messages")>()),
  send: mock.send,
  sendResumePage: mock.page,
}))
const id = "00000000-0000-4000-8000-000000000001"
function snapshot(
  status: "queued" | "succeeded" | "failed" | "cancelled"
): Snapshot {
  return {
    page: {
      kind: "job",
      identity: { platform: "linkedin", externalJobId: "123456" },
      sourceUrl: "https://www.linkedin.com/jobs/view/123456",
    },
    account: { id, email: "test@example.test" },
    resumes: [],
    nextResumeCursor: null,
    lastBaseId: null,
    lookup: {
      kind: "bound",
      identity: { platform: "linkedin", externalJobId: "123456" },
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
        idempotencyKey: id,
        deadline: new Date(Date.now() + 300_000).toISOString(),
        errorClass: null,
        agentRunId: id,
      },
    },
  }
}
function mount() {
  vi.stubGlobal("chrome", {
    runtime: {
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
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
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
  expect(screen.queryByText("Checking this job…")).toBeNull()
  client.clear()
})
it("reopens a saved success without offering generation", async () => {
  mock.send.mockResolvedValue(snapshot("succeeded"))
  const client = mount()
  expect(await screen.findByText("Resume is ready, now apply")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Tailor resume" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Edit resume" }))
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "edit", resumeId: id })
    )
  )
  client.clear()
})

it("returns to the floating widget from its header control", async () => {
  const post = vi
    .spyOn(window.parent, "postMessage")
    .mockImplementation(() => {})
  mock.send.mockResolvedValue(snapshot("succeeded"))
  const client = mount()
  await screen.findByText("Resume is ready, now apply")
  fireEvent.click(
    screen.getByRole("button", { name: "Back to floating widget" })
  )
  expect(post).toHaveBeenCalledWith(
    { type: "panel-collapse" },
    "https://www.linkedin.com"
  )
  post.mockRestore()
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
  mock.send.mockRejectedValue(new Error("Offline"))
  const client = mount()
  expect(await screen.findByText("Could not check this job")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Tailor resume" })).toBeNull()
  expect(screen.queryByText("Could not finish tailoring")).toBeNull()
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
        updatedAt: "2026-09-25T00:00:00Z",
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
