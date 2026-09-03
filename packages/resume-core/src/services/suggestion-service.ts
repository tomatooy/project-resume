import {
  applyPatches,
  canonicalJson,
  collectText,
  contentHash,
  validatePatches,
  type PatchOp,
  type ResumePatch,
} from "@workspace/resume-schema"

import { AppError } from "../domain/errors"
import { SKILL_ALLOWED_OPS, isSkillId } from "../domain/skill"
import type {
  DecideResult,
  DecisionStatus,
  Suggestion,
  SuggestionOutcome,
  SuggestionStatus,
} from "../domain/suggestion"
import type { AgentRunRepository } from "../ports/agent-run-repository"
import type { ResumeRepository } from "../ports/resume-repository"
import type {
  NewSuggestion,
  SuggestionRepository,
} from "../ports/suggestion-repository"

export type DecideSuggestionsInput = {
  runId: string
  decisions: { suggestionId: string; status: DecisionStatus }[]
}

/** Patch ops address either a target node or, for inserts, a parent. */
function addressOf(patch: ResumePatch): string {
  return patch.op === "insert_after" ? patch.parentId : patch.targetNodeId
}

/**
 * Identity of a patch for dedupe: what it does, not why. A model retrying a
 * tool call may reword its reason or confidence for the same change.
 */
function patchKey(patch: ResumePatch): string {
  const { reason: _reason, confidence: _confidence, ...rest } = patch
  return canonicalJson(rest)
}

export class SuggestionService {
  constructor(
    private readonly resumes: ResumeRepository,
    private readonly runs: AgentRunRepository,
    private readonly suggestions: SuggestionRepository
  ) {}

  /**
   * Idempotent per run: the model may call `propose_patches` more than once
   * in one loop (a rejected batch followed by a corrected one), so patches
   * already stored are kept and only additions are inserted. The full list is
   * returned so the tool output is complete regardless of which call it was.
   */
  async persistProposal(
    runId: string,
    patches: ResumePatch[]
  ): Promise<Suggestion[]> {
    const run = await this.runs.findById(runId)
    if (!run) throw new AppError("NOT_FOUND", "Run not found")

    const existing = await this.suggestions.listForRun(runId)
    const seen = new Set(existing.map((s) => patchKey(s.patch)))
    let ordinal = existing.reduce((max, s) => Math.max(max, s.ordinal + 1), 0)

    const rows: NewSuggestion[] = []
    for (const patch of patches) {
      const key = patchKey(patch)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ ordinal: ordinal++, patch, targetNodeId: addressOf(patch) })
    }

    const inserted =
      rows.length > 0
        ? await this.suggestions.insertMany(runId, run.resumeId, rows)
        : []
    return [...existing, ...inserted].sort((a, b) => a.ordinal - b.ordinal)
  }

  /**
   * Applies the accepted suggestions to the head as it stands now.
   *
   * The re-validation here is what makes `stale` real: a suggestion was checked
   * against the document as it looked when it was proposed, and the user may
   * have edited that bullet since. Anything whose `before` no longer matches is
   * marked stale rather than silently overwriting the newer text.
   */
  async decide(input: DecideSuggestionsInput): Promise<DecideResult> {
    const run = await this.runs.findById(input.runId)
    if (!run) throw new AppError("NOT_FOUND", "Run not found")

    const resume = await this.resumes.findById(run.resumeId)
    if (!resume) throw new AppError("NOT_FOUND", "Resume not found")

    const stored = await this.suggestions.listForRun(input.runId)
    const byId = new Map(stored.map((s) => [s.id, s]))

    for (const decision of input.decisions) {
      const suggestion = byId.get(decision.suggestionId)
      if (!suggestion) {
        throw new AppError(
          "VALIDATION",
          `Unknown suggestion ${decision.suggestionId}`
        )
      }
      if (suggestion.status !== "pending") {
        throw new AppError(
          "VALIDATION",
          `Suggestion ${decision.suggestionId} was already decided`
        )
      }
    }

    const status = new Map<string, Exclude<SuggestionStatus, "pending">>()
    for (const decision of input.decisions) {
      status.set(decision.suggestionId, decision.status)
    }

    // Ordinal order, because patches were proposed as a sequence and a later
    // one may depend on an earlier one having landed.
    const accepted = input.decisions
      .filter((d) => d.status === "accepted")
      .map((d) => byId.get(d.suggestionId) as Suggestion)
      .sort((a, b) => a.ordinal - b.ordinal)

    let head = resume.data
    let version: DecideResult["version"]
    let revision = resume.revision
    let updatedAt = resume.updatedAt

    if (accepted.length > 0) {
      const patches = accepted.map((s) => s.patch)
      const validation = validatePatches(head, patches, {
        allowedOps: this.allowedOpsFor(run.skillId),
        // Grounding was decided when the suggestion was proposed, against the
        // user's message and the job description. Neither is retained past the
        // run, so re-deriving grounding text from the resume alone would reject
        // numbers that were legitimately sourced. Feeding the stored patches
        // back in makes rule 10 a no-op here while every other rule, including
        // the `before` match that produces `stale`, still applies.
        groundingText: [
          ...collectText(head),
          ...patches.map((patch) => JSON.stringify(patch)),
        ].join("\n"),
      })

      const rejectedIndices = new Set(validation.rejected.map((r) => r.index))
      const survivors: Suggestion[] = []
      accepted.forEach((suggestion, index) => {
        if (rejectedIndices.has(index)) {
          status.set(suggestion.id, "stale")
        } else {
          survivors.push(suggestion)
        }
      })

      if (survivors.length > 0) {
        const applied = applyPatches(
          head,
          survivors.map((s) => s.patch)
        )
        // `applyPatches` reports failures by patch identity, so a patch that
        // passed validation but could not land still ends up stale rather than
        // being reported as accepted.
        const failed = new Set(applied.failed.map((f) => f.patch))
        for (const suggestion of survivors) {
          if (failed.has(suggestion.patch)) status.set(suggestion.id, "stale")
        }

        if (applied.applied.length > 0) head = applied.resume
      }
    }

    const changed = head !== resume.data
    const outcome = await this.suggestions.decide({
      runId: input.runId,
      decisions: input.decisions.map((d) => ({
        suggestionId: d.suggestionId,
        status: status.get(d.suggestionId) ?? d.status,
      })),
      newContent: changed ? head : null,
      contentHash: changed ? await contentHash(head) : null,
    })

    revision = outcome.revision
    updatedAt = outcome.updatedAt
    if (outcome.version) version = outcome.version

    const results: SuggestionOutcome[] = input.decisions.map((d) => ({
      suggestionId: d.suggestionId,
      status: status.get(d.suggestionId) ?? d.status,
    }))

    return { head, revision, updatedAt, version, results }
  }

  /**
   * The op whitelist is re-applied on the server at accept time, from the skill
   * recorded on the run. Trusting a client-supplied list would let a caller
   * accept a delete that the skill was never allowed to propose.
   */
  private allowedOpsFor(skillId: string): PatchOp[] {
    if (!isSkillId(skillId)) {
      throw new AppError("VALIDATION", `Unknown skill ${skillId}`)
    }
    return SKILL_ALLOWED_OPS[skillId]
  }
}
