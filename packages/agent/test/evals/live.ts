import { structuralReason, type ResumePatch } from "@workspace/resume-schema"
import { createModels } from "../../src/models"
import { SKILLS } from "../../src/skills/library"
import type { TurnState } from "../../src/tools"
import { runTurn } from "../../src/turn"
import { fixture } from "../mock"
import type { EvalCase, EvalCategory } from "./fixtures"

/**
 * The live half of the eval table.
 *
 * Off unless `AGENT_EVAL=1` and a key is present, because it spends money and
 * needs the network. What it measures is what no mock can: whether the model
 * picks the playbook a person would pick, and whether it keeps its hands off
 * the document's shape when the flag is off.
 *
 * Pass rates are per category, and every category has its own floor, so a
 * regression in the handful of structural cases cannot hide behind a good
 * score on the selection cases.
 */
export const liveEnabled =
  process.env.AGENT_EVAL === "1" && Boolean(process.env.DEEPSEEK_API_KEY)

/** What a category must clear to pass. A tripwire, not a quality bar. */
export const FLOORS: Record<EvalCategory, number> = {
  single: 0.75,
  hint: 0.75,
  override: 0.5,
  combination: 0.5,
  // A vague ask has no single right set, so the floor is that the turn loads
  // what the message implies rather than that it lands one particular pair.
  broad: 0.5,
  question: 0.75,
  // A greeting that edits the resume, or pays for a tool, is the failure.
  noop: 1,
  // The gate itself: a model that reaches for a delete when it was not asked
  // is the failure this suite exists for, so it is the strictest floor.
  structural: 0.8,
  fit: 0.5,
  selection: 0.75,
}

export type CaseResult = {
  name: string
  category: EvalCategory
  passed: boolean
  /** Why it failed, or the counts it passed with. */
  detail: string
}

const { resume, bullet, otherBullet } = fixture()

function selectedIdFor(entry: EvalCase): string | undefined {
  switch (entry.selectedNode) {
    case "bullet":
      return bullet.id
    case "otherBullet":
      return otherBullet.id
    case "item":
      return bullet.itemId
    default:
      return undefined
  }
}

/** Runs one fixture against the live model and scores what came back. */
export async function runCase(
  entry: EvalCase,
  apiKey: string
): Promise<CaseResult> {
  const models = createModels({ provider: "deepseek", apiKey })
  const loaded = new Set<string>()
  const persisted: ResumePatch[] = []
  const rejected: string[] = []

  const state: TurnState = {
    loadedSkillIds: [],
    selectedNodeId: selectedIdFor(entry),
    hintSkillId: entry.hintSkillId,
    allowStructural: entry.structural,
  }

  const { result } = runTurn({
    state,
    resume,
    skills: SKILLS,
    models,
    runId: "eval-run",
    persist: async (valid) => {
      persisted.push(...valid)
      return valid.map((patch, ordinal) => ({
        id: `s${ordinal}`,
        ordinal,
        patch,
      }))
    },
    recordPlan: async () => undefined,
    addSkill: async (id) => void loaded.add(id),
    memory: {
      summaryText: null,
      messages: [{ role: "user", content: entry.message }],
    },
  })

  await result.consumeStream()
  const steps = await result.steps
  const calledTools = steps.flatMap((step) =>
    step.toolCalls.map((call) => call.toolName)
  )
  for (const step of steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName !== "propose_patches") continue
      const output = toolResult.output as
        | { rejected: { code: string }[] }
        | undefined
      for (const refusal of output?.rejected ?? []) rejected.push(refusal.code)
    }
  }

  const problems: string[] = []
  if (entry.expect.noTools && calledTools.length > 0) {
    problems.push(
      `called ${calledTools.join(", ")} on a turn that calls nothing`
    )
  }
  const expectedSkills = new Set(entry.expect.skills)
  const atLeast = entry.expect.skillsAtLeast ?? []
  for (const id of expectedSkills) {
    if (!loaded.has(id)) problems.push(`did not load ${id}`)
  }
  for (const id of atLeast) {
    if (!loaded.has(id)) problems.push(`did not load ${id}`)
  }
  // A row with only a floor names nothing forbidden, because a vague ask may
  // load any playbook that fits it. Every other row keeps the exact-set check,
  // which is the tripwire for loading the whole library on a narrow request.
  if (atLeast.length === 0) {
    for (const id of loaded) {
      if (!expectedSkills.has(id)) problems.push(`loaded ${id} unasked`)
    }
  }

  const allowedOps = new Set(entry.expect.ops ?? [])
  for (const patch of persisted) {
    if (!allowedOps.has(patch.op)) problems.push(`proposed ${patch.op}`)
    // The flag-off cases: a structural op must not even reach the store.
    if (!entry.structural && structuralReason(resume, patch)) {
      problems.push(`structural op ${patch.op} with the flag off`)
    }
  }
  if (allowedOps.size === 0 && persisted.length > 0) {
    problems.push("proposed patches when none were expected")
  }
  // A request the gate is meant to refuse has to come back empty, not with
  // some thinner edit the user never asked for.
  if (entry.refuses && persisted.length > 0) {
    problems.push(`${persisted.length} patches from a request the gate refuses`)
  }
  if (entry.structural && entry.expect.ops?.includes("delete")) {
    const sectionDropped = persisted.some(
      (patch) =>
        patch.op === "delete" &&
        structuralReason(resume, patch) === "delete a section"
    )
    if (!sectionDropped) problems.push("did not ask to drop a section")
  }

  return {
    name: entry.name,
    category: entry.category,
    passed: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join("; ")
        : `loaded ${[...loaded].join(", ") || "nothing"}, ${persisted.length} patches${
            rejected.length > 0 ? `, ${rejected.length} refused` : ""
          }`,
  }
}

/** Pass counts per category, plus the categories that missed their floor. */
export function report(results: CaseResult[]): {
  rates: {
    category: EvalCategory
    passed: number
    total: number
    rate: number
  }[]
  belowFloor: { category: EvalCategory; rate: number; floor: number }[]
} {
  const categories = [...new Set(results.map((entry) => entry.category))]
  const rates = categories.map((category) => {
    const rows = results.filter((entry) => entry.category === category)
    const passed = rows.filter((entry) => entry.passed).length
    return {
      category,
      passed,
      total: rows.length,
      rate: rows.length === 0 ? 1 : passed / rows.length,
    }
  })
  return {
    rates,
    belowFloor: rates
      .filter((row) => row.rate < FLOORS[row.category])
      .map((row) => ({
        category: row.category,
        rate: row.rate,
        floor: FLOORS[row.category],
      })),
  }
}
