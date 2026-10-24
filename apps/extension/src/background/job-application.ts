/** Self-contained because Chrome serializes the injected function. */
async function applicationControl(
  sourceUrl: string,
  jobId: string
): Promise<boolean | string> {
  const selector =
    '.jobs-apply-button, [data-job-details-apply-button], a[data-tracking-control-name="public_jobs_apply-link-offsite"], a[aria-label="Apply on company website"], #topbar-apply, [data-modal="job-details-topcard-apply-modal"]'
  const inspect = (): boolean | string | null => {
    if (location.href !== sourceUrl) return false
    const named = [...document.querySelectorAll("button, a")].filter(
      (control) =>
        control.closest("[data-job-id]")?.getAttribute("data-job-id") ===
          jobId &&
        [control.textContent, control.getAttribute("aria-label")].some(
          (label) =>
            /^(?:easy )?apply(?: now| on company website)?$/i.test(
              (label ?? "").replace(/\s+/g, " ").trim()
            )
        )
    )
    const controls = new Set([...document.querySelectorAll(selector), ...named])
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
        (control instanceof HTMLButtonElement &&
          control.form !== null &&
          control.type === "submit") ||
        control.closest('[hidden], [inert], [role="dialog"], dialog') ||
        control.getClientRects().length === 0 ||
        getComputedStyle(control).visibility !== "visible"
      )
        continue
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
        return url.href
      }
      control.click()
      return true
    }
    return null
  }
  const found = inspect()
  if (found !== null) return found
  // LinkedIn can mount its Apply control after the panel is ready.
  return new Promise((resolve) => {
    const finish = (result: boolean | string) => {
      observer.disconnect()
      clearTimeout(timeout)
      resolve(result)
    }
    const observer = new MutationObserver(() => {
      const result = inspect()
      if (result !== null) finish(result)
    })
    const timeout = setTimeout(() => finish(false), 5000)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  })
}

export async function jobApplication(
  tabId: number,
  sourceUrl: string,
  jobId: string
): Promise<boolean> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: applicationControl,
    args: [sourceUrl, jobId],
  })
  if (typeof result?.result === "string") {
    await chrome.tabs.create({ url: result.result })
    return true
  }
  return result?.result === true
}
