import type { VendorAdapter } from "../types"
import { ashby } from "./ashby"
import { greenhouse } from "./greenhouse"

/**
 * Adapters by exact page host. `pages.ts` lists the same hosts but loads Zod;
 * a test keeps the two lists equal.
 */
export const HOSTS: ReadonlyMap<string, VendorAdapter> = new Map([
  ["boards.greenhouse.io", greenhouse],
  ["job-boards.greenhouse.io", greenhouse],
  ["boards.eu.greenhouse.io", greenhouse],
  ["job-boards.eu.greenhouse.io", greenhouse],
  ["jobs.ashbyhq.com", ashby],
])

/** The adapter for a page host, or null when no vendor serves it. */
export function adapterFor(hostname: string): VendorAdapter | null {
  return HOSTS.get(hostname) ?? null
}
