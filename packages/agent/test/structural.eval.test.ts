// @vitest-environment node
import { ROOT_PARENT, type ResumePatch } from "@workspace/resume-schema"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it, vi } from "vitest"

import type { TurnState } from "../src/tools"
import { runTurn } from "../src/turn"
import { type CaseResult, liveEnabled, report, runCase } from "./evals/live"
import { casesByCategory } from "./evals/fixtures"
import { fixture, testModels, toolCallStream } from "./mock"

/**
 * The tier gate, measured on the real loop.
 *
 * The one thing the model cannot do is decide that a structural request was
 * asked for: the flag rides on the request and on the run row, and
 * `validateForRun` refuses a structural patch without it. These cases pin that
 * by proposing the same patch twice, once per flag, and reading what the tool
 * answered. A bullet delete and a bullet add are here next to the structural
 * cases because the boundary is the point: too tight and ordinary editing
 * needs a toggle, too loose and the flag means nothing.
 *
 * The live half of the table runs only with `AGENT_EVAL=1` and a key, because
 * it needs the network and a model that decides for itself.
 */
const { resume, bullet, otherBullet } = fixture()
const section = resume.sections[0]
if (!section?.items[0]) throw new Error("fixture has no first section")

const LIVE = liveEnabled

function state(allowStructural: boolean): TurnState {
  return { loadedSkillIds: [], allowStructural }
}

/** Runs one turn that proposes `patch` and returns what the tool answered. */
async function propose(patch: ResumePatch, allowStructural: boolean) {
  const model = new MockLanguageModelV3({
    doStream: [
      toolCallStream("propose_patches", {
        patches: [patch],
        summary: "One change.",
      }),
    ],
  })
  const persist = vi.fn(async (valid: ResumePatch[]) =>
    valid.map((entry, ordinal) => ({
      id: `s${ordinal}`,
      ordinal,
      patch: entry,
    }))
  )
  const { result } = runTurn({
    state: state(allowStructural),
    resume,
    models: testModels(model),
    runId: "eval-run",
    persist,
    recordPlan: vi.fn(async () => undefined),
    addSkill: vi.fn(async () => undefined),
    memory: {
      summaryText: null,
      messages: [{ role: "user", content: "Go ahead." }],
    },
  })
  await result.consumeStream()
  const steps = await result.steps
  const output = steps[0]?.toolResults[0]?.output as
    | { suggestions: { patch: ResumePatch }[]; rejected: { code: string }[] }
    | undefined
  if (!output) throw new Error("the turn proposed nothing")
  return output
}

const deleteBullet: ResumePatch = {
  op: "delete",
  targetNodeId: bullet.id,
  before: { id: bullet.id, text: bullet.text },
  reason: "That line adds nothing.",
}

const deleteItem: ResumePatch = {
  op: "delete",
  targetNodeId: bullet.itemId,
  before: section.items[0],
  reason: "That entry is not relevant.",
}

const deleteSection: ResumePatch = {
  op: "delete",
  targetNodeId: section.id,
  before: section,
  reason: "Nothing here matches the posting.",
}

const addSection: ResumePatch = {
  op: "insert_after",
  parentId: ROOT_PARENT,
  afterNodeId: section.id,
  node: { type: "experience", title: "Volunteering", items: [] },
  reason: "Adds the volunteering the posting asks about.",
}

const addBullet: ResumePatch = {
  op: "insert_after",
  parentId: bullet.itemId,
  afterNodeId: bullet.id,
  node: { text: "Led the migration to the new platform." },
  reason: "Shows the migration the posting asks for.",
}

const moveAcrossItems: ResumePatch = {
  op: "move",
  targetNodeId: otherBullet.id,
  toParentId: bullet.itemId,
  toIndex: 0,
  reason: "That bullet belongs with this role.",
}

describe("the tier gate", () => {
  const cases: { name: string; patch: ResumePatch; structural: boolean }[] = [
    { name: "a bullet delete", patch: deleteBullet, structural: false },
    { name: "a bullet add", patch: addBullet, structural: false },
    { name: "an item delete", patch: deleteItem, structural: true },
    { name: "a section delete", patch: deleteSection, structural: true },
    { name: "a section add", patch: addSection, structural: true },
    { name: "a move across items", patch: moveAcrossItems, structural: true },
  ]

  it.each(cases)("$name with the flag off", async ({ patch, structural }) => {
    const output = await propose(patch, false)
    if (structural) {
      expect(output.suggestions).toHaveLength(0)
      expect(output.rejected).toEqual([
        expect.objectContaining({ code: "STRUCTURAL_NOT_REQUESTED" }),
      ])
    } else {
      expect(output.rejected).toHaveLength(0)
      expect(output.suggestions[0]?.patch.op).toBe(patch.op)
    }
  })

  it.each(cases)("$name with the flag on", async ({ patch }) => {
    const output = await propose(patch, true)
    expect(output.rejected).toHaveLength(0)
    expect(output.suggestions[0]?.patch.op).toBe(patch.op)
  })
})

describe.skipIf(!LIVE)("the live model on structural requests", () => {
  it("keeps the gate shut unless the turn asked for it", async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY ?? ""
    const results: CaseResult[] = []
    for (const entry of casesByCategory("structural")) {
      results.push(await runCase(entry, apiKey))
    }
    const { rates, belowFloor } = report(results)
    for (const row of rates) {
      console.log(`${row.category}: ${row.passed}/${row.total}`)
    }
    for (const failure of results.filter((entry) => !entry.passed)) {
      console.log(`  ${failure.name}: ${failure.detail}`)
    }
    expect(belowFloor).toEqual([])
  }, 600_000)
})

// A fixture with no expectation of its own is a broken eval, not a model
// failure, so the table is checked even when the live run is skipped.
describe("the structural fixtures", () => {
  it("says which flag each case was sent under", () => {
    for (const entry of casesByCategory("structural")) {
      expect(typeof entry.structural).toBe("boolean")
      expect(entry.message.length).toBeGreaterThan(0)
    }
  })

  it("names the section it wants dropped, so the case is answerable", () => {
    const names = casesByCategory("structural").map((entry) => entry.name)
    expect(names).toContain("section delete with the flag off")
    expect(names).toContain("section delete with the flag on")
  })
})
