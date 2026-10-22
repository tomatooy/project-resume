import {
  applicantContext,
  emptyProfile,
  type Profile,
} from "@workspace/autofill"
import {
  CHOICE_MIN,
  type JudgeInput,
  type JudgeOutput,
  MULTI_YES,
  PREFERENCE_MIN,
  verifiedChoice,
} from "@workspace/resume-core"
import { minimal, onePage } from "@workspace/resume-schema/fixtures"
import { createTypeSafeClient, type Fetch } from "@workspace/typesafe"
import { describe, expect, it, vi } from "vitest"

import { createJudge } from "../src/autofill/jev"

const notes =
  "## Companies\n- For source of job opportunity, select in fallback order The Company's website -> linkedin -> job board."

const sourceOptions = [
  "I'm a user",
  "News article",
  "Job board",
  "Social media (LinkedIn, Instagram, X etc)",
  "In person event",
  "Referral",
  "I was reached out to",
  "Other (please specify)",
]

const experienceNotes = `${notes}

## Experience details
- Most experienced development languages are TypeScript and Java.
- Has hands-on experience with Terraform, Docker and GitHub CI.
- Linux experience level is intermediate.
- Most experienced deploying code to AWS.`

const interviewNotes = `${notes}

## Experience details
- Most experienced development languages are TypeScript,Java and Ruby.
- Has hands-on experience with Terraform, Docker and GitHub CI.
- Linux experience level is intermediate.
- Most experienced deploying code to AWS.
- Prefers TypeScript and Java for interviews.

## Logistics
- Required notice period to current employer is 2 weeks.`

const experienceFields = [
  {
    key: "languages",
    label: "What development languages are you most experienced with?",
    options: ["Go", "Python", "C++", "Ruby", "Java", "Bash"],
  },
  {
    key: "tools",
    label:
      "Please select all of the tools you have hands on experience with? This must be hands on experience only.",
    options: [
      "Terraform",
      "Ansible",
      "Puppet",
      "Docker",
      "Kubernetes",
      "GitHub CI",
      "Jenkins",
      "Chef",
    ],
  },
]

const experienceJob = {
  company: "Example Company",
  title: "Full-Stack Software Engineer",
  description:
    "Seeking an engineer experienced with Go, Python, Kubernetes and Ansible.",
  requirements: {
    mustHaves: ["Go", "Python", "Kubernetes", "Ansible"],
    niceToHaves: [],
    keywords: [],
  },
}

describe("autofill judge", () => {
  it("judges demographic single and multi-selects from ordinary Profile state", async () => {
    const client = createTypeSafeClient({
      apiKey: "test-key",
      fetch: async () =>
        Response.json({
          model: "jev-test",
          answers: {
            c_0: {
              type: "choice",
              choice: "o3",
              confidence: 0.95,
              probabilities: { o1: 0.02, o2: 0.03, o3: 0.95 },
            },
            m_0_0: { type: "noul", noul: 0.95 },
            m_0_1: { type: "noul", noul: 0.9 },
            m_0_2: { type: "noul", noul: 0.01 },
            s_0: {
              type: "choice",
              choice: "profile",
              confidence: 1,
              probabilities: { profile: 1, resume: 0, insufficient: 0 },
            },
            s_1: {
              type: "choice",
              choice: "profile",
              confidence: 1,
              probabilities: { profile: 1, resume: 0, insufficient: 0 },
            },
          },
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
    })
    const sent = vi.spyOn(client, "systemOne")
    const profile: Profile = {
      ...emptyProfile,
      eeo: { ...emptyProfile.eeo, race: ["asian", "white"] },
    }
    const result = await createJudge(client)({
      context: applicantContext({
        profile,
        resume: null,
        notes: "",
        today: new Date("2026-10-22T12:00:00Z"),
      }),
      signal: new AbortController().signal,
      deadline: Date.now() + 10_000,
      choices: [
        {
          key: "veteran",
          label: "Have you served in the military?",
          options: ["Yes", "No", "I prefer not to say"],
        },
      ],
      multi: [
        {
          key: "race",
          label: "What racial identities do you identify with?",
          options: ["Asian", "White or Caucasian", "I prefer not to say"],
        },
      ],
      open: [],
    })

    expect(sent).toHaveBeenCalledOnce()
    expect(sent.mock.calls[0]?.[0].state).toHaveProperty(
      ["profile", "eeo"],
      profile.eeo
    )
    expect(result.choices.veteran).toMatchObject({
      option: 2,
      applicant: false,
      source: "profile",
    })
    expect(result.multi.race).toEqual([0.95, 0.9, 0.01])
  })

  it.each([
    {
      name: "both checks supported",
      explicit: 0.05,
      applicable: 0.9,
      supported: true,
    },
    {
      name: "an existing answer",
      explicit: 0.95,
      applicable: 0.9,
      supported: false,
    },
    {
      name: "uncertain applicability",
      explicit: 0.05,
      applicable: 0.79,
      supported: false,
    },
    {
      name: "an unanswered check",
      explicit: 0.05,
      applicable: undefined,
      supported: false,
    },
  ])(
    "gates Notes fallback with $name and preserves factual probabilities",
    async ({ explicit, applicable, supported }) => {
      const client = createTypeSafeClient({
        apiKey: "test-key",
        fetch: async () =>
          Response.json({
            model: "jev-test",
            answers: {
              c_0: {
                type: "choice",
                choice: "insufficient",
                confidence: 0.96,
                probabilities: {
                  o1: 0.02,
                  o2: 0.01,
                  insufficient: 0.97,
                  applicant: 0,
                },
              },
              e_0: { type: "noul", noul: explicit },
              ...(applicable === undefined
                ? {}
                : { p_0_0: { type: "noul", noul: applicable } }),
            },
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
      })
      const result = await createJudge(client)({
        signal: new AbortController().signal,
        deadline: Date.now() + 10_000,
        context: { profile: {}, notes, resume: null },
        choices: [
          {
            key: "source",
            label: "How did you hear about us?",
            options: ["Job board", "LinkedIn"],
          },
        ],
        multi: [],
        open: [],
      })
      expect(result.choices.source).toMatchObject({
        option: null,
        applicant: false,
        confidence: 0.96,
        probabilities: [0.02, 0.01],
      })
      expect(result.preferences).toEqual(
        supported ? { source: { option: 1, support: 0.9 } } : {}
      )
    }
  )

  it.each(["choice", "multi"])(
    "gives every %s decision the complete options for Notes fallback order",
    async (kind) => {
      const fetch = vi.fn<Fetch>(async () =>
        Response.json({
          model: "jev-test",
          answers: {},
          usage: { input_tokens: 10, output_tokens: 0 },
        })
      )
      const client = createTypeSafeClient({ apiKey: "test-key", fetch })
      const sent = vi.spyOn(client, "systemOne")
      const options = [
        "Job board",
        "Social media (LinkedIn, Instagram, X etc)",
        "The Company's website",
      ]

      const field = {
        key: "source",
        label: "How did you hear about us?",
        options,
      }
      await createJudge(client)({
        signal: new AbortController().signal,
        deadline: Date.now() + 10_000,
        context: { profile: {}, notes, resume: null },
        choices: kind === "choice" ? [field] : [],
        multi: kind === "multi" ? [field] : [],
        open: [],
      })

      expect(sent).toHaveBeenCalledOnce()
      const request = sent.mock.calls[0]?.[0]
      expect(request?.state).toEqual({ notes })
      const questions = Object.entries(request?.questions ?? {})
        .filter(([key]) => key.startsWith("c_") || key.startsWith("m_"))
        .map(([, question]) => question)
      expect(questions).toHaveLength(kind === "choice" ? 1 : options.length)
      for (const question of questions) {
        expect(question.type).toBe(kind === "choice" ? "choice" : "noul")
        for (const option of options) {
          expect(question.instructions).toContain(option)
        }
      }
    }
  )
})

const liveEnabled =
  process.env.AGENT_EVAL === "1" && Boolean(process.env.TYPESAFE_API_KEY)

function records(content: string, profile: Profile = emptyProfile) {
  return applicantContext({
    profile,
    resume: null,
    notes: content,
    job: null,
    page: { company: null, title: null },
    today: new Date("2026-10-20T00:00:00Z"),
  })
}

function liveJudge(
  input: Pick<JudgeInput, "context" | "choices" | "multi" | "reply">
): Promise<JudgeOutput> {
  const client = createTypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY ?? "",
    baseURL: process.env.TYPESAFE_BASE_URL,
    defaultModel: process.env.TYPESAFE_DEFAULT_MODEL,
  })
  return createJudge(client)({
    signal: AbortSignal.timeout(10_000),
    deadline: Date.now() + 10_000,
    open: [],
    ...input,
  })
}

describe.skipIf(!liveEnabled)("autofill judge with live Jev", () => {
  it("reads Profile preferences and resume education from structured state", async () => {
    const result = await liveJudge({
      context: applicantContext({
        profile: {
          ...emptyProfile,
          preferences: { ...emptyProfile.preferences, workModes: ["remote"] },
        },
        resume: {
          ...onePage,
          basics: { ...onePage.basics, summary: "Prefers hybrid work." },
        },
        notes: "- Prefers onsite work.",
        today: new Date("2026-10-22T00:00:00Z"),
      }),
      choices: [
        {
          key: "mode",
          label: "What is your preferred work mode?",
          options: ["Hybrid", "Remote", "Onsite"],
        },
        {
          key: "degree",
          label: "Highest completed degree?",
          options: ["Bachelor's Degree", "Master's Degree", "PhD"],
        },
      ],
      multi: [],
    })
    expect(result.choices.mode, JSON.stringify(result)).toMatchObject({
      option: 1,
      source: "profile",
    })
    expect(result.choices.degree, JSON.stringify(result)).toMatchObject({
      option: 1,
      source: "resume",
    })
    for (const key of ["mode", "degree"]) {
      const verdict = result.choices[key]
      expect(
        verdict &&
          (verdict.confidence >= CHOICE_MIN || verifiedChoice(verdict)),
        JSON.stringify(verdict)
      ).toBe(true)
    }
  }, 20_000)

  it("fills saved Quora availability without reusing it for another company", async () => {
    const result = await liveJudge({
      context: records(
        `${interviewNotes}\n- Available for meetings and impromptu communication during Quora's coordination hours (Mon-Fri, 9am-3pm Pacific Time).`
      ),
      choices: [
        {
          key: "quora",
          label:
            "I understand that all employees for this position will be expected to be available for meetings and impromptu communication during Quora's coordination hours (Mon-Fri, 9am-3pm Pacific Time).",
          options: ["Yes", "No"],
        },
        {
          key: "other",
          label:
            "Are you available for meetings during Example Company's coordination hours (Mon-Fri, 9am-3pm Pacific Time)?",
          options: ["Yes", "No"],
        },
        {
          key: "covenant",
          label:
            "Are you currently bound by a non-compete or restrictive covenant?",
          options: ["Yes", "No"],
        },
      ],
      multi: [],
    })
    const quora = result.choices.quora
    expect(quora, JSON.stringify(result)).toMatchObject({
      option: 0,
      source: "notes",
      applicant: false,
    })
    expect(
      quora && (quora.confidence >= CHOICE_MIN || verifiedChoice(quora))
    ).toBe(true)
    const other = result.choices.other
    expect(
      other?.option !== null &&
        other &&
        (other.confidence >= CHOICE_MIN || verifiedChoice(other)),
      JSON.stringify(other)
    ).toBe(false)
    expect(result.choices.covenant?.option).toBeNull()
  }, 20_000)

  it.each([
    { name: "Notes alone", withResume: false, withJob: false },
    { name: "Notes alongside resume skills", withResume: true, withJob: false },
    {
      name: "Notes alongside job requirements",
      withResume: false,
      withJob: true,
    },
    {
      name: "Notes alongside resume skills and job requirements",
      withResume: true,
      withJob: true,
    },
  ])(
    "uses the available interview preference from $name without inventing availability",
    async ({ withResume, withJob }) => {
      const result = await liveJudge({
        context: applicantContext({
          profile: emptyProfile,
          resume: withResume
            ? {
                ...minimal,
                basics: {
                  ...minimal.basics,
                  summary:
                    "Full-stack engineer with Python, TypeScript and Kubernetes skills.",
                },
              }
            : null,
          notes: interviewNotes,
          job: withJob ? experienceJob : null,
          page: { company: "Quora", title: "Software Engineer" },
          today: new Date("2026-10-21T00:00:00Z"),
        }),
        choices: [
          {
            key: "interview",
            label:
              "What is your preferred programming language for your interviews (you can change this later)?",
            options: ["C++", "Java", "Python"],
          },
          {
            key: "hours",
            label:
              "I understand that all employees for this position will be expected to be available for meetings and impromptu communication during Quora's coordination hours (Mon-Fri, 9am-3pm Pacific Time).",
            options: ["Yes", "No"],
          },
        ],
        multi: [],
      })

      expect(result.choices.interview).toMatchObject({
        option: 1,
        applicant: false,
      })
      const interview = result.choices.interview
      expect(
        interview &&
          (interview.confidence >= CHOICE_MIN || verifiedChoice(interview))
      ).toBe(true)
      expect(result.choices.hours?.option).toBeNull()
    },
    20_000
  )

  it.each([
    { name: "Notes alone", withResume: false, withJob: false },
    { name: "Notes alongside resume skills", withResume: true, withJob: false },
    {
      name: "Notes alongside job requirements",
      withResume: false,
      withJob: true,
    },
    {
      name: "Notes alongside resume skills and job requirements",
      withResume: true,
      withJob: true,
    },
  ])(
    "supports explicit experience answers from $name",
    async ({ withResume, withJob }) => {
      const result = await liveJudge({
        context: applicantContext({
          profile: emptyProfile,
          resume: withResume
            ? {
                ...minimal,
                basics: {
                  ...minimal.basics,
                  summary:
                    "Full-stack engineer with Python, TypeScript and Kubernetes skills.",
                },
              }
            : null,
          notes: experienceNotes,
          job: withJob ? experienceJob : null,
          page: { company: null, title: null },
          today: new Date("2026-10-20T00:00:00Z"),
        }),
        choices: [],
        multi: experienceFields,
      })

      expect(result.multi.languages?.[4]).toBeGreaterThanOrEqual(MULTI_YES)
      expect(result.multi.languages?.[0]).toBeLessThan(MULTI_YES)
      expect(result.multi.languages?.[1]).toBeLessThan(MULTI_YES)
      for (const index of [0, 3, 5]) {
        expect(result.multi.tools?.[index]).toBeGreaterThanOrEqual(MULTI_YES)
      }
      expect(result.multi.tools?.[1]).toBeLessThan(MULTI_YES)
    },
    20_000
  )

  it("respects negative Notes and distinguishes Java from JavaScript", async () => {
    const result = await liveJudge({
      context: records(
        "## Experience details\n- Most experienced development languages are TypeScript and JavaScript.\n- Has no hands-on experience with Terraform, Ansible or Puppet.\n- Has hands-on experience with Docker and GitHub CI."
      ),
      choices: [],
      multi: experienceFields,
    })

    expect(result.multi.languages).toHaveLength(6)
    for (const probability of result.multi.languages ?? []) {
      expect(probability).toBeLessThan(MULTI_YES)
    }
    expect(result.multi.tools?.[0]).toBeLessThan(MULTI_YES)
    expect(result.multi.tools?.[3]).toBeGreaterThanOrEqual(MULTI_YES)
    expect(result.multi.tools?.[5]).toBeGreaterThanOrEqual(MULTI_YES)
  }, 20_000)

  it("does not treat job requirements alone as applicant experience", async () => {
    const result = await liveJudge({
      context: applicantContext({
        profile: emptyProfile,
        resume: null,
        notes: "",
        job: experienceJob,
        page: { company: null, title: null },
        today: new Date("2026-10-20T00:00:00Z"),
      }),
      choices: [],
      multi: experienceFields,
    })

    expect(result.multi.languages).toHaveLength(6)
    expect(result.multi.tools).toHaveLength(8)
    for (const probability of Object.values(result.multi).flat()) {
      expect(probability).toBeLessThan(MULTI_YES)
    }
  }, 20_000)

  it.each([
    {
      name: "LinkedIn inside social media",
      options: sourceOptions,
      selected: 3,
    },
    {
      name: "company website before LinkedIn",
      options: ["Job board", "LinkedIn", "The Company's website"],
      selected: 2,
    },
    {
      name: "job board when earlier preferences are absent",
      options: ["Referral", "Job board"],
      selected: 1,
    },
  ])(
    "uses the Notes fallback for $name",
    async ({ options, selected }) => {
      const field = {
        key: "source",
        label: "How did you hear about us?",
        options,
      }
      const result = await liveJudge({
        context: records(notes),
        choices: [field],
        multi: [field],
      })

      expect(result.preferences?.source?.option).toBe(selected)
      expect(result.preferences?.source?.support).toBeGreaterThanOrEqual(
        PREFERENCE_MIN
      )
    },
    20_000
  )

  it("keeps an explicit profile answer ahead of a Notes fallback", async () => {
    const result = await liveJudge({
      context: records(
        "- For preferred work mode, select in fallback order Hybrid -> Remote.",
        {
          ...emptyProfile,
          preferences: { ...emptyProfile.preferences, workModes: ["remote"] },
        }
      ),
      choices: [
        {
          key: "mode",
          label: "What is your preferred work mode?",
          options: ["Hybrid", "Remote"],
        },
      ],
      multi: [],
    })
    expect(result.choices.mode).toMatchObject({ option: 1, applicant: false })
    expect(result.preferences?.mode).toBeUndefined()
  }, 20_000)

  it("does not answer an unrelated field from a matching fallback option", async () => {
    const result = await liveJudge({
      context: records(notes),
      choices: [
        {
          key: "experience",
          label: "Which platform have you built integrations for?",
          options: ["LinkedIn", "Job board"],
        },
      ],
      multi: [],
    })
    expect(result.choices.experience).toMatchObject({
      option: null,
      applicant: false,
    })
    expect(result.preferences?.experience).toBeUndefined()
  }, 20_000)

  it("keeps missing records insufficient", async () => {
    const result = await liveJudge({
      context: records(""),
      choices: [
        {
          key: "source",
          label: "How did you hear about us?",
          options: sourceOptions,
        },
      ],
      multi: [],
    })
    expect(result.choices.source).toMatchObject({
      option: null,
      applicant: false,
    })
  }, 20_000)

  it("uses the current reply instead of a saved fallback", async () => {
    const result = await liveJudge({
      context: records(notes),
      reply: { text: "1. Job board" },
      choices: [
        {
          key: "source",
          label: "How did you hear about us?",
          options: sourceOptions,
          asked: { number: 1, text: "How did you hear about us?" },
        },
      ],
      multi: [],
    })
    expect(result.choices.source).toMatchObject({ option: 2, applicant: false })
    expect(result.preferences).toBeUndefined()
  }, 20_000)
})
