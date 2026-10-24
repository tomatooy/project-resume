import {
  applicantContext,
  type FieldDescriptor,
  plainQuestions,
  ProfileSchema,
} from "@workspace/autofill"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  type AutofillModels,
  type InferInput,
  InferInputSchema,
  type InferResult,
  InferResultSchema,
  type JudgeOutput,
  type QuestionsInput,
  type ShortTextOutput,
} from "../src"
import { INFER_MS, JUDGE_MS } from "../src/services/autofill-tiers"
import {
  COUNTS,
  failing,
  field,
  hang,
  PAGE,
  type Session,
  session,
  stall,
  USAGE,
  YES_NO,
} from "./autofill-session"
import { only } from "./harness"

type Choice = JudgeOutput["choices"][string]
type Short = ShortTextOutput["answers"][number]
const RESUME: Short["evidence"] = ["resume"]

const api = field("api", "Have you used Stripe's API before?", "radio", {
  options: YES_NO,
})
const langs = field("langs", "Which languages do you write?", "checkboxes", {
  options: [
    { id: "#1", label: "Python" },
    { id: "#2", label: "Go" },
  ],
})
const build = field(
  "build",
  "What would you build first at Stripe?",
  "textarea"
)
const favorite = field("favorite", "Favorite programming language")
const reference = field("reference", "Contact email for references", "email")
const office = field("office", "Which office would you prefer?", "combobox", {
  searchable: true,
})
const community = field(
  "community",
  "Would you like to join our talent community?",
  "checkbox"
)
/** A select whose options never loaded. */
const team = field("team", "Team you are most excited about", "select", {
  optionsPending: true,
})

const race = field(
  "9fe919b5-6e70-4cd8-b5be-943d2e1cea10",
  "What race and/or ethnic identities do you identify with? (please select all that apply)",
  "checkboxes",
  {
    required: false,
    section: "Voluntary Self-Identification",
    options: [
      "American Indian or Alaskan Native",
      "Black of African or African-American descent",
      "East Asian",
      "Hispanic or Latinx",
      "Middle Eastern or North African",
      "Native Hawaiian or Other Pacific Islander",
      "South Asian",
      "Southeast Asian",
      "White or Caucasian",
      "My ethnicity is not listed",
      "I prefer not to say",
    ].map((label, i) => ({ id: `#${i + 1}`, label })),
  }
)
const veteran = field(
  "9a75853e-b4fa-4e72-b488-dbe18ce37afc",
  "US candidates only: Are you a veteran/have you served in the military?",
  "radio",
  {
    required: false,
    section: "Voluntary Self-Identification",
    options: ["Yes", "No", "Not applicable", "I prefer not to say"].map(
      (label, i) => ({ id: `#${i + 1}`, label })
    ),
  }
)

/** Infers through the contract, so a shape the schemas refuse fails here. */
async function infer(
  s: Session,
  fields: FieldDescriptor[],
  over: Partial<InferInput> = {}
): Promise<InferResult> {
  const input = InferInputSchema.parse({
    page: PAGE,
    resumeId: s.resumeId,
    applicationId: s.applicationId,
    useJob: false,
    counts: COUNTS,
    fields,
    ...over,
  })
  return InferResultSchema.parse(await s.h.autofillService.infer(input))
}

function byLabel<T>(
  items: { key: string; label: string }[],
  answers: Record<string, T> = {}
): Record<string, T> {
  const keyed: Record<string, T> = {}
  for (const { key, label } of items) {
    const answer = answers[label]
    if (answer !== undefined) keyed[key] = answer
  }
  return keyed
}

/** A judge that answers the items it is asked by their labels. */
function judgeBy(answers: {
  choices?: Record<string, Choice>
  multi?: Record<string, number[]>
  open?: Record<string, number>
}): AutofillModels["judge"] {
  return async (input) => ({
    choices: byLabel(input.choices, answers.choices),
    multi: byLabel(input.multi, answers.multi),
    open: byLabel(input.open, answers.open),
    usage: USAGE,
  })
}

/** Short answers by field label, with evidence from the resume unless given. */
function shortBy(
  answers: Record<string, Partial<Short> & Pick<Short, "value">>
): AutofillModels["shortText"] {
  return async (input) => ({
    answers: input.fields.flatMap(({ key, label }) => {
      const answer = answers[label]
      return answer
        ? [{ evidence: RESUME, applicant: false, ...answer, key }]
        : []
    }),
    usage: USAGE,
  })
}

/** The key the service gave the field labeled `label`. */
const keyOf = (input: QuestionsInput, label: string): string =>
  input.fields.find((item) => item.label === label)?.key ?? "missing"

/** The field ids the question list covers, in order. */
const asked = (result: InferResult) =>
  result.questions.flatMap(({ original }) =>
    original.map(({ fieldId }) => fieldId)
  )

afterEach(() => {
  vi.useRealTimers()
})

describe("AutofillService.infer", () => {
  it("routes Ashby demographic choices through the ordinary judge pipeline", async () => {
    const judge = vi.fn(
      judgeBy({
        choices: {
          [veteran.label]: { option: 1, applicant: false, confidence: 0.95 },
        },
        multi: {
          [race.label]: [
            0.01, 0.01, 0.95, 0.01, 0.01, 0.01, 0.01, 0.01, 0.9, 0.01, 0.01,
          ],
        },
      })
    )
    const s = await session({ judge })
    const profile = ProfileSchema.parse({
      eeo: { race: ["asian", "white"], veteran: "not-protected-veteran" },
    })
    await s.h.autofillProfileService.save({ profile, expectedRevision: 0 })
    const notes =
      "- Identifies as East Asian and White.\n- Has never served in the military."
    await s.h.autofillNotesService.save({
      content: notes,
      expectedRevision: 0,
      snapshot: false,
    })
    const page: InferInput["page"] = {
      ...PAGE,
      vendor: "ashby",
      postingKey: "ashby:example:posting",
      url: "https://jobs.ashbyhq.com/example/posting",
    }
    const fields = [race, veteran]
    const plan = await s.h.autofillService.plan({
      page,
      fields,
      resumeId: s.resumeId,
      linkedin: null,
    })
    expect(plan.fills).toEqual([])
    expect(plan.classes).toEqual(
      fields.map(({ id }) => ({
        fieldId: id,
        key: null,
        zone: "normal",
        route: "ai",
      }))
    )

    const result = await infer(s, fields, { page })

    const input = judge.mock.calls[0]?.[0]
    expect(input?.context).toHaveProperty(["profile", "eeo"], profile.eeo)
    expect(input?.context).toHaveProperty("notes", notes)
    expect(input?.choices).toEqual([
      {
        key: "f2",
        label: veteran.label,
        options: veteran.options?.map(({ label }) => label),
      },
    ])
    expect(input?.multi).toEqual([
      {
        key: "f1",
        label: race.label,
        options: race.options?.map(({ label }) => label),
      },
    ])
    expect(result.fills).toEqual([
      {
        fieldId: race.id,
        source: "ai",
        kind: "options",
        optionIds: ["#3", "#9"],
        labels: ["East Asian", "White or Caucasian"],
      },
      {
        fieldId: veteran.id,
        source: "ai",
        kind: "options",
        optionIds: ["#2"],
        labels: ["No"],
      },
    ])
    expect(result.page).toEqual([])
    expect(result.questions).toEqual([])
  })

  it("asks about uncertain demographic choices in the usual question flow", async () => {
    const s = await session({
      judge: judgeBy({
        choices: {
          [veteran.label]: { option: null, applicant: false, confidence: 0.2 },
        },
        multi: { [race.label]: race.options?.map(() => 0.2) ?? [] },
      }),
    })

    const result = await infer(s, [race, veteran])

    expect(result.fills).toEqual([])
    expect(result.page).toEqual([])
    expect(asked(result)).toEqual([race.id, veteran.id])
  })

  it.each([
    { support: 0.95, contradiction: 0.02, blocked: false, fills: 1 },
    { support: 0.89, contradiction: 0.02, blocked: false, fills: 0 },
    { support: 0.95, contradiction: 0.11, blocked: false, fills: 0 },
    { support: 0.95, contradiction: 0.02, blocked: true, fills: 0 },
  ])(
    "gates a weak choice with separate evidence checks: $support / $contradiction / $blocked",
    async ({ support, contradiction, blocked, fills }) => {
      const s = await session({
        judge: judgeBy({
          choices: {
            [api.label]: {
              option: 0,
              applicant: false,
              confidence: 0.45,
              blocked,
              verification: { support, contradiction },
            },
          },
        }),
      })
      const result = await infer(s, [api])
      expect(result.fills).toHaveLength(fills)
      expect(result.questions).toHaveLength(1 - fills)
    }
  )

  it("preserves usable fills and records a failed verification batch as degraded", async () => {
    const judging = judgeBy({
      choices: {
        [api.label]: { option: 0, applicant: false, confidence: 0.95 },
      },
    })
    const s = await session({
      judge: async (input) => ({ ...(await judging(input)), degraded: true }),
    })
    const result = await infer(s, [api])
    expect(result.fills).toHaveLength(1)
    expect(result.degraded).toBe(true)
    expect(only(s.h.db.runs)).toMatchObject({
      status: "failed",
      errorClass: "model",
    })
  })

  it.each(["select", "checkboxes"] satisfies FieldDescriptor["control"][])(
    "uses a supported Notes preference ahead of a low-probability guess for %s",
    async (control) => {
      const source = field("source", "How did you hear about us?", control, {
        options: [
          { id: "board", label: "Job board" },
          { id: "social", label: "Social media (LinkedIn, Instagram, X etc)" },
        ],
      })
      const s = await session({
        judge: async () => ({
          choices: {
            f1: {
              option: null,
              applicant: false,
              confidence: 0.96,
              probabilities: [0.02, 0.01],
            },
          },
          multi: { f1: [0.02, 0.01] },
          preferences: { f1: { option: 1, support: 0.95 } },
          open: {},
          usage: USAGE,
        }),
      })
      const result = await infer(s, [source])
      expect(result.fills).toEqual([
        {
          fieldId: "source",
          kind: "options",
          source: "ai",
          optionIds: ["social"],
          labels: ["Social media (LinkedIn, Instagram, X etc)"],
        },
      ])
      expect(asked(result)).toEqual([])
    }
  )

  it("fills a choice above confidence 0.5", async () => {
    const at = (confidence: number) =>
      session({
        judge: judgeBy({
          choices: { [api.label]: { option: 0, applicant: false, confidence } },
        }),
      })

    const sure = await infer(await at(0.51), [api])
    expect(sure.fills).toEqual([
      {
        fieldId: "api",
        source: "ai",
        kind: "options",
        optionIds: ["#1"],
        labels: ["Yes"],
      },
    ])
    expect(asked(sure)).toEqual([])

    const unsure = await infer(await at(0.5), [api])
    expect(unsure.fills).toEqual([])
    expect(asked(unsure)).toEqual(["api"])
  })

  it.each([
    {
      name: "explicit answer",
      option: 0,
      applicant: false,
      preferred: 1,
      support: 0.95,
      fills: ["Yes"],
      page: [],
      questions: [],
    },
    {
      name: "applicant-only answer",
      option: null,
      applicant: true,
      preferred: 1,
      support: 0.95,
      fills: [],
      page: ["api"],
      questions: [],
    },
    {
      name: "uncertain preference",
      option: null,
      applicant: false,
      preferred: 1,
      support: 0.79,
      fills: [],
      page: [],
      questions: ["api"],
    },
    {
      name: "invalid preference option",
      option: null,
      applicant: false,
      preferred: 9,
      support: 0.95,
      fills: [],
      page: [],
      questions: ["api"],
    },
  ])(
    "keeps the $name when Notes has a fallback",
    async ({
      option,
      applicant,
      preferred,
      support,
      fills,
      page,
      questions,
    }) => {
      const s = await session({
        judge: async () => ({
          choices: { f1: { option, applicant, confidence: 0.95 } },
          preferences: { f1: { option: preferred, support } },
          multi: {},
          open: {},
          usage: USAGE,
        }),
      })
      const result = await infer(s, [api])
      expect(
        result.fills.flatMap((fill) =>
          fill.kind === "options" ? fill.labels : []
        )
      ).toEqual(fills)
      expect(result.page).toEqual(page)
      expect(asked(result)).toEqual(questions)
    }
  )

  it("sends a choice only the applicant can make to the page", async () => {
    const s = await session({
      judge: judgeBy({
        choices: {
          [api.label]: { option: null, applicant: true, confidence: 0.9 },
        },
      }),
    })

    const result = await infer(s, [api])

    expect(result.page).toEqual(["api"])
    expect(result.fills).toEqual([])
    expect(asked(result)).toEqual([])
  })

  it("fills supported tools even when another option is uncertain", async () => {
    const tools = field(
      "tools",
      "Please select all of the tools you have hands on experience with? This must be hands on experience only.",
      "checkboxes",
      {
        options: [
          { id: "terraform", label: "Terraform" },
          { id: "ansible", label: "Ansible" },
          { id: "puppet", label: "Puppet" },
          { id: "docker", label: "Docker" },
          { id: "kubernetes", label: "Kubernetes" },
          { id: "github-ci", label: "GitHub CI" },
          { id: "jenkins", label: "Jenkins" },
          { id: "chef", label: "Chef" },
        ],
      }
    )
    const s = await session({
      judge: judgeBy({
        multi: {
          [tools.label]: [0.97, 0.04, 0.04, 0.96, 0.59, 0.93, 0.04, 0.04],
        },
      }),
    })

    const result = await infer(s, [tools])

    expect(result.fills).toEqual([
      {
        fieldId: "tools",
        source: "ai",
        kind: "options",
        optionIds: ["terraform", "docker", "github-ci"],
        labels: ["Terraform", "Docker", "GitHub CI"],
      },
    ])
    expect(asked(result)).toEqual([])
  })

  it("selects only supported multi-select options and asks when none qualify", async () => {
    const at = async (yes: number[]) =>
      infer(
        await session({ judge: judgeBy({ multi: { [langs.label]: yes } }) }),
        [langs]
      )

    expect((await at([0.6, 0.2])).fills).toEqual([
      {
        fieldId: "langs",
        source: "ai",
        kind: "options",
        optionIds: ["#1"],
        labels: ["Python"],
      },
    ])
    expect((await at([0.6, 0.78])).fills).toEqual([
      expect.objectContaining({
        optionIds: ["#1", "#2"],
        labels: ["Python", "Go"],
      }),
    ])
    for (const yes of [
      [0.9, 0.5],
      [0.6, 0.59],
    ]) {
      const result = await at(yes)
      expect(result.fills).toEqual([
        expect.objectContaining({ optionIds: ["#1"], labels: ["Python"] }),
      ])
      expect(asked(result)).toEqual([])
    }
    // No supported selection, or an incomplete model response.
    for (const yes of [[0.1, 0.1], [0.59, 0.1], [0.5, 0.36], [0.9]]) {
      const result = await at(yes)
      expect(result.fills).toEqual([])
      expect(asked(result)).toEqual(["langs"])
    }
  })

  it("routes open questions by control", async () => {
    const route = async (open: Record<string, number>) =>
      infer(
        await session({
          judge: judgeBy({ open }),
          shortText: shortBy({
            [build.label]: { value: "A billing dashboard" },
            [favorite.label]: { value: "TypeScript" },
          }),
        }),
        [build, favorite]
      )

    // A textarea is open above 0.2; a single-line input from 0.8.
    const first = await route({ [build.label]: 0.3, [favorite.label]: 0.79 })
    expect(first.write).toEqual(["build"])
    expect(first.fills).toEqual([
      { fieldId: "favorite", source: "ai", kind: "text", value: "TypeScript" },
    ])

    const second = await route({ [build.label]: 0.2, [favorite.label]: 0.8 })
    expect(second.write).toEqual(["favorite"])
    expect(second.fills).toEqual([
      {
        fieldId: "build",
        source: "ai",
        kind: "text",
        value: "A billing dashboard",
      },
    ])
  })

  it("drops short answers without evidence or with invalid values", async () => {
    const ideal = field("ideal", "Describe your ideal team", "text", {
      maxLength: 10,
    })
    const s = await session({
      shortText: shortBy({
        [favorite.label]: { value: "TypeScript", evidence: [] },
        [ideal.label]: { value: "Small and kind" },
        [reference.label]: { value: "ada at example" },
      }),
    })

    const result = await infer(s, [favorite, ideal, reference])

    expect(result.fills).toEqual([])
    expect(asked(result)).toEqual(["favorite", "ideal", "reference"])
  })

  it("checks the format of email, URL, number and date answers", async () => {
    const site = field("site", "Personal website", "url")
    const years = field("years", "Years of Rust experience", "number")
    const day = field("day", "Earliest interview date", "date")
    const ideal = field("ideal", "Describe your ideal team", "text", {
      maxLength: 10,
    })
    const fields = [reference, site, years, day, ideal]
    const answering = (values: string[]) =>
      session({
        shortText: shortBy(
          Object.fromEntries(
            fields.map(({ label }, i) => [label, { value: values[i] ?? null }])
          )
        ),
      })

    const valid = await infer(
      await answering([
        "ada@example.com",
        "https://ada.dev",
        "2.5",
        "2026-11-02",
        "  Small team  ",
      ]),
      fields
    )
    expect(valid.fills).toEqual(
      [
        ["reference", "ada@example.com"],
        ["site", "https://ada.dev"],
        ["years", "2.5"],
        ["day", "2026-11-02"],
        ["ideal", "Small team"],
      ].map(([fieldId, value]) => ({
        fieldId,
        source: "ai",
        kind: "text",
        value,
      }))
    )

    for (const values of [
      ["ada at example", "ada dot dev", "two", "Nov 2", "Small teams"],
      ["ada@", "javascript:alert(1)", "2 years", "2026-02-30", "   "],
    ]) {
      const invalid = await infer(await answering(values), fields)
      expect(invalid.fills).toEqual([])
      expect(asked(invalid)).toEqual([
        "reference",
        "site",
        "years",
        "day",
        "ideal",
      ])
    }
  })

  it("keeps consent and salary on the page while sending gender to the judge", async () => {
    const gender = field("gender", "Gender", "select", {
      options: [
        { id: "#1", label: "Female" },
        { id: "#2", label: "Male" },
      ],
    })
    const salary = field("salary", "Desired salary")
    const privacy = field(
      "privacy",
      "I acknowledge that I have read the Job Applicant Privacy Notice",
      "checkbox"
    )
    // Models that answer everything they are given.
    const judge = vi.fn<AutofillModels["judge"]>(async (input) => ({
      choices: Object.fromEntries(
        input.choices.map(({ key }) => [
          key,
          { option: 0, applicant: false, confidence: 1 },
        ])
      ),
      multi: {},
      open: {},
      usage: USAGE,
    }))
    const shortText = vi.fn<AutofillModels["shortText"]>(async (input) => ({
      answers: input.fields.map(({ key }) => ({
        key,
        value: "Yes",
        evidence: RESUME,
        applicant: false,
      })),
      usage: USAGE,
    }))
    const questions = vi.fn<AutofillModels["questions"]>(async () => ({
      questions: [],
      usage: USAGE,
    }))
    const s = await session({ judge, shortText, questions })

    const result = await infer(s, [gender, salary, privacy, api, favorite])

    const sent = [
      ...judge.mock.calls.flatMap(([input]) => [
        ...input.choices,
        ...input.multi,
        ...input.open,
      ]),
      ...shortText.mock.calls.flatMap(([input]) => input.fields),
      ...questions.mock.calls.flatMap(([input]) => input.fields),
    ].map(({ label }) => label)
    expect(sent).toContain(api.label)
    expect(sent).toContain(gender.label)
    const touched = [
      ...result.fills.map(({ fieldId }) => fieldId),
      ...result.write,
      ...result.page,
      ...asked(result),
    ]
    expect(touched).toEqual(["gender", "api", "favorite"])
    for (const forbidden of [salary, privacy]) {
      expect(sent).not.toContain(forbidden.label)
    }
  })

  it("drops an option index the field does not have", async () => {
    const s = await session({
      judge: judgeBy({
        choices: {
          [api.label]: { option: 7, applicant: false, confidence: 0.95 },
          [community.label]: { option: 2, applicant: false, confidence: 0.95 },
        },
      }),
    })

    const result = await infer(s, [api, community])

    expect(result.fills).toEqual([])
    expect(asked(result)).toEqual(["api", "community"])
  })

  it("sends each field to the model that judges it", async () => {
    const country = field(
      "country",
      "Country you would work from",
      "combobox",
      {
        searchable: true,
        options: [
          { id: "#1", label: "United States" },
          { id: "#2", label: "Ireland" },
        ],
      }
    )
    const short = field("short", "Favorite programming language", "text", {
      help: "One word",
      maxLength: 40,
    })
    const judge = vi.fn(judgeBy({}))
    const shortText = vi.fn(shortBy({}))
    const s = await session({ judge, shortText })

    await infer(s, [
      api,
      community,
      langs,
      country,
      build,
      short,
      reference,
      office,
    ])

    // Keys are positions, so page ids never reach a model.
    expect(judge.mock.calls[0]?.[0]).toMatchObject({
      choices: [
        { key: "f1", label: api.label, options: ["Yes", "No"] },
        { key: "f2", label: community.label, options: ["Yes", "No"] },
        {
          key: "f4",
          label: country.label,
          options: ["United States", "Ireland"],
        },
      ],
      multi: [{ key: "f3", label: langs.label, options: ["Python", "Go"] }],
      open: [
        { key: "f5", label: build.label, multiline: true },
        { key: "f6", label: short.label, help: "One word", multiline: false },
      ],
    })
    expect(shortText.mock.calls[0]?.[0].fields).toEqual([
      { key: "f5", label: build.label, control: "textarea" },
      {
        key: "f6",
        label: short.label,
        help: "One word",
        control: "text",
        maxLength: 40,
      },
      { key: "f7", label: reference.label, control: "email" },
      { key: "f8", label: office.label, control: "combobox" },
    ])
  })

  it("sends closed fields without options to the page", async () => {
    const judge = vi.fn(judgeBy({}))
    const shortText = vi.fn(shortBy({}))
    const s = await session({ judge, shortText })
    // A combobox whose options load once it is opened waits for the page too.
    const level = field("level", "Seniority level", "combobox", {
      optionsPending: true,
    })

    const result = await infer(s, [team, level, api])

    expect(result.page).toEqual(["team", "level"])
    expect(asked(result)).toEqual(["api"])
    const sent = [
      ...(judge.mock.calls[0]?.[0].choices ?? []),
      ...(shortText.mock.calls[0]?.[0].fields ?? []),
    ].map(({ label }) => label)
    expect(sent).toEqual([api.label])
  })

  it("fills searchable fields with a search and checkboxes with a check", async () => {
    // A combobox that lists nothing until typed into is a search too.
    const nearest = field("nearest", "Nearest airport", "combobox")
    // So is any closed field marked searchable that lists nothing yet.
    const zone = field("zone", "Your time zone", "select", {
      searchable: true,
      optionsPending: true,
    })
    const fields = [office, nearest, zone, community]
    const answering = (option: number) =>
      session({
        judge: judgeBy({
          choices: {
            [community.label]: { option, applicant: false, confidence: 0.9 },
          },
        }),
        shortText: shortBy({
          [office.label]: { value: "Dublin" },
          [nearest.label]: { value: "SFO" },
          [zone.label]: { value: "Europe/Dublin" },
        }),
      })

    expect((await infer(await answering(0), fields)).fills).toEqual([
      {
        fieldId: "office",
        source: "ai",
        kind: "search",
        query: "Dublin",
        target: "Dublin",
      },
      {
        fieldId: "nearest",
        source: "ai",
        kind: "search",
        query: "SFO",
        target: "SFO",
      },
      {
        fieldId: "zone",
        source: "ai",
        kind: "search",
        query: "Europe/Dublin",
        target: "Europe/Dublin",
      },
      { fieldId: "community", source: "ai", kind: "check", checked: true },
    ])
    expect(
      (await infer(await answering(1), fields)).fills.find(
        ({ fieldId }) => fieldId === "community"
      )
    ).toEqual({
      fieldId: "community",
      source: "ai",
      kind: "check",
      checked: false,
    })
  })

  it("keeps page text out of the judge's context", async () => {
    const judge = vi.fn(judgeBy({}))
    const shortText = vi.fn(shortBy({}))
    const s = await session({ judge, shortText })

    await infer(s, [api, favorite])

    expect(judge.mock.calls[0]?.[0].context).not.toHaveProperty("page")
    expect(shortText.mock.calls[0]?.[0].context).not.toHaveProperty("page")
  })

  it("never gives models imported job context, including legacy useJob requests", async () => {
    const shortText = vi.fn(shortBy({}))
    const s = await session({ shortText })
    const target = await s.h.jobTargets.create({
      platform: null,
      externalJobId: null,
      sourceUrl: null,
      rawText: "Stripe builds the economic infrastructure of the internet.",
      title: "Software Engineer",
      company: "Stripe",
      location: null,
      requirements: {
        mustHaves: ["TypeScript"],
        niceToHaves: [],
        keywords: [],
      },
    })
    await s.h.jobTargets.link({
      resumeId: s.resumeId,
      jobTargetId: target.id,
      isOrigin: true,
    })

    await infer(s, [favorite])
    await infer(s, [favorite], { useJob: true })

    for (const [input] of shortText.mock.calls)
      expect(input.context).not.toHaveProperty("job")
  })

  it("builds the question list from the model", async () => {
    const shortText = vi.fn(
      shortBy({ [reference.label]: { value: "ada@example.com" } })
    )
    const filledKey = () =>
      shortText.mock.calls[0]?.[0].fields.find(
        ({ label }) => label === reference.label
      )?.key ?? "missing"
    const questions = vi.fn<AutofillModels["questions"]>(async (input) => ({
      questions: [
        {
          text: "Why Stripe, and what would you build first?",
          keys: [keyOf(input, build.label)],
          options: [],
          companySpecific: true,
        },
        {
          text: "Which language do you enjoy most?",
          keys: [keyOf(input, favorite.label), "f99"],
          options: [],
          companySpecific: false,
        },
        // Unknown keys only, and a field another item already covers.
        {
          text: "Nothing on this page",
          keys: ["f99"],
          options: [],
          companySpecific: false,
        },
        {
          text: "What do you write most?",
          keys: [keyOf(input, favorite.label)],
          options: ["Go", "Rust"],
          companySpecific: false,
        },
        // A field short text already filled.
        {
          text: "Which email should references use?",
          keys: [filledKey()],
          options: [],
          companySpecific: false,
        },
      ],
      usage: USAGE,
    }))
    const s = await session({ shortText, questions })

    const result = await infer(s, [api, build, favorite, reference])

    expect(result.questions).toEqual([
      {
        id: "q1",
        text: "Which language do you enjoy most?",
        original: [{ fieldId: "favorite", label: favorite.label }],
        companySpecific: false,
      },
      ...plainQuestions([api], ["api"]),
      {
        id: "q2",
        text: "Why Stripe, and what would you build first?",
        original: [{ fieldId: "build", label: build.label }],
        companySpecific: true,
      },
    ])
    expect(questions.mock.calls[0]?.[0]).toMatchObject({
      context: {},
      company: null,
      fields: [
        { label: api.label, options: ["Yes", "No"] },
        { label: build.label, options: [] },
        { label: favorite.label, options: [] },
      ],
    })
    expect(result.degraded).toBe(false)
  })

  it("keeps the options the question list names", async () => {
    const s = await session({
      questions: async (input) => ({
        questions: [
          {
            text: "Have you built on Stripe?",
            keys: input.fields.map(({ key }) => key),
            options: ["Yes", "No"],
            companySpecific: false,
          },
        ],
        usage: USAGE,
      }),
    })

    const result = await infer(s, [api])

    expect(result.questions).toEqual([
      {
        id: "q1",
        text: "Have you built on Stripe?",
        original: [{ fieldId: "api", label: api.label }],
        options: ["Yes", "No"],
        companySpecific: false,
      },
    ])
  })

  it("drops question items whose text or options do not fit", async () => {
    const ideal = field("ideal", "Describe your ideal team")
    const site = field("site", "Personal website", "url")
    const years = field("years", "Years of Rust experience", "number")
    const fields = [api, build, favorite, ideal, site, years]
    // The most options a question may have, the longest one at the limit.
    const most = ["y".repeat(200), ...Array<string>(299).fill("z")]
    const item = (key: string, text: string, options: string[] = []) => ({
      text,
      keys: [key],
      options,
      companySpecific: false,
    })
    const s = await session({
      questions: async (input) => ({
        questions: [
          item(keyOf(input, api.label), "x".repeat(501)),
          item(keyOf(input, build.label), "Pick one", Array(301).fill("A")),
          item(keyOf(input, favorite.label), "Pick one", ["y".repeat(201)]),
          item(keyOf(input, ideal.label), " \n "),
          item(keyOf(input, site.label), "  Which   site\n is yours? ", most),
          item(keyOf(input, years.label), "x".repeat(500)),
        ],
        usage: USAGE,
      }),
    })

    const result = await infer(s, fields)

    expect(result.questions).toEqual([
      {
        id: "q1",
        text: "Which site is yours?",
        original: [{ fieldId: "site", label: site.label }],
        options: most,
        companySpecific: false,
      },
      {
        id: "q2",
        text: "x".repeat(500),
        original: [{ fieldId: "years", label: years.label }],
        companySpecific: false,
      },
      ...plainQuestions(fields, ["api", "build", "favorite", "ideal"]),
    ])
  })

  it("keeps the fills when the question list fails", async () => {
    const s = await session({
      judge: judgeBy({
        choices: {
          [api.label]: { option: 1, applicant: false, confidence: 0.9 },
        },
      }),
      questions: failing,
    })

    const result = await infer(s, [api, favorite])

    expect(result.fills).toEqual([
      {
        fieldId: "api",
        source: "ai",
        kind: "options",
        optionIds: ["#2"],
        labels: ["No"],
      },
    ])
    expect(result.degraded).toBe(true)
    expect(result.questions).toEqual(
      plainQuestions([api, favorite], ["favorite"])
    )
    expect(only(s.h.db.runs)).toMatchObject({
      status: "completed",
      errorClass: null,
      inputTokens: 20,
      outputTokens: 10,
    })
  })

  it("gives the question list the time left until the infer deadline", async () => {
    vi.useFakeTimers()
    const questions = vi.fn<AutofillModels["questions"]>(hang)
    const s = await session({ judge: judgeBy({}), questions })
    const begun = Date.now()

    const pending = infer(s, [api])
    await vi.advanceTimersByTimeAsync(INFER_MS - 1)
    const call = questions.mock.calls[0]?.[0]
    expect(call?.deadline).toBe(begun + INFER_MS)
    expect(call?.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(call?.signal.aborted).toBe(true)
    const result = await pending

    expect(result.degraded).toBe(true)
    expect(result.questions).toEqual(plainQuestions([api], ["api"]))
    expect(only(s.h.db.runs)).toMatchObject({ status: "completed" })
  })

  it("degrades to plain questions when AI times out", async () => {
    vi.useFakeTimers()
    // The judge never answers, even once its signal aborts.
    const judge = vi.fn<AutofillModels["judge"]>(stall)
    const shortText = vi.fn(shortBy({}))
    const s = await session({ judge, shortText })
    const fields = [api, favorite]
    const begun = Date.now()

    const pending = infer(s, fields)
    await vi.advanceTimersByTimeAsync(JUDGE_MS - 1)
    const call = judge.mock.calls[0]?.[0]
    expect(call?.deadline).toBe(begun + JUDGE_MS)
    expect(shortText.mock.calls[0]?.[0].deadline).toBe(begun + JUDGE_MS)
    expect(call?.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(call?.signal.aborted).toBe(true)
    const result = await pending

    expect(result).toMatchObject({
      fills: [],
      write: [],
      page: [],
      degraded: true,
    })
    expect(result.questions).toEqual(
      plainQuestions(fields, ["api", "favorite"])
    )
    // The short text call finished, so its tokens count.
    expect(only(s.h.db.runs)).toMatchObject({
      status: "failed",
      errorClass: "timeout",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: JUDGE_MS,
    })
  })

  it("keeps the judge's answers when short text fails", async () => {
    const s = await session({
      judge: judgeBy({
        choices: {
          [api.label]: { option: 0, applicant: false, confidence: 0.9 },
        },
        open: { [build.label]: 0.9 },
      }),
      shortText: failing,
    })
    const fields = [api, build, favorite, office]

    const result = await infer(s, fields)

    expect(result).toMatchObject({
      fills: [
        {
          fieldId: "api",
          source: "ai",
          kind: "options",
          optionIds: ["#1"],
          labels: ["Yes"],
        },
      ],
      write: ["build"],
      page: [],
      degraded: true,
    })
    expect(result.questions).toEqual(
      plainQuestions(fields, ["favorite", "office"])
    )
    expect(only(s.h.db.runs)).toMatchObject({
      status: "failed",
      errorClass: "model",
      inputTokens: 10,
      outputTokens: 5,
    })
  })

  it("keeps short answers that need no judge when the judge fails", async () => {
    const s = await session({
      judge: failing,
      shortText: shortBy({
        [favorite.label]: { value: "TypeScript" },
        [reference.label]: { value: "ada@example.com" },
        [office.label]: { value: "Dublin" },
      }),
    })
    const fields = [api, favorite, reference, office]

    const result = await infer(s, fields)

    // Whether a text input is an open question is the judge's call.
    expect(result.fills).toEqual([
      {
        fieldId: "reference",
        source: "ai",
        kind: "text",
        value: "ada@example.com",
      },
      {
        fieldId: "office",
        source: "ai",
        kind: "search",
        query: "Dublin",
        target: "Dublin",
      },
    ])
    expect(result.degraded).toBe(true)
    expect(result.questions).toEqual(
      plainQuestions(fields, ["api", "favorite"])
    )
    expect(only(s.h.db.runs)).toMatchObject({
      status: "failed",
      errorClass: "model",
    })
  })

  it("degrades without a run row only when neither model is configured", async () => {
    for (const ready of [
      { judge: false, text: false },
      { judge: false, text: true },
      { judge: true, text: false },
    ]) {
      const judge = vi.fn(judgeBy({}))
      const s = await session({ ready: () => ready, judge })

      const result = await infer(s, [api, favorite, team])

      expect(result).toMatchObject({
        fills: [],
        write: [],
        page: ["team"],
        degraded: true,
      })
      expect(result.questions).toEqual(
        plainQuestions([api, favorite], ["api", "favorite"])
      )
      expect(s.h.db.runs).toHaveLength(ready.judge || ready.text ? 1 : 0)
      expect(judge).toHaveBeenCalledTimes(ready.judge ? 1 : 0)
      expect(only(s.h.db.autofillApplications).counts).toEqual(COUNTS)
    }
  })

  it("records one run row with summed tokens", async () => {
    const s = await session()

    const result = await infer(s, [api, favorite])

    expect(only(s.h.db.runs)).toMatchObject({
      kind: "autofill",
      hintSkillId: "autofill.infer",
      resumeId: s.resumeId,
      model: "stub-model",
      input: {},
      status: "completed",
      errorClass: null,
      inputTokens: 30,
      outputTokens: 15,
    })
    expect(only(s.h.db.autofillApplications).counts).toEqual(COUNTS)
    expect(result.quota.remaining).toBe(59)
  })

  it("closes the run when infer breaks after it starts", async () => {
    const s = await session({
      judge: async () => ({
        get choices(): JudgeOutput["choices"] {
          throw new Error("Malformed output")
        },
        multi: {},
        open: {},
        usage: USAGE,
      }),
    })

    await expect(infer(s, [api])).rejects.toThrow("Malformed output")
    expect(only(s.h.db.runs)).toMatchObject({
      status: "failed",
      errorClass: "internal",
    })
  })

  it("refuses past the hourly limit", async () => {
    const judge = vi.fn(judgeBy({}))
    const s = await session({ judge })
    for (let i = 0; i < 60; i++) {
      await s.h.runService.startAutofill({
        resumeId: s.resumeId,
        procedure: "autofill.infer",
        model: "stub-model",
      })
    }

    await expect(infer(s, [api])).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: expect.any(Number),
    })
    expect(s.h.db.runs).toHaveLength(60)
    expect(judge).not.toHaveBeenCalled()
  })

  it("refuses a deleted resume without a run", async () => {
    const s = await session()
    await s.h.resumeService.remove(s.resumeId)

    await expect(infer(s, [api])).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(s.h.db.runs).toEqual([])
  })

  it("spends nothing when no field needs AI", async () => {
    const consent = field("consent", "I consent", "select", { options: YES_NO })
    const judge = vi.fn(judgeBy({}))
    const s = await session({ judge })

    const result = await infer(s, [consent, team, { ...api, hasValue: true }])

    expect(result).toEqual({
      fills: [],
      write: [],
      page: ["team"],
      questions: [],
      degraded: false,
      quota: { remaining: 60, resetAt: null },
    })
    expect(s.h.db.runs).toEqual([])
    expect(judge).not.toHaveBeenCalled()
    expect(only(s.h.db.autofillApplications).counts).toEqual(COUNTS)
  })

  it("still answers when the application record is gone", async () => {
    const s = await session()

    const result = await infer(s, [api], { applicationId: crypto.randomUUID() })

    expect(result.questions).toEqual(plainQuestions([api], ["api"]))
    expect(only(s.h.db.autofillApplications).counts).toBeNull()
  })

  it("sends a short answer only the applicant can give to the page", async () => {
    const s = await session({
      shortText: shortBy({
        [favorite.label]: { value: null, evidence: [], applicant: true },
        [reference.label]: { value: "ada@example.com", applicant: true },
      }),
    })

    const result = await infer(s, [favorite, reference])

    expect(result.page).toEqual(["favorite", "reference"])
    expect(result.fills).toEqual([])
    expect(asked(result)).toEqual([])
  })

  it("judges a select that takes several options as a multi-select", async () => {
    const stacks = field("stacks", "Which stacks have you shipped?", "select", {
      multiple: true,
      options: [
        { id: "#1", label: "Rails" },
        { id: "#2", label: "Django" },
      ],
    })
    const judge = vi.fn(judgeBy({ multi: { [stacks.label]: [0.9, 0.1] } }))
    const s = await session({ judge })

    const result = await infer(s, [stacks])

    expect(judge.mock.calls[0]?.[0]).toMatchObject({
      choices: [],
      multi: [{ label: stacks.label, options: ["Rails", "Django"] }],
    })
    expect(result.fills).toEqual([
      {
        fieldId: "stacks",
        source: "ai",
        kind: "options",
        optionIds: ["#1"],
        labels: ["Rails"],
      },
    ])
  })

  it("drops search answers that do not fit", async () => {
    const code = field("code", "Nearest airport code", "combobox", {
      maxLength: 3,
    })
    const answering = (officeValue: string, codeValue: string) =>
      session({
        shortText: shortBy({
          [office.label]: { value: officeValue },
          [code.label]: { value: codeValue },
        }),
      })
    const search = (fieldId: string, value: string) => ({
      fieldId,
      source: "ai",
      kind: "search",
      query: value,
      target: value,
    })

    const fits = await infer(await answering("D".repeat(200), "SFO"), [
      office,
      code,
    ])
    expect(fits.fills).toEqual([
      search("office", "D".repeat(200)),
      search("code", "SFO"),
    ])

    const long = await infer(await answering("D".repeat(201), "SFOX"), [
      office,
      code,
    ])
    expect(long.fills).toEqual([])
    expect(asked(long)).toEqual(["office", "code"])
  })

  it("keeps a short answer within the answer limit whatever the field allows", async () => {
    const summary = field("summary", "Summary of your experience", "text", {
      maxLength: 10_000,
    })
    const answering = (value: string) =>
      session({ shortText: shortBy({ [summary.label]: { value } }) })

    const fits = await infer(await answering("x".repeat(4_000)), [summary])
    expect(fits.fills).toEqual([
      {
        fieldId: "summary",
        source: "ai",
        kind: "text",
        value: "x".repeat(4_000),
      },
    ])
    const long = await infer(await answering("x".repeat(4_001)), [summary])
    expect(asked(long)).toEqual(["summary"])
  })

  it("passes vendor demographic fields to the judge with their original labels", async () => {
    // Greenhouse's race question, labeled in Spanish.
    const race = field("race", "Raza", "select", { options: YES_NO })
    const judge = vi.fn(judgeBy({}))
    const s = await session({ judge })

    const result = await infer(s, [race, api])

    expect(judge.mock.calls[0]?.[0].choices.map(({ label }) => label)).toEqual([
      race.label,
      api.label,
    ])
    expect(asked(result)).toEqual(["race", "api"])
  })

  it("calls only the models a request needs", async () => {
    const judge = vi.fn(
      judgeBy({
        choices: {
          [api.label]: { option: 0, applicant: false, confidence: 0.9 },
        },
      })
    )
    const shortText = vi.fn(
      shortBy({ [reference.label]: { value: "ada@example.com" } })
    )
    const questions = vi.fn<AutofillModels["questions"]>(async () => ({
      questions: [],
      usage: USAGE,
    }))
    const s = await session({ judge, shortText, questions })

    await infer(s, [api])
    expect(shortText).not.toHaveBeenCalled()
    await infer(s, [reference])
    expect(judge).toHaveBeenCalledTimes(1)
    expect(shortText).toHaveBeenCalledTimes(1)
    // Nothing was left to ask either time.
    expect(questions).not.toHaveBeenCalled()
    expect(
      s.h.db.runs.map(({ inputTokens, outputTokens }) => [
        inputTokens,
        outputTokens,
      ])
    ).toEqual([
      [10, 5],
      [10, 5],
    ])
  })

  it("counts both deadlines from the start of the request", async () => {
    vi.useFakeTimers()
    const later = <T>(ms: number, value: T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
    const judge = vi.fn<AutofillModels["judge"]>(() =>
      later(3_000, { choices: {}, multi: {}, open: {}, usage: USAGE })
    )
    const questions = vi.fn<AutofillModels["questions"]>(async () => ({
      questions: [],
      usage: USAGE,
    }))
    const s = await session({ judge, questions })
    // Loading the Profile spends two seconds of the budget.
    const profiles = s.h.autofillProfiles
    const get = profiles.get.bind(profiles)
    vi.spyOn(profiles, "get").mockImplementation(() =>
      later(2_000, null).then(() => get())
    )
    const begun = Date.now()

    const pending = infer(s, [api])
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending

    expect(judge.mock.calls[0]?.[0].deadline).toBe(begun + JUDGE_MS)
    expect(questions.mock.calls[0]?.[0].deadline).toBe(begun + INFER_MS)
    expect(result.degraded).toBe(false)
    // Each step clears its deadline once it is done.
    expect(vi.getTimerCount()).toBe(0)
  })

  it("gives the models the applicant's Profile, resume and Notes", async () => {
    const judge = vi.fn(judgeBy({}))
    const shortText = vi.fn(shortBy({}))
    const s = await session({ judge, shortText })
    const { profile } = await s.h.autofillProfileService.get()
    const saved = {
      ...profile,
      personal: { ...profile.personal, first: "Ada" },
    }
    await s.h.autofillProfileService.save({
      profile: saved,
      expectedRevision: 0,
    })
    await s.h.autofillNotesService.save({
      content: "Prefers remote work.",
      expectedRevision: 0,
      snapshot: false,
    })
    const { data: resume } = await s.h.resumeService.get(s.resumeId)

    await infer(s, [api, favorite])

    const known = {
      profile: saved,
      resume,
      notes: "Prefers remote work.",
      job: null,
      today: s.h.db.now(),
    }
    expect(shortText.mock.calls[0]?.[0].context).toEqual(
      applicantContext({
        ...known,
        page: { company: "Stripe", title: "Software Engineer" },
      })
    )
    expect(judge.mock.calls[0]?.[0].context).toEqual(
      applicantContext({ ...known, page: { company: null, title: null } })
    )
  })
})
