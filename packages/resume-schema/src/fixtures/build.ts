import type { NodeIdPrefix } from "../schema"

/**
 * Fixture ids are deterministic so snapshot tests and page-count expectations
 * stay stable across runs. Production ids come from `newId` instead.
 */
export function fid(prefix: NodeIdPrefix, key: string): string {
  const slug = key.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 10)
  return `${prefix}_${slug.padEnd(10, "0")}`
}

export function bullets(
  keyPrefix: string,
  texts: string[]
): { id: string; text: string }[] {
  return texts.map((text, i) => ({ id: fid("bul", `${keyPrefix}${i}`), text }))
}
