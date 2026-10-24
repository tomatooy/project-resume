import type { Json } from "@workspace/autofill"
import { type JudgeInput, verifiedChoice } from "@workspace/resume-core"
import { createTypeSafeClient } from "@workspace/typesafe"
import { describe, expect, it, vi } from "vitest"

import { createJudge } from "../src/autofill/jev"

const field = {
  key: "language",
  label: "Preferred programming language for interviews?",
  options: ["C++", "Java", "Python"],
}
const note =
  "## Interviews\n- Prefers TypeScript and Java for interviews.\n\n## Companies\n- Available during Quora's coordination hours."

function choice(selected: string, confidence = 0.95): Json {
  return {
    type: "choice",
    choice: selected,
    confidence,
    probabilities: {
      o1: 0.01,
      o2: 0.68,
      o3: 0.01,
      insufficient: 0.2,
      applicant: 0,
      none: 0.1,
    },
  }
}
const noul = (noul: number): Json => ({ type: "noul", noul })

function fixture(responses: (Json | Response)[]) {
  let count = 0
  const client = createTypeSafeClient({
    apiKey: "test-key",
    fetch: async () => {
      const answers = responses[count++]
      if (answers === "hang") return new Promise<Response>(() => {})
      if (answers instanceof Response) return answers
      return Response.json({
        model: "jev-test",
        answers: answers ?? {},
        usage: { input_tokens: 10, output_tokens: 2 },
      })
    },
  })
  const sent = vi.spyOn(client, "systemOne")
  const run = (context: Json, over: Partial<JudgeInput> = {}) =>
    createJudge(client)({
      context,
      signal: new AbortController().signal,
      deadline: Date.now() + 10_000,
      choices: [field],
      multi: [],
      open: [],
      ...over,
    })
  return { run, sent }
}

describe("autofill source decisions", () => {
  it("keeps a completed Profile answer when Notes exceeds its source deadline", async () => {
    vi.useFakeTimers()
    try {
      const { run } = fixture(["hang", { c_0: choice("o2") }])
      const pending = run({
        notes: note,
        profile: { preferences: { workModes: ["remote"] } },
      })
      await vi.advanceTimersByTimeAsync(8_501)
      const result = await pending
      expect(result.choices.language).toMatchObject({
        option: 1,
        source: "profile",
      })
      expect(result.degraded).toBe(true)
      expect(result.usage.inputTokens).toBe(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps full Notes separate from structured Profile state", async () => {
    const { run, sent } = fixture([
      { c_0: choice("o2") },
      { c_0: choice("insufficient") },
    ])
    const profile = {
      contact: { country: "US" },
      preferences: { noticeWeeks: 0, relocation: "no" },
    }
    const resume = {
      basics: { summary: "Python engineer" },
      sections: [
        {
          type: "education",
          title: "Education",
          items: [
            {
              school: "State-only University",
              degree: "Master of Science",
              end: "2024-12",
            },
          ],
        },
      ],
    }
    const result = await run({
      today: "2026-10-22",
      notes: note,
      profile,
      resume,
      job: { description: "JOB DISTRACTION" },
      page: { company: "IMPORTED COMPANY" },
    })
    expect(sent).toHaveBeenCalledTimes(2)
    expect(sent.mock.calls[0]?.[0].state).toEqual({ notes: note })
    const records = sent.mock.calls[1]?.[0]
    expect(records?.state).toEqual({ today: "2026-10-22", profile })
    expect(JSON.stringify(records)).not.toContain("Quora")
    expect(records?.questions.c_0?.instructions).toContain("state.profile")
    expect(JSON.stringify(records?.questions)).not.toMatch(
      /Python engineer|State-only University|Master of Science|2024-12/
    )
    expect(JSON.stringify(sent.mock.calls)).not.toMatch(
      /JOB DISTRACTION|IMPORTED COMPANY/
    )
    expect(result.choices.language).toMatchObject({
      option: 1,
      source: "notes",
      confidence: 0.95,
    })
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 4 })
  })

  it("reads Profile work history for multi-select decisions", async () => {
    const { run, sent } = fixture([{}])
    const profile = {
      preferences: { workModes: ["remote"] },
      experience: [
        {
          company: "State-only Employer",
          role: "Developer",
          start: "2023-01",
          end: "2024-12",
          bullets: [
            "Used Terraform in internal CI, no Kubernetes deployments.",
          ],
        },
      ],
    }
    await run(
      { profile },
      {
        choices: [],
        multi: [
          {
            key: "tools",
            label: "Hands-on tools?",
            options: ["Terraform", "Kubernetes"],
          },
        ],
      }
    )
    expect(sent).toHaveBeenCalledOnce()
    const request = sent.mock.calls[0]?.[0]
    expect(request?.state).toMatchObject({ profile })
    for (const key of ["m_0_0", "m_0_1"]) {
      expect(request?.questions[key]?.instructions).toContain("state.profile")
    }
    expect(JSON.stringify(request?.questions)).not.toMatch(
      /State-only Employer|2023-01|2024-12|internal CI/
    )
  })

  it("verifies a weak candidate without changing its original confidence", async () => {
    const { run, sent } = fixture([
      { c_0: choice("o2", 0.45) },
      { support_0: noul(0.97), contradiction_0: noul(0.01) },
    ])
    const result = await run({ notes: note })
    const verdict = result.choices.language
    expect(verdict).toMatchObject({
      option: 1,
      source: "notes",
      confidence: 0.45,
      verification: { support: 0.97, contradiction: 0.01 },
    })
    expect(verdict && verifiedChoice(verdict)).toBe(true)
    const verification = sent.mock.calls[1]?.[0]
    expect(verification?.state).toMatchObject({
      evidence: { v_0: { source: "notes" } },
    })
    expect(JSON.stringify(verification?.state)).toContain(
      "Prefers TypeScript and Java"
    )
    expect(JSON.stringify(verification)).not.toContain("Quora")
    for (const key of ["support_0", "contradiction_0"]) {
      expect(verification?.questions[key]?.instructions).toContain(
        "state.evidence.v_0"
      )
      expect(verification?.questions[key]?.instructions).not.toContain(
        "Prefers TypeScript and Java"
      )
    }
    expect(result.usage.inputTokens).toBe(20)
  })

  it("keeps Profile education evidence in state for both checks", async () => {
    const { run, sent } = fixture([
      { c_0: choice("o2", 0.45) },
      { support_0: noul(0.97), contradiction_0: noul(0.01) },
    ])
    const education = {
      school: "State-only University",
      degree: "Master of Science",
      end: "2024-12",
    }
    const result = await run(
      {
        profile: { education: [education] },
      },
      {
        choices: [
          {
            key: "degree",
            label: "Degree",
            options: ["Bachelor's Degree", "Master's Degree"],
          },
        ],
      }
    )
    expect(result.choices.degree).toMatchObject({
      option: 1,
      source: "profile",
      verification: { support: 0.97, contradiction: 0.01 },
    })
    const verification = sent.mock.calls[1]?.[0]
    expect(verification?.state).toMatchObject({
      evidence: {
        v_0: {
          source: "profile",
          evidence: [{ ref: "profile.education", value: [education] }],
        },
      },
    })
    for (const key of ["support_0", "contradiction_0"]) {
      expect(verification?.questions[key]?.instructions).toContain(
        "state.evidence.v_0"
      )
    }
    expect(JSON.stringify(verification?.questions)).not.toMatch(
      /State-only University|Master of Science|2024-12/
    )
  })

  it.each([
    { support: 0.89, contradiction: 0.01 },
    { support: 0.98, contradiction: 0.11 },
  ])(
    "does not accept failed verification $support / $contradiction",
    async ({ support, contradiction }) => {
      const { run } = fixture([
        { c_0: choice("o2", 0.45) },
        { support_0: noul(support), contradiction_0: noul(contradiction) },
      ])
      const verdict = (await run({ notes: note })).choices.language
      expect(verdict && verifiedChoice(verdict)).toBe(false)
    }
  )

  it("does not boost two weak agreeing choices", async () => {
    const { run, sent } = fixture([
      { c_0: choice("o2", 0.4) },
      { c_0: choice("o2", 0.45) },
      { support_0: noul(0.7), contradiction_0: noul(0.01) },
    ])
    const verdict = (
      await run({
        notes: note,
        profile: { skills: [{ label: "Languages", skills: ["Java"] }] },
      })
    ).choices.language
    expect(sent).toHaveBeenCalledTimes(3)
    expect(verdict?.confidence).toBe(0.45)
    expect(verdict && verifiedChoice(verdict)).toBe(false)
  })

  it("keeps an uncertain explicit Profile answer ahead of confident contradictory Notes", async () => {
    const { run, sent } = fixture([
      { c_0: choice("o1", 0.99) },
      { c_0: choice("o2", 0.45) },
      { support_0: noul(0.97), contradiction_0: noul(0.01) },
    ])
    const result = await run(
      {
        notes: "- Prefers hybrid work.",
        profile: { preferences: { workModes: ["remote"] } },
      },
      {
        choices: [
          {
            ...field,
            label: "Preferred work mode?",
            options: ["Hybrid", "Remote"],
          },
        ],
      }
    )
    expect(result.choices.language).toMatchObject({
      option: 1,
      source: "profile",
      confidence: 0.45,
    })
    expect(JSON.stringify(sent.mock.calls[2]?.[0])).toContain("workModes")
    expect(JSON.stringify(sent.mock.calls[2]?.[0])).not.toContain(
      "Prefers hybrid work"
    )
  })

  it.each(["insufficient", "none"])(
    "blocks fallback when a higher-priority %s result is unresolved",
    async (answer) => {
      const { run, sent } = fixture([
        { c_0: choice("o2") },
        { c_0: choice(answer, 0.4) },
      ])
      const result = await run({
        notes: note,
        profile: { preferences: { workModes: ["remote"] } },
      })
      expect(result.choices.language).toMatchObject({
        option: null,
        blocked: true,
        source: "profile",
      })
      expect(sent).toHaveBeenCalledTimes(2)
    }
  )

  it("does not turn missing records into No or make empty source calls", async () => {
    const { run, sent } = fixture([])
    const result = await run(
      { notes: "", profile: {}, resume: null },
      {
        choices: [
          {
            ...field,
            label: "Bound by a restrictive covenant?",
            options: ["Yes", "No"],
          },
        ],
      }
    )
    expect(result.choices.language?.option).toBeNull()
    expect(sent).not.toHaveBeenCalled()
  })

  it("preserves a strong answer and usage if verification of another field fails", async () => {
    const { run, sent } = fixture([
      { c_0: choice("o2", 0.95), c_1: choice("o1", 0.5) },
      new Response("Bad request", { status: 400 }),
    ])
    const result = await run(
      { notes: note },
      {
        choices: [
          field,
          {
            ...field,
            key: "hours",
            label: "Quora coordination hours?",
            options: ["Yes", "No"],
          },
        ],
      }
    )
    expect(sent).toHaveBeenCalledTimes(2)
    expect(result.choices.language?.confidence).toBe(0.95)
    expect(result.choices.hours?.verification).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.usage.inputTokens).toBe(10)
  })

  it("does not fall through to Notes after a Profile/resume request fails", async () => {
    const { run } = fixture([
      { c_0: choice("o2") },
      new Response("Bad request", { status: 400 }),
    ])
    const result = await run({
      notes: note,
      profile: { preferences: { workModes: ["remote"] } },
    })
    expect(result.choices.language).toMatchObject({
      option: null,
      blocked: true,
    })
    expect(result.degraded).toBe(true)
  })

  it("keeps a Profile answer when the lower-priority Notes request fails", async () => {
    const { run } = fixture([
      new Response("Bad request", { status: 400 }),
      { c_0: choice("o2") },
    ])
    const result = await run({
      notes: note,
      profile: { preferences: { workModes: ["remote"] } },
    })
    expect(result.choices.language).toMatchObject({
      option: 1,
      source: "profile",
    })
    expect(result.degraded).toBe(true)
  })

  it("uses explicit negative Notes for multi-select instead of contradictory resume skills", async () => {
    const { run } = fixture([
      { m_0_0: noul(0.01), m_0_1: noul(0.98), a_0: noul(0.98) },
      { m_0_0: noul(0.95), m_0_1: noul(0.01), a_0: noul(0.99) },
    ])
    const result = await run(
      {
        notes: "- No Terraform experience; hands-on Docker experience.",
        resume: { basics: { summary: "Terraform skills" } },
      },
      {
        choices: [],
        multi: [
          {
            key: "tools",
            label: "Hands-on tools?",
            options: ["Terraform", "Docker"],
          },
        ],
      }
    )
    expect(result.multi.tools).toEqual([0.01, 0.98])
  })
})
