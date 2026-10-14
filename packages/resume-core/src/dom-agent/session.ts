/** Stands in for an application the page did not identify. */
export const UNKNOWN_APPLICATION = "unknown"

/**
 * Key for one application's temporary answers and pinned sources. Account,
 * tab and application identity all take part: the same host is not enough to
 * inherit anything, and closing the tab or signing out drops the entry.
 */
export function temporaryStateKey(input: {
  accountId: string
  tabId: number
  applicationKey: string | null
}): string {
  return `domagent:${input.accountId}:${input.tabId}:${input.applicationKey ?? UNKNOWN_APPLICATION}`
}

export function isTemporaryStateKey(key: string): boolean {
  return key.startsWith("domagent:")
}

/** The prefix for one account, so signing out can clear every tab at once. */
export function accountStatePrefix(accountId: string): string {
  return `domagent:${accountId}:`
}
