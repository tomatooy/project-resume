import { createHash } from "node:crypto"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import {
  reviewPolicy,
  PlanInputSchema,
  type FieldSnapshot,
  type FillAction,
} from "@workspace/resume-core/contracts"
import {
  ContentCommandSchema,
  PanelReplySchema,
  SessionSchema,
} from "../src/autofill/messages"

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  page: vi.fn(),
  prepare: vi.fn(),
  plan: vi.fn(),
  pdf: vi.fn(),
}))
vi.mock("../src/autofill/pdf-background", () => ({
  prepareResumePdf: mocks.pdf,
}))
vi.mock("../src/lib/auth", () => ({ account: mocks.account, connect: vi.fn() }))
vi.mock("../src/lib/config", () => ({
  config: () => ({ appOrigin: "https://app.example.test" }),
}))
vi.mock("../src/lib/api", () => ({
  apiForAccount: async () => ({
    autofill: { prepare: mocks.prepare, plan: mocks.plan },
  }),
  api: {
    resumes: { page: mocks.page },
    autofill: { prepare: mocks.prepare, plan: mocks.plan },
  },
}))
const saved: Record<string, unknown> = {}
const addListener = vi.fn<typeof chrome.runtime.onMessage.addListener>()
const onRevoke = vi.fn<typeof chrome.permissions.onRemoved.addListener>()
const sendMessage = vi.fn()
const getTab = vi.fn<(tabId: number) => Promise<chrome.tabs.Tab>>()
const tab = {
  id: 1,
  windowId: 4,
  url: "https://jobs.example.test/apply",
  index: 0,
  active: true,
  pinned: false,
  highlighted: true,
  incognito: false,
  selected: true,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  frozen: false,
  lastAccessed: 0,
}
const resumeId = "00000000-0000-4000-8000-000000000001"
let currentDocument = "document"
let currentUrl = tab.url
const sourceStamp = {
  resumeId,
  resumeSource: { kind: "head", revision: 1, contentHash: "a".repeat(64) },
  profileRevision: 0,
  overridesRevision: 0,
}
const envelope = z.object({
  type: z.string(),
  generation: z.number().optional(),
  requestId: z.string().optional(),
})
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  currentDocument = "document"
  currentUrl = tab.url
  getTab.mockResolvedValue(tab)
  for (const key of Object.keys(saved)) delete saved[key]
  mocks.account.mockResolvedValue({
    id: "account",
    email: "synthetic@example.test",
  })
  mocks.page.mockResolvedValue({
    items: [
      {
        id: resumeId,
        title: "Synthetic",
        subtitle: "",
        templateId: "lisbon",
        updatedAt: new Date().toISOString(),
      },
    ],
    nextCursor: null,
  })
  mocks.prepare.mockResolvedValue({
    sourceStamp,
    title: "Synthetic",
    availableConcepts: [],
    missingConcepts: [],
    policy: reviewPolicy(),
  })
  sendMessage.mockImplementation(async (_tabId, raw) => {
    const message = envelope.parse(raw)
    if (message.type === "af.hello") return { protocolVersion: 1 }
    if (message.type === "af.observe")
      return {
        ok: true,
        generation: message.generation,
        requestId: message.requestId,
        observation: { forms: [], snapshot: null, uncovered: false },
      }
    return {
      ok: true,
      generation: message.generation,
      requestId: message.requestId,
    }
  })
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      onMessage: { addListener },
    },
    tabs: {
      sendMessage,
      get: getTab,
      update: vi.fn(async () => tab),
      onRemoved: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
    },
    windows: {
      get: vi.fn(async () => ({ focused: true })),
      update: vi.fn(),
      create: vi.fn(async () => ({ tabs: [{ id: 9 }] })),
      onFocusChanged: { addListener: vi.fn() },
    },
    scripting: { executeScript: vi.fn() },
    webNavigation: {
      // Chrome does not expose chrome-extension:// frames through getFrame.
      getFrame: vi.fn(async ({ frameId }) =>
        frameId ? null : { documentId: currentDocument, url: currentUrl }
      ),
      getAllFrames: vi.fn(async () => [{ frameId: 0, url: tab.url }]),
      onCommitted: { addListener: vi.fn() },
      onHistoryStateUpdated: { addListener: vi.fn() },
    },
    permissions: {
      contains: vi.fn(async () => true),
      onRemoved: { addListener: onRevoke },
    },
    alarms: {
      create: vi.fn(async () => {}),
      onAlarm: { addListener: vi.fn() },
    },
    storage: {
      onChanged: { addListener: vi.fn() },
      session: {
        setAccessLevel: vi.fn(async () => {}),
        get: vi.fn(async (key: string | null) =>
          key ? { [key]: saved[key] } : { ...saved }
        ),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(saved, values)
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of typeof keys === "string" ? [keys] : keys)
            delete saved[key]
        }),
      },
    },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function launch() {
  const background = await import("../src/autofill/background")
  background.registerAutofill()
  await background.associateApplication(1, "account", resumeId, tab.url)
  await background.openAutofill(tab)
  const key = Object.keys(saved).find((key) =>
    key.startsWith("autofill:launch:")
  )
  if (!key) throw new Error("Launch missing")
  const nonce = key.slice("autofill:launch:".length)
  return {
    nonce,
    sender: {
      id: "extension",
      tab,
      frameId: 2,
      documentId: "panel-doc",
      url: `chrome-extension://extension/panel.html#autofill=${nonce}`,
    },
  }
}
function request(
  message: object,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  const kind = envelope.parse(message).type
  const session = SessionSchema.safeParse(saved["autofill:session:1"])
  if (
    ["af.cancel", "af.continue", "af.preview"].includes(kind) &&
    session.success
  )
    message = {
      sessionId: session.data.id,
      generation: session.data.generation,
      requestId: crypto.randomUUID(),
      ...message,
    }
  return new Promise((resolve) => {
    const listener = addListener.mock.calls.at(-1)?.[0]
    if (!listener?.(message, sender, resolve)) resolve(undefined)
  })
}
async function state(nonce: string, sender: chrome.runtime.MessageSender) {
  const reply = PanelReplySchema.parse(
    await request({ type: "af.state", protocolVersion: 1, nonce }, sender)
  )
  if (!reply.ok) throw new Error(reply.message)
  return reply.state
}
it("requires registered panel identity and never scans from toolbar bootstrap", async () => {
  const { nonce, sender } = await launch()
  expect((await state(nonce, sender)).preselected).toBe(resumeId)
  expect(
    sendMessage.mock.calls.some(
      ([, raw]) => envelope.parse(raw).type === "af.observe"
    )
  ).toBe(false)
  expect(
    await request(
      { type: "af.state", protocolVersion: 1, nonce: crypto.randomUUID() },
      sender
    )
  ).toMatchObject({ ok: false })
  expect(
    await request(
      { type: "af.state", protocolVersion: 1, nonce },
      { ...sender, documentId: "forged" }
    )
  ).toMatchObject({ ok: false })
  expect(
    await request(
      { type: "af.state", protocolVersion: 1, nonce },
      { ...sender, tab: { ...tab, id: 2 } }
    )
  ).toMatchObject({ ok: false })
  expect(
    await request(
      { type: "af.start", protocolVersion: 1, nonce, resumeId, tabId: 2 },
      sender
    )
  ).toBeUndefined()
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it.each([
  { id: "other-extension" },
  { frameId: 0 },
  { frameId: -1 },
  { frameId: undefined },
  { documentId: undefined },
  { documentLifecycle: "cached" },
  { url: "https://jobs.example.test/apply" },
  { tab: { ...tab, id: 9 } },
] satisfies chrome.runtime.MessageSender[])(
  "rejects invalid sender metadata before registration: %j",
  async (changed) => {
    const { nonce, sender } = await launch()
    expect(
      await request(
        { type: "af.state", protocolVersion: 1, nonce },
        { ...sender, ...changed }
      )
    ).toMatchObject({ ok: false })
    expect(mocks.page).not.toHaveBeenCalled()
  }
)
it("distinguishes a resume service failure from an expired panel without leaking the error", async () => {
  const { nonce, sender } = await launch()
  mocks.page.mockRejectedValueOnce(new Error("private response details"))
  const failed = await request(
    { type: "af.state", protocolVersion: 1, nonce },
    sender
  )
  expect(failed).toMatchObject({ ok: false, code: "service" })
  expect(JSON.stringify(failed)).not.toContain("private response details")
  expect((await state(nonce, sender)).resumes).toHaveLength(1)
  expect(chrome.windows.create).not.toHaveBeenCalled()
})
it("reports account refresh failure with reconnect guidance", async () => {
  const { nonce, sender } = await launch()
  mocks.account.mockRejectedValueOnce(
    new Error("private authentication details")
  )
  const failed = await request(
    { type: "af.state", protocolVersion: 1, nonce },
    sender
  )
  expect(failed).toMatchObject({ ok: false, code: "auth" })
  expect(JSON.stringify(failed)).not.toContain("private authentication details")
})
it("allows a delayed in-page registration and retry without opening another window", async () => {
  const { nonce, sender } = await launch()
  await vi.advanceTimersByTimeAsync(10_000)
  await state(nonce, sender)
  await state(nonce, sender)
  expect(chrome.windows.create).not.toHaveBeenCalled()
  expect(chrome.windows.update).not.toHaveBeenCalled()
})
it("never opens a fallback window when toolbar injection is blocked", async () => {
  const background = await import("../src/autofill/background")
  sendMessage.mockRejectedValue(new Error("No access"))
  vi.mocked(chrome.scripting.executeScript).mockRejectedValue(
    new Error("No access")
  )
  await background.openAutofill(tab)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(chrome.windows.create).not.toHaveBeenCalled()
  expect(
    Object.keys(saved).filter((key) => key.startsWith("autofill:launch:"))
  ).toEqual([])
})
it.each([false, true])(
  "rejects a navigated application document with existing registration %s",
  async (registered) => {
    const { nonce, sender } = await launch()
    if (registered) await state(nonce, sender)
    currentDocument = "replacement"
    expect(
      await request(
        { type: "af.start", protocolVersion: 1, nonce, resumeId },
        sender
      )
    ).toMatchObject({ ok: false })
    expect(mocks.prepare).not.toHaveBeenCalled()
  }
)
it("binds Fill to the current main document and rejects a different frame", async () => {
  const { nonce, sender } = await launch()
  expect(
    await request(
      { type: "af.start", protocolVersion: 1, nonce, resumeId, frameId: 2 },
      sender
    )
  ).toBeUndefined()
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  expect(SessionSchema.parse(saved["autofill:session:1"])).toMatchObject({
    tabId: 1,
    frameId: 0,
    documentId: "document",
  })
  expect(chrome.tabs.update).not.toHaveBeenCalled()
  expect(chrome.windows.update).not.toHaveBeenCalled()
})
it("automatically uploads and fills in one run without persisting PDF bytes", async () => {
  const { nonce, sender } = await launch()
  const completed = new Set<string>()
  const pdf = Buffer.from("%PDF-1.4\nsynthetic resume\n%%EOF")
  mocks.pdf.mockResolvedValue({
    sourceStamp,
    filename: "resume.pdf",
    base64: pdf.toString("base64"),
    byteLength: pdf.byteLength,
    sha256: createHash("sha256").update(pdf).digest("hex"),
  })
  const fields = (): FieldSnapshot[] =>
    ["resume", "email"].map((id) => ({
      fieldId: id,
      fieldRevision: 1,
      guardRef: id,
      userEditEpoch: 0,
      label: id === "resume" ? "Resume" : "Email",
      control: id === "resume" ? "file" : "text",
      description: "",
      section: "Application",
      attributes: {},
      constraints: { required: false },
      state: {
        visible: true,
        editable: true,
        empty: !completed.has(id),
        hasUserValue: completed.has(id),
        validationState: "unknown",
        truncated: false,
      },
      capabilities: {
        adapterId: "native-v1",
        read: true,
        write: true,
        verify: true,
        discover: false,
        search: false,
        scroll: false,
      },
    }))
  sendMessage.mockImplementation(async (_tabId, raw) => {
    const message = envelope.parse(raw)
    const response = {
      ok: true,
      requestId: message.requestId,
      generation: message.generation,
    }
    if (message.type === "af.observe")
      return {
        ...response,
        observation: {
          forms: [{ id: "form", label: "Application", fields: 2 }],
          uncovered: false,
          snapshot: {
            schemaVersion: 1,
            snapshotId: "snapshot",
            documentEpoch: 1,
            formRevision: 1,
            formId: "form",
            formLabel: "Application",
            fields: fields(),
            groups: [],
            coverage: "complete",
            coverageReasons: [],
            observedAt: new Date().toISOString(),
          },
        },
      }
    if (message.type === "af.execute") {
      const command = ContentCommandSchema.parse(raw)
      if (command.type !== "af.execute") throw new Error("Expected execute")
      const { action, file } = command
      if (action.op === "upload_resume")
        expect(file?.base64).toBe(pdf.toString("base64"))
      else expect(file).toBeUndefined()
      completed.add(action.fieldId)
      return {
        ...response,
        result: {
          actionId: action.actionId,
          fieldId: action.fieldId,
          status: "filled",
          reasonCode: "accepted",
          verification: "accepted",
          durationMs: 1,
          observedFieldRevision: 1,
        },
      }
    }
    return response
  })
  mocks.plan.mockImplementation(async (raw) => {
    const input = PlanInputSchema.parse(raw)
    expect(input.automation).toBe("automatic")
    expect(input.selections).toEqual([])
    const actions: FillAction[] = input.snapshot.fields
      .filter((f) => f.state.empty)
      .map((f) => {
        const base = {
          actionId: crypto.randomUUID(),
          decisionId: crypto.randomUUID(),
          fieldId: f.fieldId,
          fieldRevision: 1,
          guardRef: f.guardRef,
          userEditEpoch: 0,
          precondition: "empty" as const,
        }
        return f.control === "file"
          ? { ...base, op: "upload_resume", mimeType: "application/pdf" }
          : {
              ...base,
              op: "set_text",
              value: "applicant@example.test",
              format: "email",
            }
      })
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      generation: input.generation,
      snapshotId: input.snapshot.snapshotId,
      decisions: [],
      attempts: 0,
      policy: reviewPolicy(),
      plan: {
        schemaVersion: 1,
        planId: crypto.randomUUID(),
        sessionId: input.sessionId,
        generation: input.generation,
        sourceStamp: input.sourceStamp,
        target: input.target,
        snapshotId: input.snapshot.snapshotId,
        documentEpoch: 1,
        formRevision: 1,
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        actions,
        interactions: [],
      },
    }
  })
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  expect(completed).toEqual(new Set(["resume", "email"]))
  expect(mocks.pdf).toHaveBeenCalledOnce()
  expect((await state(nonce, sender)).session?.status).toBe("completed")
  expect(JSON.stringify(saved)).not.toContain(pdf.toString("base64"))
})
it("pauses when the application tab is no longer active without refocusing it", async () => {
  const { nonce, sender } = await launch()
  getTab.mockResolvedValue({ ...tab, active: false })
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  expect((await state(nonce, sender)).session?.status).toBe("paused")
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(chrome.tabs.update).not.toHaveBeenCalled()
  expect(chrome.windows.update).not.toHaveBeenCalled()
})
it("restores a worker session paused, with no sensitive review or action replay", async () => {
  const { nonce, sender } = await launch()
  await state(nonce, sender)
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  const persisted = SessionSchema.parse(saved["autofill:session:1"])
  expect(persisted.observation).toBeNull()
  expect(persisted.decisions).toEqual([])
  const priorCalls = sendMessage.mock.calls.length
  vi.resetModules()
  const restarted = await import("../src/autofill/background")
  restarted.registerAutofill()
  expect((await state(nonce, sender)).session?.status).toBe("paused")
  expect(sendMessage.mock.calls.length).toBe(priorCalls)
})
it("keeps stopping until the exact cancellation generation is acknowledged", async () => {
  const { nonce, sender } = await launch()
  await state(nonce, sender)
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  sendMessage.mockImplementation(async () => ({ ok: true, generation: -1 }))
  await request({ type: "af.cancel", protocolVersion: 1, nonce }, sender)
  expect((await state(nonce, sender)).session?.status).toBe("stopping")
  expect(
    await request({ type: "af.continue", protocolVersion: 1, nonce }, sender)
  ).toMatchObject({ ok: false })
  expect(mocks.plan).not.toHaveBeenCalled()
})
it("clears another account's stored context instead of reusing its source", async () => {
  const { nonce, sender } = await launch()
  await state(nonce, sender)
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  mocks.account.mockResolvedValue({ id: "other", email: "other@example.test" })
  const next = await state(nonce, sender)
  expect(next.session).toBeNull()
  expect(next.preselected).toBeNull()
  expect(saved["autofill:session:1"]).toBeUndefined()
})
it("rejects delayed continuation from an earlier session generation", async () => {
  const { nonce, sender } = await launch()
  await state(nonce, sender)
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  expect(
    await request(
      { type: "af.continue", protocolVersion: 1, nonce, generation: 0 },
      sender
    )
  ).toMatchObject({ ok: false })
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
})
it("closing the panel preserves application context and invalidates the panel registration", async () => {
  const { nonce, sender } = await launch()
  await request(
    { type: "af.start", protocolVersion: 1, nonce, resumeId },
    sender
  )
  await vi.advanceTimersByTimeAsync(1)
  await request({ type: "af.close", protocolVersion: 1, nonce }, sender)
  const commands = sendMessage.mock.calls.map(
    ([, raw]) => envelope.parse(raw).type
  )
  expect(commands.indexOf("af.cancel")).toBeLessThan(
    commands.indexOf("af.release")
  )
  expect(SessionSchema.parse(saved["autofill:session:1"]).status).toBe("paused")
  expect(
    await request({ type: "af.state", protocolVersion: 1, nonce }, sender)
  ).toMatchObject({ ok: false })
})
it("invalidates earlier panels when the toolbar opens a fresh instance", async () => {
  const { nonce, sender } = await launch()
  await state(nonce, sender)
  const background = await import("../src/autofill/background")
  await background.openAutofill(tab)
  expect(
    await request(
      { type: "af.start", protocolVersion: 1, nonce, resumeId },
      sender
    )
  ).toMatchObject({ ok: false })
  expect(mocks.prepare).not.toHaveBeenCalled()
})

async function automatic() {
  currentUrl = "https://jobs.ashbyhq.com/example/123/application"
  const background = await import("../src/autofill/background")
  background.registerAutofill()
  const sender = {
    id: "extension",
    frameId: 0,
    documentId: currentDocument,
    tab: { ...tab, url: currentUrl },
    url: currentUrl,
  }
  const ready = { type: "af.ready", protocolVersion: 1 }
  return { background, sender, ready }
}
it("auto-opens one registered in-page panel without preparing or scanning the application", async () => {
  const { sender, ready } = await automatic()
  expect(await request(ready, sender)).toEqual({ ok: true })
  await request(ready, sender)
  await vi.advanceTimersByTimeAsync(3100)
  const commands = sendMessage.mock.calls.map(
    ([, raw]) => envelope.parse(raw).type
  )
  expect(commands.filter((type) => type === "af.bootstrap")).toHaveLength(1)
  expect(commands).not.toContain("af.observe")
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.plan).not.toHaveBeenCalled()
  expect(chrome.windows.create).not.toHaveBeenCalled()
  expect(
    Object.keys(saved).filter((key) => key.startsWith("autofill:launch:"))
  ).toHaveLength(1)
})
it("keeps a slow automatic panel available for in-page retry without opening a window", async () => {
  const { sender, ready } = await automatic()
  await request(ready, sender)
  await vi.advanceTimersByTimeAsync(5100)
  expect(
    sendMessage.mock.calls.map(([, raw]) => envelope.parse(raw).type)
  ).not.toContain("af.release")
  expect(
    Object.keys(saved).filter((key) => key.startsWith("autofill:launch:"))
  ).toHaveLength(1)
  expect(chrome.windows.create).not.toHaveBeenCalled()
})
it("does not open an automatic fallback window when injection is blocked", async () => {
  const { sender, ready } = await automatic()
  sendMessage.mockRejectedValue(new Error("Injection blocked"))
  vi.mocked(chrome.scripting.executeScript).mockRejectedValue(
    new Error("No access")
  )
  await request(ready, sender)
  await vi.advanceTimersByTimeAsync(3100)
  expect(chrome.windows.create).not.toHaveBeenCalled()
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it("rejects unregistered senders, child frames and stale automatic launches", async () => {
  const { sender, ready } = await automatic()
  expect(await request(ready, { ...sender, id: "other" })).toBeUndefined()
  expect(await request(ready, { ...sender, frameId: 3 })).toBeUndefined()
  expect(
    await request(ready, {
      ...sender,
      url: "https://jobs.ashbyhq.com.attacker.test/",
    })
  ).toBeUndefined()
  await request(ready, { ...sender, documentId: "old-document" })
  expect(sendMessage).not.toHaveBeenCalled()
})
it("keeps a closed panel dismissed across worker restarts but opens on a new document", async () => {
  const { sender, ready } = await automatic()
  await request(ready, sender)
  const key = Object.keys(saved).find((key) =>
    key.startsWith("autofill:launch:")
  )
  if (!key) throw new Error("Launch missing")
  const nonce = key.slice("autofill:launch:".length)
  const panel = {
    ...sender,
    frameId: 2,
    documentId: "panel-doc",
    url: `chrome-extension://extension/panel.html#autofill=${nonce}`,
  }
  expect(
    await request({ type: "af.close", protocolVersion: 1, nonce }, panel)
  ).toMatchObject({ ok: true })
  vi.resetModules()
  const restarted = await import("../src/autofill/background")
  restarted.registerAutofill()
  const calls = sendMessage.mock.calls.length
  await request(ready, sender)
  expect(sendMessage).toHaveBeenCalledTimes(calls)
  currentDocument = "new-document"
  await request(ready, { ...sender, documentId: currentDocument })
  expect(
    sendMessage.mock.calls
      .map(([, raw]) => envelope.parse(raw).type)
      .filter((type) => type === "af.bootstrap")
  ).toHaveLength(2)
})
it("coalesces concurrent readiness messages without resetting a panel", async () => {
  const { sender, ready } = await automatic()
  await Promise.all([request(ready, sender), request(ready, sender)])
  expect(
    sendMessage.mock.calls
      .map(([, raw]) => envelope.parse(raw).type)
      .filter((type) => type === "af.bootstrap")
  ).toHaveLength(1)
})
it("processes a new document after an earlier launch finishes", async () => {
  const { sender, ready } = await automatic()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  sendMessage.mockImplementationOnce(async () => {
    await gate
    return { protocolVersion: 1 }
  })
  const first = request(ready, sender)
  await vi.advanceTimersByTimeAsync(1)
  currentDocument = "replacement-document"
  const next = request(ready, { ...sender, documentId: currentDocument })
  release()
  await Promise.all([first, next])
  const launches = Object.entries(saved).filter(([key]) =>
    key.startsWith("autofill:launch:")
  )
  expect(launches).toHaveLength(1)
  expect(launches[0]?.[1]).toMatchObject({ documentId: "replacement-document" })
})

async function startPinnedApplication() {
  const services = createServices(inMemoryPorts())
  const resume = await services.resumes.create()
  const prepared = await services.autofill.prepare({ resumeId: resume.id })
  mocks.prepare.mockResolvedValue(prepared)
  currentUrl = "https://jobs.example.test/apply?jobId=1234&step=1"
  const launched = await launch()
  await request(
    {
      type: "af.start",
      protocolVersion: 1,
      nonce: launched.nonce,
      resumeId: resume.id,
    },
    launched.sender
  )
  await vi.advanceTimersByTimeAsync(1)
  const session = SessionSchema.parse(saved["autofill:session:1"])
  session.applicationAnswers.push({
    answerId: crypto.randomUUID(),
    applicationId: session.id,
    meaning: { concept: "contact_email" },
    conditions: {},
    value: "temporary@example.test",
    confirmed: true,
    provenance: { kind: "user" },
  })
  saved["autofill:session:1"] = session
  vi.resetModules()
  const background = await import("../src/autofill/background")
  background.registerAutofill()
  return { ...launched, session, background, resumeId: resume.id }
}

async function reopenPanel(
  background: typeof import("../src/autofill/background")
) {
  await background.openAutofill({ ...tab, url: currentUrl })
  const key = Object.keys(saved).find((key) =>
    key.startsWith("autofill:launch:")
  )
  if (!key) throw new Error("Launch missing")
  const nonce = key.slice("autofill:launch:".length)
  return {
    nonce,
    sender: {
      id: "extension",
      tab,
      frameId: 2,
      documentId: "new-panel",
      url: `chrome-extension://extension/panel.html#autofill=${nonce}`,
    },
  }
}

it("retains pinned sources and temporary answers across a confirmed application page change", async () => {
  const prior = await startPinnedApplication()
  currentDocument = "page-two"
  currentUrl = "https://jobs.example.test/apply?jobId=1234&step=2"
  const next = await reopenPanel(prior.background)
  expect((await state(next.nonce, next.sender)).session).toBeNull()
  expect((await state(next.nonce, next.sender)).preselected).toBe(
    prior.resumeId
  )
  await request(
    {
      type: "af.start",
      protocolVersion: 1,
      nonce: next.nonce,
      resumeId: prior.resumeId,
    },
    next.sender
  )
  await vi.advanceTimersByTimeAsync(1)
  const session = (await state(next.nonce, next.sender)).session
  expect(session?.id).toBe(prior.session.id)
  expect(session?.sourceSnapshot).toEqual(prior.session.sourceSnapshot)
  expect(session?.applicationAnswers).toEqual(prior.session.applicationAnswers)
  expect(session?.documentId).toBe("page-two")
  expect(session?.selections).toEqual([])
  expect(session?.overrides).toEqual([])
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
})

it.each([
  "https://jobs.example.test/apply?jobId=5678",
  "https://jobs.example.test/apply",
])(
  "starts fresh for an unconfirmed or different application: %s",
  async (url) => {
    const prior = await startPinnedApplication()
    currentDocument = "other-page"
    currentUrl = url
    const next = await reopenPanel(prior.background)
    await request(
      {
        type: "af.start",
        protocolVersion: 1,
        nonce: next.nonce,
        resumeId: prior.resumeId,
      },
      next.sender
    )
    await vi.advanceTimersByTimeAsync(1)
    const session = (await state(next.nonce, next.sender)).session
    expect(session?.id).not.toBe(prior.session.id)
    expect(session?.applicationAnswers).toEqual([])
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
  }
)

it("does not expire application answers while the application tab remains open", async () => {
  const prior = await startPinnedApplication()
  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
  const session = (await state(prior.nonce, prior.sender)).session
  expect(session?.applicationAnswers).toEqual(prior.session.applicationAnswers)
  expect(session?.sourceSnapshot).toEqual(prior.session.sourceSnapshot)
})

it("removes temporary data after a closed application tab is detected", async () => {
  const prior = await startPinnedApplication()
  getTab.mockRejectedValue(new Error("No tab"))
  await state(prior.nonce, prior.sender)
  expect(saved["autofill:session:1"]).toBeUndefined()
})

function flowField(
  fieldId: string,
  control: FieldSnapshot["control"]
): FieldSnapshot {
  return {
    fieldId,
    fieldRevision: 1,
    guardRef: fieldId,
    userEditEpoch: 0,
    label: fieldId,
    control,
    groupId: "record-group",
    description: "",
    section: "Application",
    attributes: {},
    constraints: { required: false },
    state: {
      visible: true,
      editable: true,
      empty: true,
      hasUserValue: false,
      commitState: "known",
      validationState: "valid",
      truncated: false,
    },
    capabilities: {
      adapterId: "native-v1",
      read: true,
      write: true,
      verify: true,
      discover: false,
      search: false,
      scroll: false,
    },
  }
}

async function runFlow(options: {
  fields: FieldSnapshot[]
  failedField?: string
  driftedField?: string
  record?: {
    source: import("@workspace/resume-core/contracts").SourceSnapshot
    mode: "bound" | "unbound" | "unresolved"
  }
}) {
  const launched = await launch()
  const completed = new Set<string>(
    options.record ? options.fields.map((field) => field.fieldId) : []
  )
  const counts = new Map<string, number>()
  const results = new Map<
    string,
    import("@workspace/resume-core/contracts").ActionResult
  >()
  let additions = 0
  const source = options.record?.source
  if (source) {
    mocks.page.mockResolvedValue({
      items: [
        {
          id: source.sourceStamp.resumeId,
          title: "Synthetic",
          subtitle: "",
          templateId: "lisbon",
          updatedAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    })
    mocks.prepare.mockResolvedValue({
      sourceStamp: source.sourceStamp,
      sourceSnapshot: source,
      title: "Synthetic",
      availableConcepts: [],
      missingConcepts: [],
      policy: reviewPolicy(),
    })
  }
  sendMessage.mockImplementation(async (_tabId, raw) => {
    const message = envelope.parse(raw)
    const response = {
      ok: true,
      requestId: message.requestId,
      generation: message.generation,
    }
    if (message.type === "af.observe") {
      const fields = options.fields.map((field) => ({
        ...field,
        state: {
          ...field.state,
          empty: !completed.has(field.fieldId),
          hasUserValue: completed.has(field.fieldId),
        },
      }))
      return {
        ...response,
        observation: {
          forms: [{ id: "form", label: "Application", fields: fields.length }],
          uncovered: false,
          recordEntrypoints: source
            ? [
                {
                  entryRef: "add-record",
                  entryRevision: 1,
                  kind: "experience",
                  label: "Add experience",
                },
              ]
            : [],
          snapshot: {
            schemaVersion: 1,
            snapshotId: "snapshot",
            documentEpoch: 1,
            formRevision: 1,
            formId: "form",
            formLabel: "Application",
            fields,
            groups: [
              {
                groupId: "record-group",
                kind: source ? "experience" : "other",
                label: "Experience",
              },
            ],
            coverage: "complete",
            coverageReasons: [],
            observedAt: new Date().toISOString(),
            pageView: source
              ? {
                  snapshotId: "snapshot",
                  documentEpoch: 1,
                  roots: [{ rootId: "document", kind: "document" }],
                  coverage: {
                    complete: true,
                    truncated: false,
                    unobservedFrames: 0,
                  },
                  nodes: [
                    {
                      ref: "region",
                      rootId: "document",
                      tag: "main",
                      text: "Application",
                      relations: [],
                    },
                    {
                      ref: "record-group",
                      rootId: "document",
                      parentRef: "region",
                      tag: "fieldset",
                      text: "Experience",
                      relations: [],
                    },
                    ...fields.map((field) => ({
                      ref: field.fieldId,
                      fieldId: field.fieldId,
                      rootId: "document",
                      parentRef: "record-group",
                      tag: "input",
                      text: field.label,
                      relations: [],
                    })),
                    {
                      ref: "add-record",
                      rootId: "document",
                      parentRef: "region",
                      tag: "button",
                      text: "Add experience",
                      relations: [],
                    },
                  ],
                }
              : undefined,
          },
        },
      }
    }
    if (message.type === "af.execute") {
      const command = ContentCommandSchema.parse(raw)
      if (command.type !== "af.execute") throw new Error("Expected action")
      const action = command.action
      counts.set(action.fieldId, (counts.get(action.fieldId) ?? 0) + 1)
      const failed = action.fieldId === options.failedField
      if (!failed) completed.add(action.fieldId)
      const result: import("@workspace/resume-core/contracts").ActionResult = {
        actionId: action.actionId,
        fieldId: action.fieldId,
        status: failed ? "failed" : "filled",
        reasonCode: failed ? "control_rejected" : "accepted_value",
        verification: failed ? "rejected" : "accepted",
        durationMs: 1,
        observedFieldRevision: 1,
      }
      results.set(action.fieldId, result)
      return { ...response, result }
    }
    if (message.type === "af.audit")
      return {
        ...response,
        results: [...results.values()].map((result) =>
          result.fieldId === options.driftedField
            ? {
                ...result,
                status: "unverified",
                reasonCode: "final_readback_changed",
                verification: "unobservable",
              }
            : result
        ),
      }
    if (message.type === "af.addRecord") {
      additions++
      return {
        ...response,
        changed: false,
        reasonCode: "record_group_unconfirmed",
      }
    }
    return response
  })
  mocks.plan.mockImplementation(async (raw) => {
    const input = PlanInputSchema.parse(raw)
    const firstRecord = source?.resume.sections
      .flatMap((section) => section.items)
      .find((item) => item.kind === "experience")
    const actions: FillAction[] = input.snapshot.fields
      .filter((field) => field.state.empty)
      .map((field): FillAction => {
        const base = {
          actionId: crypto.randomUUID(),
          decisionId: crypto.randomUUID(),
          fieldId: field.fieldId,
          fieldRevision: field.fieldRevision,
          guardRef: field.guardRef,
          userEditEpoch: field.userEditEpoch,
        }
        return field.control === "checkbox"
          ? { ...base, precondition: "empty", op: "set_checked", checked: true }
          : {
              ...base,
              precondition: "empty",
              op: "set_text",
              value: "Synthetic value",
              format: "plain",
            }
      })
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      generation: input.generation,
      snapshotId: input.snapshot.snapshotId,
      decisions: input.snapshot.fields.map((field) => ({
        decisionId:
          actions.find((action) => action.fieldId === field.fieldId)
            ?.decisionId ?? crypto.randomUUID(),
        fieldId: field.fieldId,
        fieldRevision: field.fieldRevision,
        label: field.label,
        status:
          options.record?.mode === "unresolved"
            ? "review"
            : field.state.empty
              ? "resolved"
              : "preserved",
        reasonCode:
          options.record?.mode === "unresolved" ? "choose_concept" : "fixture",
        recordId:
          options.record && options.record.mode !== "unbound"
            ? firstRecord?.id
            : undefined,
      })),
      attempts: 0,
      policy: reviewPolicy(),
      interpretation: source
        ? {
            snapshotId: input.snapshot.snapshotId,
            regions: [{ regionRef: "region", evidenceRefs: ["record-group"] }],
            fields: input.snapshot.fields.map((field) => ({
              fieldId: field.fieldId,
              fieldRevision: field.fieldRevision,
              regionRef: "region",
              groupId: "record-group",
              concept: "experience_company",
              requiresDraft: false,
              evidenceRefs: [field.fieldId],
            })),
            groups: [
              {
                groupId: "record-group",
                kind: "experience",
                fieldIds: input.snapshot.fields.map((field) => field.fieldId),
                evidenceRefs: ["record-group"],
              },
            ],
            excluded: [],
            needsContext: [],
            unresolvedFieldIds: [],
          }
        : undefined,
      plan: {
        schemaVersion: 1,
        planId: crypto.randomUUID(),
        sessionId: input.sessionId,
        generation: input.generation,
        sourceStamp: input.sourceStamp,
        target: input.target,
        snapshotId: input.snapshot.snapshotId,
        documentEpoch: 1,
        formRevision: 1,
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        actions,
        interactions: [],
      },
    }
  })
  await request(
    {
      type: "af.start",
      protocolVersion: 1,
      nonce: launched.nonce,
      resumeId: source?.sourceStamp.resumeId ?? resumeId,
    },
    launched.sender
  )
  await vi.advanceTimersByTimeAsync(1)
  return {
    session: (await state(launched.nonce, launched.sender)).session,
    counts,
    completed,
    additions,
  }
}

it("completes five successful checkbox writes in one group without a group rescan stop", async () => {
  const fields = Array.from({ length: 5 }, (_, index) =>
    flowField(`choice-${index}`, "checkbox")
  )
  const result = await runFlow({ fields })
  expect(result.session?.status).toBe("completed")
  expect(result.completed.size).toBe(5)
  expect([...result.counts.values()]).toEqual([1, 1, 1, 1, 1])
  expect(
    result.session?.results.every((item) => item.status === "filled")
  ).toBe(true)
})

it("skips a control after two failed attempts and fills unrelated fields", async () => {
  const result = await runFlow({
    fields: [flowField("difficult", "text"), flowField("unrelated", "text")],
    failedField: "difficult",
  })
  expect(result.session?.status).toBe("completed")
  expect(result.counts.get("difficult")).toBe(2)
  expect(result.counts.get("unrelated")).toBe(1)
  expect(
    result.session?.decisions.find((item) => item.fieldId === "difficult")
  ).toMatchObject({ status: "failed", reasonCode: "control_retry_exhausted" })
  expect(
    result.session?.results.find((item) => item.fieldId === "unrelated")?.status
  ).toBe("filled")
})

it("uses final exact audit to downgrade a changed nonempty value in the background report", async () => {
  const result = await runFlow({
    fields: [flowField("email", "text")],
    driftedField: "email",
  })
  expect(result.session?.status).toBe("completed")
  expect(result.session?.observation?.snapshot?.fields[0]?.state.empty).toBe(
    false
  )
  expect(result.session?.results[0]).toMatchObject({
    status: "unverified",
    reasonCode: "final_readback_changed",
  })
  expect(result.session?.message).toContain("1 items need your attention")
})

it.each(["bound", "unbound", "unresolved"] as const)(
  "adds a record only after its existing group is resolved and bound: %s",
  async (mode) => {
    const services = createServices(inMemoryPorts())
    const seed = await services.resumes.create()
    const document = (await services.resumes.get(seed.id)).data
    const section = document.sections.find((item) => item.type === "experience")
    const first = section?.items.find((item) => item.kind === "experience")
    if (!section || !first) throw new Error("Missing experience")
    section.items.push({ ...first, id: "exp_second", bullets: [] })
    const resume = await services.resumes.create({ document })
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    if (!prepared.sourceSnapshot) throw new Error("Missing pinned source")
    const result = await runFlow({
      fields: [flowField("employer", "text")],
      record: { source: prepared.sourceSnapshot, mode },
    })
    expect(result.session?.status).toBe("completed")
    expect(result.additions).toBe(mode === "bound" ? 1 : 0)
  }
)
