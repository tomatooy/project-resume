import type { Resume } from "./schema"

/**
 * Deterministic JSON with object keys sorted, so two structurally equal resumes
 * always hash the same regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sort(value))
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort)
  if (value === null || typeof value !== "object") return value
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const out: Record<string, unknown> = {}
  for (const [key, v] of entries) out[key] = sort(v)
  return out
}

/**
 * sha256 hex of the canonical JSON, via Web Crypto so the same function runs in
 * the browser, the Worker, and Node 20+.
 */
export async function contentHash(resume: Resume): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(resume))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
