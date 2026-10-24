import {
  type JobIdentity,
  JobIdentitySchema,
  linkedinExtensionPage,
} from "@workspace/resume-core/contracts"
import { queued } from "../tab-state"

export const originKey = (tabId: number) => `origin:${tabId}`

/** A tab opened from a LinkedIn job page remembers that job (spec 15.2). */
async function recordOrigin(tabId: number, sourceTabId: number): Promise<void> {
  const source = await chrome.tabs.get(sourceTabId)
  const page = linkedinExtensionPage(source.url ?? "")
  if (page.kind !== "job") return
  await queued(tabId, () =>
    chrome.storage.session.set({ [originKey(tabId)]: page.identity })
  )
}

export function registerOrigin(): void {
  chrome.webNavigation.onCreatedNavigationTarget.addListener(
    ({ sourceTabId, tabId }) => {
      void recordOrigin(tabId, sourceTabId).catch(() => {})
    }
  )
}

/** The job the tab was opened from, given once: to its first session. */
export function takeOrigin(tabId: number): Promise<JobIdentity | null> {
  return queued(tabId, async () => {
    const key = originKey(tabId)
    const values = await chrome.storage.session.get(key)
    if (!(key in values)) return null
    await chrome.storage.session.remove(key)
    const parsed = JobIdentitySchema.safeParse(values[key])
    return parsed.success ? parsed.data : null
  })
}
