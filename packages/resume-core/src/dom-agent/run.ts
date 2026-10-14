import { z } from "zod"

/**
 * Run states. `reasoning` work and `auditing` are different things, and a run
 * that ran out of budget or evidence is `incomplete`, never `ready`.
 *
 * The table below is the one statement of which moves exist, and the run
 * enforces it rather than restating it: a state the engine cannot reach is an
 * error, not a checkpoint nobody can act on.
 */
export const RunStateSchema = z.enum([
  "observing",
  "running",
  "needs_input",
  "paused",
  "auditing",
  "ready",
  "incomplete",
  "cancelled",
])

export type RunState = z.infer<typeof RunStateSchema>

const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  observing: ["running", "paused", "cancelled"],
  // `incomplete` is reachable straight from `running`: the ceiling is checked
  // while the run is dispatching, not only once a pass has ended.
  running: [
    "observing",
    "needs_input",
    "auditing",
    "incomplete",
    "paused",
    "cancelled",
  ],
  // Every state a pass can end in allows both of the moves a run makes from a
  // verdict: `observing` because a continue observes again rather than resuming
  // anything, and `paused` because an interruption is a stop wherever the run
  // happened to be. A verdict is about one pass, never the end of the run.
  needs_input: ["observing", "running", "auditing", "paused", "cancelled"],
  paused: ["observing", "cancelled"],
  auditing: [
    "observing",
    "ready",
    "incomplete",
    "running",
    "paused",
    "cancelled",
  ],
  ready: ["observing", "auditing", "paused", "cancelled"],
  incomplete: ["observing", "running", "auditing", "paused", "cancelled"],
  cancelled: [],
}

export const RUN_TRANSITIONS = TRANSITIONS

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(state: RunState): boolean {
  return TRANSITIONS[state].length === 0
}

/** States from which the user, not the engine, is the blocker. */
export function isWaitingForUser(state: RunState): boolean {
  return state === "needs_input" || state === "paused"
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to))
    throw new Error(`A run cannot move from ${from} to ${to}`)
}
