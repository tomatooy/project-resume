/**
 * Entry point for the DOM agent engine that replaces the autofill engine.
 * Every ticket in the replacement lands behind this status, so an unfinished
 * engine can never be selected at runtime and the retired engine is never used
 * as a fallback.
 */
export type DomAgentEngineStatus =
  | { ready: true }
  | { ready: false; reason: string }

export const domAgentEngineStatus: DomAgentEngineStatus = {
  ready: false,
  reason:
    "The page reader is being replaced. The retired engine is not used as a fallback.",
}

/** True when a fill run may start. */
export function engineCanStart(
  status: DomAgentEngineStatus = domAgentEngineStatus
): status is { ready: true } {
  return status.ready
}
