/**
 * Sanitises the `next` parameter carried through sign-in.
 *
 * A redirect target that arrives in a URL is attacker-controlled. Anything that
 * is not a plain absolute path on this origin is discarded, which rules out
 * `https://elsewhere.example` and the `//elsewhere.example` form that browsers
 * also read as a host.
 */
export const DEFAULT_NEXT = "/dashboard"

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_NEXT
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_NEXT
  return value
}
