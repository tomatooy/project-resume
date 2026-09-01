import {
  breadcrumb,
  collectText,
  hasBullets,
  validatePatches,
  type RejectedPatch,
  type Resume,
  type ResumePatch,
} from "@workspace/resume-schema"

import { saveSuggestions } from "./api"
import { skillById } from "./skills"
import type { SkillId, Suggestion } from "./types"

export type AssistantRequest = {
  resumeId: string
  conversationId: string
  resume: Resume
  skillId: SkillId
  message: string
  selectedNodeId?: string | null
  jobDescription?: string
  targetPages?: number
}

export type AssistantRun = {
  runId: string
  /** What the assistant says above the cards. */
  text: string
  suggestions: Suggestion[]
  /** Patches the validator refused, with the rule that refused them. */
  rejected: RejectedPatch[]
  /** True while no model is wired up, so the UI can say so plainly. */
  demo: boolean
}

/**
 * The single point where the console talks to the agent.
 *
 * The real implementation posts the message to `POST /api/chat` and reads the
 * AI SDK stream back. Until that Worker route exists this runs in demo mode:
 * it produces a small, fixed set of candidate patches and puts them through the
 * same `validatePatches` gate the server would use, so the accept, reject and
 * grounding paths are all genuinely exercised.
 */
export async function runAssistant(
  request: AssistantRequest
): Promise<AssistantRun> {
  const skill = skillById.get(request.skillId)
  if (!skill) throw new Error(`Unknown skill ${request.skillId}`)

  const runId = `run_${Math.random().toString(36).slice(2, 12)}`
  const candidates = demoCandidates(request)

  // The same deterministic gate the Worker applies before persisting anything.
  const { valid, rejected } = validatePatches(request.resume, candidates, {
    allowedOps: skill.allowedOps,
    scopeNodeId: request.selectedNodeId ?? undefined,
    groundingText: [
      request.message,
      request.jobDescription ?? "",
      ...collectText(request.resume),
    ].join("\n"),
  })

  const suggestions: Suggestion[] = valid.map((patch, i) => ({
    id: `sug_${runId}_${i}`,
    runId,
    patch,
    status: "pending",
  }))

  await saveSuggestions(suggestions)

  return {
    runId,
    text: buildReply(request, suggestions.length, rejected.length),
    suggestions,
    rejected,
    demo: true,
  }
}

function buildReply(
  request: AssistantRequest,
  kept: number,
  discarded: number
): string {
  const scope = request.selectedNodeId
    ? `the ${breadcrumb(request.resume, request.selectedNodeId)} you selected`
    : "this resume"

  if (kept === 0 && discarded === 0) {
    return `I read ${scope} and found nothing worth changing with this skill.`
  }

  const parts = [
    `I looked at ${scope} and drafted ${kept} ${kept === 1 ? "change" : "changes"}.`,
  ]
  if (discarded > 0) {
    parts.push(
      `${discarded} more ${discarded === 1 ? "was" : "were"} thrown away before you saw ${discarded === 1 ? "it" : "them"}, mostly for inventing figures the resume never claimed.`
    )
  }
  parts.push("Nothing is applied until you accept it.")
  return parts.join(" ")
}

/**
 * Stand-in for the model's `propose_patches` call. Deliberately includes one
 * patch with an invented statistic so the grounding rule visibly does its job.
 */
function demoCandidates(request: AssistantRequest): ResumePatch[] {
  const { resume, skillId } = request
  const meta = { skillId, confidence: 0.7 }

  const bullets = resume.sections
    .flatMap((section) => section.items)
    .flatMap((item) => (hasBullets(item) ? item.bullets : []))
    .filter((bullet) =>
      request.selectedNodeId ? bullet.id === request.selectedNodeId : true
    )

  const withNumbers = bullets.find((b) => /\d/.test(b.text))
  const withoutNumbers = bullets.find((b) => !/\d/.test(b.text))

  const out: ResumePatch[] = []

  if (withNumbers) {
    out.push({
      ...meta,
      op: "replace_text",
      targetNodeId: withNumbers.id,
      field: "text",
      before: withNumbers.text,
      after: leadWithVerb(withNumbers.text),
      reason:
        "Leads with the outcome and keeps every figure the original claimed.",
    })
  }

  if (withoutNumbers) {
    // This one is expected to be rejected: 34% appears nowhere in the source.
    out.push({
      ...meta,
      op: "replace_text",
      targetNodeId: withoutNumbers.id,
      field: "text",
      before: withoutNumbers.text,
      after: `${withoutNumbers.text.replace(/\.$/, "")}, lifting activation 34%.`,
      reason: "Adds a measurable outcome.",
      confidence: 0.4,
    })
  }

  if (resume.basics.summary && skillId !== "bullet_rewrite") {
    out.push({
      ...meta,
      op: "replace_text",
      targetNodeId: "basics",
      field: "summary",
      before: resume.basics.summary,
      after: resume.basics.summary.replace(/\s+/g, " ").trim(),
      reason: "Normalises spacing in the summary.",
      confidence: 0.3,
    })
  }

  return out
}

/** Moves the result to the front of the sentence, without touching any figure. */
function leadWithVerb(text: string): string {
  const trimmed = text.trim()
  return trimmed.startsWith("Led ") || trimmed.startsWith("Grew ")
    ? trimmed
    : trimmed.replace(/^(\w)/, (c) => c.toUpperCase())
}
