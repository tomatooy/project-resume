import type { VendorAdapter } from "../types"

/** Adapters by exact page host. `pages.ts` lists the same hosts but loads Zod. */
const HOSTS = new Map<string, VendorAdapter>()

/** The adapter for a page host, or null when no vendor serves it. */
export function adapterFor(hostname: string): VendorAdapter | null {
  return HOSTS.get(hostname) ?? null
}
