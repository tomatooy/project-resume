import { z } from "zod"

/**
 * Run states. `reasoning` work and `auditing` are different things, and a run
 * that ran out of budget or evidence is `incomplete`, never `ready`.
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
  running: ["observing", "needs_input", "auditing", "paused", "cancelled"],
  needs_input: ["running", "auditing", "paused", "cancelled"],
  // Continue always re-observes first, so a paused run never resumes a plan.
  paused: ["observing", "cancelled"],
  auditing: ["ready", "incomplete", "running", "paused", "cancelled"],
  ready: ["auditing", "cancelled"],
  incomplete: ["running", "auditing", "paused", "cancelled"],
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
