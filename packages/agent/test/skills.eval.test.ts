// @vitest-environment node
import type { CustomSkill } from "@workspace/resume-core"
import { describe, expect, it } from "vitest"

import { buildSystemPrompt } from "../src/prompts/base"
import { SKILL_IDS, skillIndexLines } from "../src/skills/catalog"
import { findSkills, resolveSkills, skillOfId } from "../src/skills/index"
import { defineSkill } from "../src/skills/define"
import { SKILLS } from "../src/skills/library"
import { type CaseResult, liveEnabled, report, runCase } from "./evals/live"
import { EVAL_CASES, type EvalCase, casesByCategory } from "./evals/fixtures"
import { fixture } from "./mock"

/**
 * Playbook selection, measured two ways.
 *
 * With no model, the assertions are what the library has to guarantee for a
 * turn to be possible at all: every hint the panel can send names a playbook
 * that exists, every playbook an eval expects is one the library holds, and
 * the index the prompt shows lists each of them. Those hold in CI.
 *
 * The live half runs the same table against the model and owns the pass rates.
 * It is off unless `AGENT_EVAL=1` and a key is present.
 */
describe("the library the evals assume", () => {
  it("holds every playbook the fixtures expect", () => {
    const expected = new Set(
      EVAL_CASES.flatMap((entry) => [
        ...entry.expect.skills,
        ...(entry.expect.skillsAtLeast ?? []),
      ])
    )
    for (const id of expected) {
      expect(skillOfId(id), `fixture expects ${id}`).toBeDefined()
    }
    expect(expected.size).toBeGreaterThan(0)
  })

  it("serves every hint a fixture sends", () => {
    for (const entry of EVAL_CASES) {
      if (!entry.hintSkillId) continue
      expect(skillOfId(entry.hintSkillId), `${entry.name}`).toBeDefined()
    }
  })

  it("lists each playbook once, with a body to load", () => {
    const lines = skillIndexLines(SKILLS)
    for (const id of SKILL_IDS) {
      expect(lines.filter((line) => line.startsWith(`- ${id}:`))).toHaveLength(
        1
      )
      const skill = skillOfId(id)
      expect(skill?.body.length).toBeGreaterThan(80)
      expect(skill?.name.length).toBeGreaterThan(0)
      expect(skill?.description.length).toBeGreaterThan(0)
    }
  })
})

/**
 * The library a turn actually sees once the user's overlay is applied. The
 * evals pin the built-in library, so these are the pieces that keep a custom
 * or disabled skill from quietly changing what the table measures.
 */
describe("the library after an overlay", () => {
  const custom: CustomSkill = {
    id: "usr_11111111-1111-4111-8111-111111111111",
    category: "editor",
    name: "Terse sentences",
    description: "Make sentences shorter.",
    whenToUse: "The prose is wordy and the user wants it shorter.",
    notFor: "Adding detail.",
    body: "Prefer one clause per sentence.",
    createdAt: "2026-09-12T00:00:00.000Z",
  }

  it("discovers skills by description without when to use", () => {
    const skills = resolveSkills({
      custom: [
        {
          ...custom,
          description: "Specialized zephyr phrasing.",
          whenToUse: undefined,
        },
      ],
      disabledIds: [],
    })
    const found = findSkills(skills, "zephyr", 1)[0]
    expect(found?.id).toBe(custom.id)
    expect(found?.whenToUse).toBeUndefined()
    expect(skillIndexLines(skills)).toContain(
      `- ${custom.id}: ${custom.name}. Specialized zephyr phrasing.`
    )
    if (!found) throw new Error("skill not found")
    expect(() => defineSkill(found)).not.toThrow()
  })

  it("drops a disabled playbook from the index and from find_skills", () => {
    const skills = resolveSkills({
      custom: [],
      disabledIds: ["bullet_rewrite"],
    })

    expect(skills.map((skill) => skill.id)).not.toContain("bullet_rewrite")
    expect(
      skillIndexLines(skills).some((line) =>
        line.startsWith("- bullet_rewrite:")
      )
    ).toBe(false)
    expect(
      findSkills(skills, "make my bullets punchier", 4).map((skill) => skill.id)
    ).not.toContain("bullet_rewrite")
  })

  it("indexes a custom playbook and finds it", () => {
    const skills = resolveSkills({ custom: [custom], disabledIds: [] })

    expect(skillIndexLines(skills)).toContain(
      `- ${custom.id}: ${custom.name}. ${custom.description} When to use: ${custom.whenToUse}`
    )
    expect(
      findSkills(skills, "terse wording", 4).map((skill) => skill.id)
    ).toContain(custom.id)
  })

  it("says the library is empty rather than listing nothing", () => {
    const prompt = buildSystemPrompt({
      state: { loadedSkillIds: [], allowStructural: false },
      resume: fixture().resume,
      summaryText: null,
      skills: [],
    })

    expect(prompt).toContain("No playbooks are available for this turn.")
  })
})

describe("find_skills", () => {
  /** The playbook a bare search should surface first for the fixture's words. */
  const firstHit: Partial<Record<EvalCase["category"], [string, string]>> = {
    single: ["make my bullets punchier", "bullet_rewrite"],
    hint: ["cut this down so it fits on one page", "condense_to_pages"],
    override: ["fix the grammar instead", "grammar_clarity"],
  }

  it.each(Object.entries(firstHit))(
    "ranks the right playbook first for a %s-style query",
    (_category, [query, expected]) => {
      expect(findSkills(SKILLS, query, 4)[0]?.id).toBe(expected)
    }
  )

  /** The playbooks added after the first four own their own words too. */
  const ownWords: [string, string][] = [
    ["add metrics and numbers to the bullets", "resume_quantifier"],
    ["optimize this for a software engineering role", "tech_resume_optimizer"],
  ]

  it.each(ownWords)("ranks %s first", (query, expected) => {
    expect(findSkills(SKILLS, query, 4)[0]?.id).toBe(expected)
  })

  it("returns the index rather than nothing when the words match no playbook", () => {
    // Nonsense tokens, so the result is decided by the fallback and not by a
    // word that happens to appear in some playbook's body.
    const hits = findSkills(SKILLS, "zxqv wqpn bbzx", 4)
    expect(hits.map((skill) => skill.id)).toEqual(SKILL_IDS.slice(0, 4))
  })
})

/**
 * The table is the acceptance criteria for selection, so a fixture that no
 * longer describes a case the library can serve is a broken eval rather than a
 * model failure. These guard the fixtures themselves.
 */
describe("the fixture table", () => {
  it("covers every category with at least one case", () => {
    for (const category of [
      "single",
      "hint",
      "override",
      "combination",
      "broad",
      "question",
      "noop",
      "structural",
      "fit",
      "selection",
    ] as const) {
      expect(casesByCategory(category).length, category).toBeGreaterThan(0)
    }
  })

  it("gives every broad row a floor instead of a set", () => {
    // A vague request cannot assert an exact set without inventing one, so its
    // rows name a minimum. A row with neither would pass on an empty turn.
    const broad = casesByCategory("broad")
    expect(broad.length).toBeGreaterThan(0)
    for (const entry of broad) {
      expect(entry.expect.skills, entry.name).toEqual([])
      expect(
        entry.expect.skillsAtLeast?.length ?? 0,
        entry.name
      ).toBeGreaterThan(0)
    }
  })

  it("asks a no-tool case for no playbook and no patch", () => {
    const quiet = EVAL_CASES.filter((entry) => entry.expect.noTools)
    expect(quiet.length).toBeGreaterThan(0)
    for (const entry of quiet) {
      expect(entry.expect.skills, entry.name).toEqual([])
      expect(entry.expect.ops ?? [], entry.name).toEqual([])
    }
  })

  it("asks nothing at all of the requests it expects to refuse", () => {
    // `refuses` is the flag-off twin of a structural request: the turn wanted
    // to add or drop a whole entry, so with the gate shut it must come back
    // empty rather than with a thinner edit it was not asked for.
    const gate = EVAL_CASES.filter((entry) => entry.refuses)
    expect(gate.length).toBeGreaterThan(0)
    for (const entry of gate) {
      expect(entry.structural, entry.name).toBe(false)
      expect(entry.expect.ops ?? [], entry.name).toEqual([])
    }
  })

  it("expects the structural op once the flag was on", () => {
    for (const entry of casesByCategory("structural")) {
      if (!entry.structural) continue
      expect(entry.expect.ops ?? [], entry.name).not.toEqual([])
    }
  })

  it("expects no patches of a question with no edits in it", () => {
    for (const entry of casesByCategory("question")) {
      if (entry.message.includes("posting")) continue
      expect(entry.expect.ops ?? []).toHaveLength(0)
    }
  })
})

/**
 * The live table.
 *
 * One test rather than one per case: the model is asked the whole table in a
 * pass, and the assertion is per category. A single case going wrong is a
 * finding to read, not a red build, which is what the floors are for.
 */
describe.skipIf(!liveEnabled)("the live model", () => {
  it("clears every category's floor", async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY ?? ""
    const results: CaseResult[] = []
    for (const entry of EVAL_CASES) {
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
  }, 900_000) // The whole table against the network, one turn at a time.
})
