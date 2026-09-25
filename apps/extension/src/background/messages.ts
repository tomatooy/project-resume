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
import { activePage } from "./navigation"

export function trustedPanel(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    (!sender.tab ||
      ((sender.frameId ?? 0) > 0 &&
        sender.tab.url?.startsWith("https://www.linkedin.com/") === true)) &&
    sender.url === chrome.runtime.getURL("panel.html")
  )
}
export async function snapshot(tabId?: number): Promise<Snapshot> {
  const { page } = await activePage(tabId)
  const user = await account()
  const result: Snapshot = {
    page,
    account: user,
    lookup: null,
    resumes: [],
    nextResumeCursor: null,
    lastBaseId: null,
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
        if (
          !z.object({ code: z.literal("NOT_FOUND") }).safeParse(error).success
        )
          throw error
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
async function execute(
  message: Exclude<Message, { type: "state" }>,
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
    await chrome.tabs.create({ url: config().appOrigin })
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
export function registerMessages() {
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (!trustedPanel(sender)) return false
    const pageRequest = ResumePageMessageSchema.safeParse(raw)
    if (pageRequest.success) {
      void resumePageForAccount(pageRequest.data).then(
        (page) => respond({ ok: true, page }),
        () =>
          respond({
            ok: false,
            code: "unavailable",
            message: "Could not load resumes. Try again.",
          })
      )
      return true
    }
    const parsed = MessageSchema.safeParse(raw)
    if (!parsed.success) return false
    handleMessage(parsed.data, sender.tab?.id).then(
      (value) => respond({ ok: true, snapshot: value }),
      (error: unknown) => {
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
        })
      }
    )
    return true
  })
}
