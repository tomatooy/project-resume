import type { Services } from "@workspace/resume-core"

export type TailorStep = "claim" | "parse" | "generate" | "commit"
export type Checkpoint = (
  name: TailorStep,
  work: () => Promise<{ id: string }>
) => Promise<void>

export async function runTailoring(
  id: string,
  checkpoint: Checkpoint,
  services: () => Promise<Services>
): Promise<{ operationId: string }> {
  try {
    for (const name of [
      "claim",
      "parse",
      "generate",
      "commit",
    ] satisfies TailorStep[]) {
      await checkpoint(name, async () => {
        try {
          const operations = (await services()).operations
          if (name === "claim") await operations.claim(id)
          else if (name === "parse") await operations.parse(id)
          else if (name === "generate") await operations.generate(id)
          else await operations.complete(id)
          return { id }
        } catch {
          throw new Error(`Tailoring ${name} failed`)
        }
      })
    }
  } catch {
    try {
      await (await services()).operations.fail(id, "generation_failed")
    } catch {
      /* Fresh caller credentials reconcile expiry. */
    }
    throw new Error("Tailoring attempt did not complete")
  }
  return { operationId: id }
}
