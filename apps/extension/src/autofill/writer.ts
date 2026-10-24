import type { Fill } from "@workspace/autofill/fields"
import { fillText, traceTable } from "./debug"
import type { Owner } from "./owner"
import type { FieldHandle, ResolveLocation, WriteOutcome } from "./types"

/** Why a write ended as it did, for the trace. */
const WHY: Record<WriteOutcome, string> = {
  written: "",
  skipped: "the driver does not write this kind of field",
  unmatched: "no option on the page has the wanted label",
  failed: "the page did not show the value after the write",
}

/**
 * Writes the fills in order, one field at a time. A field that is missing,
 * owned, or (unless forced) holds a value right before its turn is skipped:
 * the user or an earlier write may have changed it.
 */
export async function writeAll(
  handleFor: (id: string) => FieldHandle | undefined,
  fills: Fill[],
  force: ReadonlySet<string>,
  owner: Owner,
  resolveLocation?: ResolveLocation
): Promise<Record<string, WriteOutcome>> {
  const results = new Map<string, WriteOutcome>()
  const rows: Record<string, string>[] = []
  for (const fill of fills) {
    const id = fill.fieldId
    if (results.has(id)) continue
    const handle = handleFor(id)
    const skip = !handle
      ? "the field is no longer on the page"
      : owner.isOwned(id)
        ? "you changed it, so it is yours"
        : !force.has(id) && handle.hasValue()
          ? "it already has a value"
          : null
    const row = {
      field: handle?.descriptor.label ?? id,
      source: fill.source,
      value: fillText(fill),
    }
    if (!handle || skip !== null) {
      results.set(id, "skipped")
      rows.push({ ...row, outcome: "skipped", why: skip ?? "" })
      continue
    }
    owner.markOurs(id)
    const outcome = await handle
      .write(
        fill,
        () => owner.isOwned(id) || handleFor(id) === undefined,
        resolveLocation
      )
      .catch((): WriteOutcome => "failed")
    // A failed write may leave part of its value, or land late; either is
    // ours, not the user's. Skipped and unmatched leave the field as it was.
    if (outcome === "skipped" || outcome === "unmatched") owner.release(id)
    results.set(id, outcome)
    rows.push({ ...row, outcome, why: WHY[outcome] })
  }
  traceTable("6. wrote into the page", rows)
  // fromEntries keeps an id such as "__proto__" as a plain key.
  return Object.fromEntries(results)
}
