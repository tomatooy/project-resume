import type { Fill } from "@workspace/autofill/fields"
import type { Owner } from "./owner"
import type { FieldHandle, WriteOutcome } from "./types"

/**
 * Writes the fills in order, one field at a time. A field that is missing,
 * owned, or (unless forced) holds a value right before its turn is skipped:
 * the user or an earlier write may have changed it.
 */
export async function writeAll(
  handles: ReadonlyMap<string, FieldHandle>,
  fills: Fill[],
  force: ReadonlySet<string>,
  owner: Owner
): Promise<Record<string, WriteOutcome>> {
  const results = new Map<string, WriteOutcome>()
  for (const fill of fills) {
    const id = fill.fieldId
    if (results.has(id)) continue
    const handle = handles.get(id)
    if (!handle || owner.isOwned(id) || (!force.has(id) && handle.hasValue())) {
      results.set(id, "skipped")
      continue
    }
    owner.markOurs(id)
    const outcome = await handle.write(fill).catch((): WriteOutcome => "failed")
    // A failed write may leave part of its value, or land late; either is
    // ours, not the user's. Skipped and unmatched leave the field as it was.
    if (outcome === "skipped" || outcome === "unmatched") owner.release(id)
    results.set(id, outcome)
  }
  // fromEntries keeps an id such as "__proto__" as a plain key.
  return Object.fromEntries(results)
}
