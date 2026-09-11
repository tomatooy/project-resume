import {
  CheckFitOutputSchema,
  type LoadSkillOutput,
  LoadSkillOutputSchema,
  PlanOutputSchema,
  type ProposeOutput,
  ProposeOutputSchema,
  type ProposedSuggestion,
  type TurnPlan,
  TurnPlanSchema,
  validateForRun,
} from "@workspace/resume-core"
import type { Resume, ResumePatch } from "@workspace/resume-schema"
import { tool } from "ai"
import { z } from "zod"

import { SKILL_IDS, findSkills, skillOfId } from "./skills/index"

/** Stores the valid patches for the run and returns them with their ids. */
export type PersistProposal = (
  valid: ResumePatch[]
) => Promise<ProposedSuggestion[]>

/**
 * What the tools agree on for one turn.
 *
 * This is the whole of the run's mutable state. Nothing here gates a tool:
 * `allowStructural` decides whether a structural patch is accepted (the same
 * value is recorded on the run, so accept time agrees), and `loadedSkillIds`
 * exists so a second load of one playbook does not silently double its tokens.
 */
export type TurnState = {
  loadedSkillIds: string[]
  selectedNodeId?: string
  /** The composer's hint. Advisory: the model may ignore it. */
  hintSkillId?: string
  allowStructural: boolean
}

/** The tool set every step of every turn sees, in order. */
export const TOOL_NAMES = [
  "plan",
  "find_skills",
  "load_skill",
  "check_fit",
  "propose_patches",
] as const

/**
 * No `execute`: the browser renders the document and answers with the page
 * count, then sends the conversation back for the next step.
 */
export const checkFitTool = tool({
  description:
    "Render the resume with the given patches applied and return the page count. Use when the user gives a page target or asks whether the resume fits.",
  inputSchema: z.object({ patches: z.array(z.unknown()).max(50) }),
  outputSchema: CheckFitOutputSchema,
})

/**
 * Searches the playbook library by name, when-to-use and body text. Returns
 * one line per hit, never a body: the body is what `load_skill` is for. A
 * query that matches nothing returns the index instead of an empty list, so a
 * model that guessed the wrong words still finds its way.
 */
const findSkillsTool = tool({
  description:
    "Search the playbook library when you are not sure which playbook fits. Returns ids, names and when-to-use lines, never the playbook text.",
  inputSchema: z.object({
    query: z.string().max(200),
    limit: z.number().int().min(1).max(8).optional(),
  }),
  outputSchema: z.object({
    skills: z.array(
      z.object({ id: z.string(), name: z.string(), whenToUse: z.string() })
    ),
    total: z.number().int(),
  }),
  execute: async ({ query, limit }) => {
    const hits = findSkills(query, limit ?? 4)
    return {
      skills: hits.map(({ id, name, whenToUse }) => ({ id, name, whenToUse })),
      total: hits.length,
    }
  },
})

/** The tools that need this run: its state, its document and its record. */
export type ToolDeps = {
  runId: string
  resume: Resume
  state: TurnState
  persist: PersistProposal
  /** Records the line the turn planned with. */
  recordPlan: (plan: TurnPlan) => Promise<void>
  /** Appends a playbook the turn loaded to the run row. */
  addSkill: (id: string) => Promise<void>
}

/**
 * The turn's playbook limit.
 *
 * A vague request may legitimately want several playbooks, and `load_skill`
 * already takes a list, so the wide turn is possible without new tools. Each
 * body costs tokens on every step after it loads, which is why this is a
 * number rather than "as many as apply": the prompt states it and this tool
 * enforces it, so the two cannot drift.
 */
export const MAX_PLAYBOOKS_PER_TURN = 3

/**
 * Says what the turn is about to do, in one sentence, before it does it. The
 * line is recorded on the run and shown as the turn's opening line, which is
 * also why it is the auditable form of the model's reasoning: the private
 * thinking channel never leaves the server.
 *
 * Optional now, on purpose. Nothing gates on it, and the prompt no longer
 * requires it first, so a single small change can skip it and a multi-part
 * turn can call it in the same step as `load_skill` instead of paying a round
 * trip for the sentence.
 */
function planTool(deps: ToolDeps) {
  return tool({
    description:
      "Say what this turn is about to do, in one sentence. Worth calling when the turn does more than one thing, and best called in the same step as `load_skill`; skip it for a single small change.",
    inputSchema: TurnPlanSchema,
    outputSchema: PlanOutputSchema,
    execute: async ({ summary }) => {
      const plan: TurnPlan = { summary }
      await deps.recordPlan(plan)
      return plan
    },
  })
}

/**
 * Puts a playbook's text in the next step's context. Idempotent: an id already
 * loaded comes back under `alreadyLoaded` with no body, and the run records
 * the id before the tool returns, so a continuation cannot lose it. Unknown
 * ids are answered, not thrown, and `validIds` is the whole library.
 *
 * The turn's limit is checked here rather than left to the prompt: ids past it
 * come back under `overCap` unwritten, the same way an unknown id is answered
 * instead of refused. Loading is what costs tokens, so this is where the
 * ceiling has to be real.
 */
function loadSkillTool(deps: ToolDeps) {
  return tool({
    description:
      "Load one or more playbooks by id, up to three in a turn. Their text is added to your context for the rest of this turn. Loading a playbook changes nothing about what you may do; it only tells you how to do it well.",
    inputSchema: z.object({
      ids: z.array(z.string().max(64)).min(1).max(4),
    }),
    outputSchema: LoadSkillOutputSchema,
    execute: async ({ ids }) => {
      const loaded: LoadSkillOutput["loaded"] = []
      const unknown: string[] = []
      const alreadyLoaded: string[] = []
      const overCap: string[] = []
      for (const id of ids) {
        const skill = skillOfId(id)
        if (!skill) {
          unknown.push(id)
          continue
        }
        // The repeat check runs first: an id this turn already holds is not
        // what the cap refused, and answering it as `overCap` would tell the
        // model to stop using a playbook it already has.
        if (deps.state.loadedSkillIds.includes(id)) {
          alreadyLoaded.push(id)
          continue
        }
        if (deps.state.loadedSkillIds.length >= MAX_PLAYBOOKS_PER_TURN) {
          overCap.push(id)
          continue
        }
        deps.state.loadedSkillIds.push(id)
        await deps.addSkill(id)
        loaded.push({ id: skill.id, name: skill.name, body: skill.body })
      }
      return {
        loaded,
        unknown,
        alreadyLoaded,
        overCap,
        validIds: [...SKILL_IDS],
      }
    },
  })
}

/**
 * The single mutation path.
 *
 * The deterministic gate between the model and the database. Whatever the
 * model sends goes through `validatePatches`; only what survives is stored,
 * and the model is told exactly what was refused and why. `summary` is
 * required of the model and optional on the stored schema, because rows
 * written before the field existed still have to parse.
 */
function proposePatchesTool(deps: ToolDeps) {
  return tool({
    description:
      "Submit the final list of patches for a turn that changes the resume. Call it once at the end, after any check_fit calls, and only when there is something to change. `summary` is the one sentence the user reads above the cards; `gaps` names what is missing, and `followUpQuestion` asks for the single most useful one.",
    inputSchema: z.object({
      patches: z.array(z.unknown()).max(50),
      gaps: z.array(z.string().max(300)).max(20).optional(),
      followUpQuestion: z.string().max(500).optional(),
      summary: z.string().min(1).max(300),
    }),
    outputSchema: ProposeOutputSchema,
    execute: async ({ patches, gaps, followUpQuestion, summary }) => {
      const { valid, rejected } = validateForRun(deps.resume, patches, {
        mode: "propose",
        allowStructural: deps.state.allowStructural,
        selectedNodeId: deps.state.selectedNodeId,
      })
      const suggestions = await deps.persist(valid)
      const output: ProposeOutput = {
        runId: deps.runId,
        suggestions,
        rejected,
        gaps: gaps ?? [],
        summary,
      }
      if (followUpQuestion) output.followUpQuestion = followUpQuestion
      return output
    },
  })
}

/** Everything the model may call, built once per run and never re-gated. */
export type AgentTools = {
  plan: ReturnType<typeof planTool>
  find_skills: typeof findSkillsTool
  load_skill: ReturnType<typeof loadSkillTool>
  check_fit: typeof checkFitTool
  propose_patches: ReturnType<typeof proposePatchesTool>
}

export function buildTools(deps: ToolDeps): AgentTools {
  return {
    plan: planTool(deps),
    find_skills: findSkillsTool,
    load_skill: loadSkillTool(deps),
    check_fit: checkFitTool,
    propose_patches: proposePatchesTool(deps),
  }
}
