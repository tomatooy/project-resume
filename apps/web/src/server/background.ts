import type { Background } from "@workspace/resume-core"

import { errorClassOf, type Logger } from "./log"

/**
 * On Workers, a promise that nobody awaits is cancelled when the response
 * ends, so consolidation has to be handed to `waitUntil`. The import is
 * dynamic because the module only exists inside workerd: under Vitest and
 * plain Node the import rejects and the task simply runs to completion on its
 * own, which is the right behaviour in both places.
 */
export function createBackground(log: Logger): Background {
  return {
    run(task) {
      const settled = task().catch((error: unknown) => {
        log.error("background_failed", { errorClass: errorClassOf(error) })
      })
      void extend(settled)
    },
  }
}

async function extend(promise: Promise<void>): Promise<void> {
  try {
    const { waitUntil } = await import("cloudflare:workers")
    waitUntil(promise)
  } catch {
    // Not on Workers. The promise is already running.
  }
}
