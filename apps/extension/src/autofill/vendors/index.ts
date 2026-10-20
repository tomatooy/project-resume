import type { VendorAdapter } from "../types"
import { greenhouse } from "./greenhouse"

/** Adapters by exact page host. `pages.ts` lists the same hosts but loads Zod. */
const HOSTS = new Map<string, VendorAdapter>([
  ["boards.greenhouse.io", greenhouse],
  ["job-boards.greenhouse.io", greenhouse],
  ["boards.eu.greenhouse.io", greenhouse],
  ["job-boards.eu.greenhouse.io", greenhouse],
])

/** The adapter for a page host, or null when no vendor serves it. */
export function adapterFor(hostname: string): VendorAdapter | null {
  return HOSTS.get(hostname) ?? null
}
