/** Self-contained because Chrome serializes the injected function. */
function applicationControl(
  sourceUrl: string,
  jobId: string,
  open: boolean
): boolean | string {
  if (location.href !== sourceUrl) return false
  const controls = document.querySelectorAll(
    '.jobs-apply-button, [data-job-details-apply-button], a[data-tracking-control-name="public_jobs_apply-link-offsite"]'
  )
  for (const control of controls) {
    if (
      !(control instanceof HTMLButtonElement) &&
      !(control instanceof HTMLAnchorElement)
    )
      continue
    const controlJobId = control
      .closest("[data-job-id]")
      ?.getAttribute("data-job-id")
    if (controlJobId && controlJobId !== jobId) continue
    if (
      control.matches(':disabled, [aria-disabled="true"]') ||
      control.closest("[hidden], [inert]") ||
      control.getClientRects().length === 0 ||
      getComputedStyle(control).visibility !== "visible"
    )
      continue
    const label = `${control.textContent ?? ""} ${control.getAttribute("aria-label") ?? ""}`
    if (/easy\s+apply/i.test(label)) continue
    if (control instanceof HTMLAnchorElement) {
      const url = new URL(control.href, location.href)
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.href === location.href ||
        !control.getAttribute("href") ||
        control.getAttribute("href")?.startsWith("#")
      )
        continue
      if (open) return url.href
    }
    if (open) control.click()
    return true
  }
  return false
}

export async function jobApplication(
  tabId: number,
  sourceUrl: string,
  jobId: string,
  open = false
): Promise<boolean> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: applicationControl,
    args: [sourceUrl, jobId, open],
  })
  if (typeof result?.result === "string") {
    await chrome.tabs.create({ url: result.result })
    return true
  }
  return result?.result === true
}
