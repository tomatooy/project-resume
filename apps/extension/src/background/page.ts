import { categoryOf, classifyPage, type Page } from "../lib/pages"
import { autofillFrame } from "./autofill/frames"
import { pageLocation, readTabState, type Here } from "./tab-state"

/** A company page inherits autofill support from its selected live ATS frame. */
export async function pageFor(
  tabId: number,
  url: string | undefined
): Promise<Page> {
  const page = classifyPage(url ?? "")
  if (page.kind !== "unsupported") return page
  const frame = await autofillFrame(tabId)
  return frame ? { kind: "ats", vendor: frame.vendor } : page
}

export async function hereFor(
  tabId: number,
  url: string | undefined
): Promise<Here> {
  return {
    category: categoryOf(await pageFor(tabId, url)),
    location: pageLocation(url),
  }
}

/** An ATS iframe alone does not authorize a panel on its parent website. */
export async function hasPageHost(
  tabId: number,
  url: string | undefined
): Promise<boolean> {
  if (classifyPage(url ?? "").kind !== "unsupported") return true
  const state = await readTabState(tabId)
  if (!state.hostDocumentId) return false
  try {
    const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 })
    return (
      top?.documentLifecycle === "active" &&
      top.documentId === state.hostDocumentId
    )
  } catch {
    return false
  }
}
