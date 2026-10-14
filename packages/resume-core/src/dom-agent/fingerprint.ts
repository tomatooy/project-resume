/**
 * Ordering and hashing used by anything that has to come out identical
 * wherever it is computed. Both are deliberately free of the host locale and
 * of any runtime-provided randomness.
 */

/** Code-unit order, never the host locale. */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * 64-bit FNV-1a over two independent seeds, in hex. Non-cryptographic by
 * design: this is an identity, not a signature, and the population it sorts is
 * one applicant's own questions and sources.
 */
export function fingerprint(input: string): string {
  const high = fnv1a32(input, 0x811c9dc5)
  const low = fnv1a32(input, 0x9e3779b9)
  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`
}

/** Join parts into a canonical string: one part per line, in a fixed order. */
export function canonical(parts: readonly string[]): string {
  return parts.join("\n")
}
