import { afterEach, expect, it, vi } from "vitest"
import { registerUpdates } from "../src/background/updates"

const mock = vi.hoisted(() => ({
  account: vi.fn(),
  activePage: vi.fn(),
  realtimeClient: vi.fn(),
  trustedPanel: vi.fn(),
}))
vi.mock("../src/lib/auth", () => ({
  account: mock.account,
  realtimeClient: mock.realtimeClient,
}))
vi.mock("../src/background/navigation", () => ({
  activePage: mock.activePage,
}))
vi.mock("../src/background/messages", () => ({
  trustedPanel: mock.trustedPanel,
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it("refreshes only after subscription or a matching database event", async () => {
  let watch: ((message: object) => void) | undefined
  let disconnect: (() => void) | undefined
  let status: ((value: string) => void) | undefined
  const changes: Array<() => void> = []
  const sent: Array<{ type: string }> = []
  const channel = {
    on: vi.fn((_event: string, _filter: object, callback: () => void) => {
      changes.push(callback)
      return channel
    }),
    subscribe: vi.fn((callback: (value: string) => void) => {
      status = callback
      return channel
    }),
  }
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  }
  mock.account.mockResolvedValue({ id: "user" })
  mock.activePage.mockResolvedValue({
    page: { kind: "job", identity: { externalJobId: "123456" } },
  })
  mock.realtimeClient.mockResolvedValue(client)
  mock.trustedPanel.mockReturnValue(true)
  const port = {
    name: "job-updates",
    sender: { id: "extension", url: "panel.html" },
    onMessage: {
      addListener: (listener: typeof watch) => {
        watch = listener
      },
    },
    onDisconnect: {
      addListener: (listener: typeof disconnect) => {
        disconnect = listener
      },
    },
    postMessage: (message: { type: string }) => {
      sent.push(message)
    },
    disconnect: vi.fn(),
  }
  let connect: ((value: typeof port) => void) | undefined
  vi.stubGlobal("chrome", {
    runtime: {
      onConnect: {
        addListener: (listener: typeof connect) => {
          connect = listener
        },
      },
    },
  })
  registerUpdates()
  connect?.(port)
  watch?.({
    type: "watch",
    jobId: "123456",
    operationId: "00000000-0000-4000-8000-000000000001",
  })
  await vi.waitFor(() => expect(status).toBeDefined())
  expect(sent).toEqual([])
  expect(channel.on).toHaveBeenCalledTimes(3)
  status?.("SUBSCRIBED")
  changes[2]?.()
  expect(sent).toEqual([{ type: "ready" }, { type: "changed" }])
  disconnect?.()
  expect(client.removeChannel).toHaveBeenCalledWith(channel)
  changes[2]?.()
  expect(sent).toHaveLength(2)
})
