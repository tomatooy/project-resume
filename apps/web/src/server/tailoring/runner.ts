import type { Services } from "@workspace/resume-core"
import { createLogger, withLogContext } from "../log"

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
  return withLogContext({ operationId: id }, async () => {
    const log = createLogger()
    try {
      for (const name of [
        "claim",
        "parse",
        "generate",
        "commit",
      ] satisfies TailorStep[]) {
        await checkpoint(name, async () => {
          const startedAt = performance.now()
          try {
            const operations = (await services()).operations
            if (name === "claim") await operations.claim(id)
            else if (name === "parse") await operations.parse(id)
            else if (name === "generate") await operations.generate(id)
            else await operations.complete(id)
            log.info("tailoring_step_finished", {
              step: name,
              latencyMs: Math.round(performance.now() - startedAt),
            })
            return { id }
          } catch (error) {
            log.error(
              "tailoring_step_failed",
              {
                step: name,
                latencyMs: Math.round(performance.now() - startedAt),
              },
              error
            )
            throw new Error(`Tailoring ${name} failed`)
          }
        })
      }
    } catch (error) {
      log.error("tailoring_failed", undefined, error)
      try {
        await (await services()).operations.fail(id, "generation_failed")
      } catch (failure) {
        log.error("tailoring_reconcile_failed", undefined, failure)
        /* Fresh caller credentials reconcile expiry. */
      }
      throw new Error("Tailoring attempt did not complete")
    }
    return { operationId: id }
  })
}
