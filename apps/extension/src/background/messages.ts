import { z } from "zod"
import { linkedinExtensionPage } from "@workspace/resume-core/contracts"
import { JobPostingSchema } from "@workspace/api/contract"
import { account, connect, disconnect } from "../lib/auth"
import { api } from "../lib/api"
import { config } from "../lib/config"
import {
  MessageSchema,
  ResumePageMessageSchema,
  type Message,
  type Snapshot,
} from "../lib/messages"
import { autofillVendor } from "../lib/pages"
import { act, autofillSnapshot } from "./autofill/controller"
import { activePage } from "./navigation"
import { locate, readTabState, view } from "./tab-state"

function panelSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL("panel.html")
  )
}
/** An embedded panel is trusted only where its tab currently shows the panel. */
export async function trustedPanel(
  sender: chrome.runtime.MessageSender
): Promise<boolean> {
  if (!panelSender(sender)) return false
  if (!sender.tab) return true
  if ((sender.frameId ?? 0) <= 0 || sender.tab.id === undefined) return false
  const state = await readTabState(sender.tab.id)
  return view(state, locate(sender.tab.url)) === "panel"
}
const isNotFound = (error: unknown) =>
  z.object({ code: z.literal("NOT_FOUND") }).safeParse(error).success

export async function snapshot(tabId?: number): Promise<Snapshot> {
  const { tab, page } = await activePage(tabId)
  const user = await account()
  const result: Snapshot = {
    tabId: tabId ?? null,
    page,
    account: user,
    lookup: null,
    resumes: [],
    nextResumeCursor: null,
    lastBaseId: null,
    autofill: null,
  }
  const autofillTab = tabId ?? tab?.id
  if (user && autofillVendor(page) !== null && autofillTab !== undefined) {
    result.autofill = await autofillSnapshot(autofillTab)
    const first = await api.resumes.page({})
    result.resumes = first.items
    result.nextResumeCursor = first.nextCursor
    // The picker lists the session's resume even when it is on a later page.
    const picked = result.autofill.resume?.id
    if (picked && !result.resumes.some((r) => r.id === picked)) {
      try {
        result.resumes.push(await api.resumes.summary({ id: picked }))
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }
    return result
  }
  if (!user || page.kind !== "job") return result
  result.lookup = await api.jobs.lookup(page.identity)
  if (result.lookup.kind === "none") {
    const first = await api.resumes.page({})
    result.resumes = first.items
    result.nextResumeCursor = first.nextCursor
    const key = `base:${user.id}`
    const values = await chrome.storage.local.get(key)
    const remembered = z.uuid().safeParse(values[key])
    if (
      remembered.success &&
      !result.resumes.some((r) => r.id === remembered.data)
    ) {
      try {
        result.resumes.push(await api.resumes.summary({ id: remembered.data }))
      } catch (error) {
        if (!isNotFound(error)) throw error
        await chrome.storage.local.remove(key)
      }
    }
    result.lastBaseId =
      result.resumes.find((r) => r.id === values[key])?.id ?? null
  }
  return result
}
class CaptureError extends Error {}
async function requestKey(accountId: string, jobId: string, action: string) {
  const storageKey = `request:${accountId}:${jobId}:${action}`
  const stored = await chrome.storage.local.get(storageKey)
  const parsed = z.uuid().safeParse(stored[storageKey])
  const key = parsed.success ? parsed.data : crypto.randomUUID()
  await chrome.storage.local.set({ [storageKey]: key })
  return { key, storageKey }
}
const mutations = new Map<number | undefined, Promise<Snapshot>>()
export async function handleMessage(
  message: Message,
  tabId?: number
): Promise<Snapshot> {
  if (message.type === "state") return snapshot(tabId)
  // Outside the lock: a pass can take 25 s, and the controller runs one at a time.
  if (message.type === "autofill") {
    await act(await autofillTab(tabId), message.action)
    return snapshot(tabId)
  }
  const pending = mutations.get(tabId)
  if (pending) return pending
  const mutation = execute(message, tabId)
  mutations.set(tabId, mutation)
  try {
    return await mutation
  } finally {
    mutations.delete(tabId)
  }
}
/** The tab an autofill action is for: the panel's own, or the active one. */
async function autofillTab(tabId?: number): Promise<number> {
  if (!(await account())) throw new Error("Connect your account")
  const { tab, page } = await activePage(tabId)
  const id = tabId ?? tab?.id
  if (id === undefined || autofillVendor(page) === null)
    throw new Error("The page changed. Try again.")
  return id
}
async function execute(
  message: Exclude<Message, { type: "state" | "autofill" }>,
  tabId?: number
): Promise<Snapshot> {
  if (message.type === "connect") {
    await connect()
    return snapshot(tabId)
  }
  if (message.type === "disconnect") {
    await disconnect()
    return snapshot(tabId)
  }
  if (message.type === "open-app") {
    const { appOrigin } = config()
    await chrome.tabs.create({
      url: message.section
        ? `${appOrigin}/autofill#${message.section}`
        : appOrigin,
    })
    return snapshot(tabId)
  }
  const user = await account()
  if (!user) throw new Error("Connect your account")
  const current = await activePage()
  if (
    current.page.kind !== "job" ||
    (tabId !== undefined && current.tab?.id !== tabId) ||
    current.page.identity.externalJobId !== message.identity.externalJobId ||
    !current.tab?.id
  )
    throw new Error("The selected job changed. Try again.")
  const found = await api.jobs.lookup(message.identity)
  if (message.type === "edit") {
    if (found.kind !== "bound" || found.resumeId !== message.resumeId)
      throw new Error("Resume is no longer available")
    await chrome.tabs.create({
      url: `${config().appOrigin}/r/${found.resumeId}/edit`,
    })
  } else if (message.type === "cancel") {
    if (found.kind !== "bound" || found.operation.id !== message.operationId)
      return snapshot(tabId)
    await api.operations.cancel({ operationId: message.operationId })
  } else if (message.type === "retry") {
    const request = await requestKey(
      user.id,
      message.identity.externalJobId,
      message.operationId
    )
    await api.jobs.retry({
      ...message.identity,
      expectedOperationId: message.operationId,
      idempotencyKey: request.key,
    })
    await chrome.storage.local.remove(request.storageKey)
  } else {
    if (found.kind === "bound") return snapshot(tabId)
    const request = await requestKey(
      user.id,
      message.identity.externalJobId,
      "create"
    )
    const posting = await api.jobs
      .fetchPosting(message.identity)
      .catch((error: unknown) => {
        const unreadable = z
          .object({ code: z.enum(["NOT_FOUND", "VALIDATION"]) })
          .safeParse(error)
        if (unreadable.success) throw new CaptureError()
        throw error
      })
    const fetched = JobPostingSchema.safeParse(posting)
    if (!fetched.success) throw new CaptureError()
    const latest = await activePage()
    const fetchedPage = linkedinExtensionPage(fetched.data.url)
    if (
      latest.tab?.id !== current.tab.id ||
      latest.page.kind !== "job" ||
      latest.page.identity.externalJobId !== message.identity.externalJobId ||
      fetchedPage.kind !== "job" ||
      fetchedPage.identity.externalJobId !== message.identity.externalJobId
    )
      throw new CaptureError()
    // Identity may change while OAuth refresh or fetching is in flight.
    if ((await account())?.id !== user.id)
      throw new Error("Account changed. Try again.")
    try {
      await api.jobs.tailor({
        ...message.identity,
        sourceResumeId: message.sourceResumeId,
        sourceUrl: fetched.data.url,
        jobText: fetched.data.text,
        idempotencyKey: request.key,
      })
    } catch (error) {
      const definite = z
        .object({ code: z.enum(["NOT_FOUND", "CONFLICT", "VALIDATION"]) })
        .safeParse(error)
      if (definite.success)
        await chrome.storage.local.remove(request.storageKey)
      throw error
    }
    await chrome.storage.local.set({
      [`base:${user.id}`]: message.sourceResumeId,
    })
    await chrome.storage.local.remove(request.storageKey)
  }
  return snapshot(tabId)
}
export async function resumePageForAccount(
  input: z.infer<typeof ResumePageMessageSchema>
) {
  if ((await account())?.id !== input.accountId)
    throw new Error("Account changed. Try again.")
  const page = await api.resumes.page({ cursor: input.cursor })
  if ((await account())?.id !== input.accountId)
    throw new Error("Account changed. Try again.")
  return page
}
const untrusted = {
  ok: false,
  code: "unavailable",
  message: "Open VS:Résumé from the toolbar to continue.",
}
async function pageOf(tabId?: number) {
  try {
    return (await activePage(tabId)).page
  } catch {
    return undefined
  }
}
export function registerMessages() {
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (!panelSender(sender)) return false
    const pageRequest = ResumePageMessageSchema.safeParse(raw)
    const parsed = MessageSchema.safeParse(raw)
    if (!pageRequest.success && !parsed.success) return false
    const tabId = sender.tab?.id
    void (async () => {
      if (!(await trustedPanel(sender).catch(() => false))) {
        respond(untrusted)
        return
      }
      if (pageRequest.success) {
        try {
          respond({
            ok: true,
            page: await resumePageForAccount(pageRequest.data),
          })
        } catch {
          respond({
            ok: false,
            code: "unavailable",
            message: "Could not load resumes. Try again.",
          })
        }
        return
      }
      if (!parsed.success) return
      try {
        respond({ ok: true, snapshot: await handleMessage(parsed.data, tabId) })
      } catch (error) {
        const capture = error instanceof CaptureError
        const auth =
          z.object({ code: z.literal("UNAUTHENTICATED") }).safeParse(error)
            .success ||
          (error instanceof Error && /sign|account/i.test(error.message))
        const rate = z
          .object({
            data: z.object({ retryAfterSeconds: z.number().optional() }),
          })
          .safeParse(error)
        respond({
          ok: false,
          code: capture ? "capture" : auth ? "auth" : "unavailable",
          message: capture
            ? "Could not read the job description. Try again."
            : auth
              ? "Connect your account again to continue."
              : "Could not reach VS:Résumé. Try again.",
          retryAfterSeconds: rate.success
            ? rate.data.data.retryAfterSeconds
            : undefined,
          page: await pageOf(tabId),
        })
      }
    })()
    return true
  })
}
