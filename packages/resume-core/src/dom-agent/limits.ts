/**
 * Resource ceilings for one page run. These are limits, not expected values:
 * a run that reaches one reports what is left rather than claiming success.
 */
export const DOM_AGENT_LIMITS = {
  /** One page run, excluding time spent waiting for the user. */
  pageRunMs: 120_000,
  /** One reasoning request. */
  reasoningRequestMs: 30_000,
  /** One control interaction. */
  controlInteractionMs: 8_000,
  /** One upload or render operation. */
  uploadMs: 30_000,
  /** Model rounds in one page run. */
  reasoningRounds: 6,
  /** Context reads for one question. */
  contextReadsPerQuestion: 3,
  /** Serialized observation payload. */
  observationBytes: 49_152,
  /** Nodes in one observation. */
  observationNodes: 1000,
  /** Regions in one observation. */
  observationRegions: 40,
  /** Corrective attempts after a control fails. */
  correctiveAttemptsPerControl: 2,
  /** Questions in one reasoning request. */
  questionsPerRequest: 32,
  /** Actions in one batch. */
  actionsPerBatch: 24,
} as const
