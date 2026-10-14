import { describe, expect, it } from "vitest"
import { type Fact, FactSchema } from "../src/dom-agent/source"
import type { Observation, ObservationNode } from "../src/dom-agent/observation"
import {
  ObservationNodeSchema,
  ObservationSchema,
} from "../src/dom-agent/observation"
import type { CandidateQuestion } from "../src/dom-agent/question"
import { CandidateQuestionSchema } from "../src/dom-agent/question"
import {
  pageRecordGroups,
  recordGroupPlan,
  sourceRecords,
} from "../src/dom-agent/record-group"

const RESUME_ID = "11111111-1111-4111-8111-111111111111"

/**
 * Records as the selected resume states them. The rules under test never read
 * a browser reference, so every fixture here is a fact and a page value.
 */
function recordFact(
  record: string,
  meaning: string,
  display: string,
  field: string
): Fact {
  return FactSchema.parse({
    id: `resume:${record}.${field}`,
    meaning,
    display,
    value: { type: "text", text: display },
    scope: [{ dimension: "record", value: record }],
    source: {
      kind: "resume",
      resumeId: RESUME_ID,
      versionId: null,
      nodeId: record,
      field,
    },
  })
}

function employer(record: string, name: string): Fact {
  return recordFact(record, "employer name", name, "company")
}

function school(record: string, name: string): Fact {
  return recordFact(record, "school name", name, "school")
}

function control(
  value: string | null,
  selectedLabel?: string
): ObservationNode {
  return ObservationNodeSchema.parse({
    ref: `n${value ?? "blank"}${selectedLabel ?? ""}`,
    contextId: "root",
    parentRef: null,
    kind: "element",
    tag: "input",
    role: "textbox",
    name: null,
    text: null,
    control: {
      kind: "text",
      value,
      checked: null,
      multiple: false,
      readonly: false,
      disabled: false,
      options: selectedLabel
        ? [
            {
              ref: "o1",
              label: selectedLabel,
              value: "x",
              selected: true,
              disabled: false,
            },
          ]
        : [],
      accepts: null,
    },
  })
}

function observationOf(nodes: ObservationNode[]): Observation {
  return ObservationSchema.parse({
    id: "obs-1",
    contexts: [
      {
        id: "root",
        kind: "document",
        url: "https://example.test",
        generation: "g1",
        accessible: true,
      },
    ],
    nodes,
    regions: [],
    coverage: { complete: true, gaps: [] },
  })
}

function question(
  ref: string,
  controlRef: string,
  recordRef: string | null,
  required: boolean
): CandidateQuestion {
  return CandidateQuestionSchema.parse({
    ref,
    controlRef,
    groupRef: "reg-1",
    recordRef,
    kind: "short_text",
    text: `Question ${ref}`,
    description: null,
    options: [],
    requiredness: { state: required ? "required" : "optional", evidence: [] },
    scope: [],
  })
}

describe("the records a resume can serve", () => {
  it("names each record once, in the order the resume states them", () => {
    expect(
      sourceRecords([
        employer("exp_1", "Acme"),
        recordFact("exp_1", "job title", "Engineer", "role"),
        employer("exp_2", "Globex"),
        school("edu_1", "Instituto Superior"),
      ])
    ).toEqual([
      { id: "exp_1", kind: "experience", identity: "Acme" },
      { id: "exp_2", kind: "experience", identity: "Globex" },
      { id: "edu_1", kind: "education", identity: "Instituto Superior" },
    ])
  })

  it("leaves out a record it cannot name", () => {
    // A record with no employer name cannot be recognised, so nothing may be
    // bound to it rather than being listed under a placeholder.
    expect(
      sourceRecords([recordFact("exp_1", "job title", "Engineer", "role")])
    ).toEqual([])
  })
})

describe("assembling the page's groups", () => {
  it("reads the live values of the controls each group holds", () => {
    const nodes = [
      control("Acme"),
      control(null, "Globex"),
      control(null),
      control(""),
    ]
    const observation = observationOf(nodes)
    const questions = [
      question("q1", nodes[0]?.ref ?? "", "r1", true),
      question("q2", nodes[1]?.ref ?? "", "r1", false),
      question("q3", nodes[2]?.ref ?? "", "r2", false),
      question("q4", nodes[3]?.ref ?? "", "r2", false),
      question("q5", nodes[0]?.ref ?? "", null, false),
    ]
    expect(pageRecordGroups({ observation, questions })).toEqual([
      {
        kind: null,
        groupRef: "r1",
        values: ["Acme", "Globex"],
        required: true,
      },
      { kind: null, groupRef: "r2", values: [], required: false },
    ])
  })
})

describe("binding page groups to records", () => {
  const records = [
    { id: "exp_1", kind: "experience" as const, identity: "Acme" },
    { id: "exp_2", kind: "experience" as const, identity: "Globex" },
  ]

  it("binds a group the page already filled from one record", () => {
    const plan = recordGroupPlan({
      groups: [
        { kind: null, groupRef: "r1", values: ["Acme"], required: true },
      ],
      records,
    })
    expect(plan.bindings).toEqual([
      {
        groupRef: "r1",
        recordId: "exp_1",
        evidence: "observed_identity_match",
      },
    ])
    expect(plan.refusals).toEqual([])
  })

  it("refuses two jobs at one employer instead of merging them", () => {
    // Two records share a name, so the group's content cannot say which it
    // holds. The answer is to ask, not to place the first one.
    const twoAtAcme = [
      { id: "exp_1", kind: "experience" as const, identity: "Acme" },
      { id: "exp_3", kind: "experience" as const, identity: "Acme" },
    ]
    const plan = recordGroupPlan({
      groups: [
        { kind: null, groupRef: "r1", values: ["Acme"], required: true },
      ],
      records: twoAtAcme,
    })
    expect(plan.bindings).toEqual([])
    expect(plan.refusals).toEqual([
      {
        groupRef: "r1",
        reason: "ambiguous_assignment",
        candidates: ["Acme", "Acme"],
      },
    ])
    expect(plan.next).toEqual({ kind: "none" })
  })

  it("never places one record twice", () => {
    const plan = recordGroupPlan({
      groups: [
        { kind: null, groupRef: "r1", values: ["Acme"], required: true },
        { kind: null, groupRef: "r2", values: ["Acme"], required: true },
      ],
      records,
    })
    expect(plan.bindings.map((binding) => binding.groupRef)).toEqual(["r1"])
    expect(plan.refusals).toEqual([
      { groupRef: "r2", reason: "duplicate_record", candidates: ["Acme"] },
    ])
  })

  it("leaves a group the resume does not account for alone", () => {
    // Content the resume does not state is the applicant's own entry. It stays
    // in the application, so no binding is claimed and no record is consumed.
    const plan = recordGroupPlan({
      groups: [
        { kind: null, groupRef: "r1", values: ["Freelance"], required: false },
      ],
      records,
    })
    expect(plan.supplements).toEqual(["r1"])
    expect(plan.bindings).toEqual([])
    expect(plan.next).toEqual({ kind: "add_group", recordId: "exp_1" })
  })

  it("proposes no add when the page shows no group at all", () => {
    // The hazard the reader cannot see past: a page holding a single entry
    // marks no group, because marking needs repetition. An add proposed there
    // presses a control that grows a container the page already fills, and the
    // entry it duplicates is the person's own. With nothing observed, the run
    // proposes nothing and reports itself incomplete instead.
    const plan = recordGroupPlan({
      groups: [],
      records: [
        { id: "exp_1", kind: "experience", identity: "Acme" },
        { id: "exp_2", kind: "experience", identity: "Globex" },
      ],
    })
    expect(plan.next).toEqual({ kind: "none" })
    expect(plan.bindings).toEqual([])
    expect(plan.missing).toEqual([])
    expect(plan.refusals).toEqual([])
  })

  it("binds a blank group only when one record is left, and refuses otherwise", () => {
    const last = recordGroupPlan({
      groups: [
        { kind: "experience", groupRef: "r1", values: [], required: true },
      ],
      records: [{ id: "exp_2", kind: "experience", identity: "Globex" }],
    })
    expect(last.bindings).toEqual([
      {
        groupRef: "r1",
        recordId: "exp_2",
        evidence: "only_remaining_record",
      },
    ])

    // Two blanks and two records leave a pairing nobody can justify, and
    // position is not evidence for it.
    const ambiguous = recordGroupPlan({
      groups: [{ kind: null, groupRef: "r1", values: [], required: true }],
      records,
    })
    expect(ambiguous.bindings).toEqual([])
    expect(ambiguous.refusals).toEqual([
      {
        groupRef: "r1",
        reason: "ambiguous_assignment",
        candidates: ["Acme", "Globex"],
      },
    ])
    // And the next add is withheld, so the group already on the page is bound
    // before another one is asked for.
    expect(ambiguous.next).toEqual({ kind: "none" })
  })

  it("binds a group this run added for a named record", () => {
    const plan = recordGroupPlan({
      groups: [{ kind: null, groupRef: "r2", values: [], required: true }],
      records,
      added: [{ groupRef: "r2", recordId: "exp_2" }],
    })
    expect(plan.bindings).toEqual([
      { groupRef: "r2", recordId: "exp_2", evidence: "added_for_record" },
    ])
    // The record it was added for is placed, so the remaining one is next.
    expect(plan.next).toEqual({ kind: "add_group", recordId: "exp_1" })
  })

  it("asks for the facts when the page wants more history than the resume has", () => {
    // The page shows two experiences and the resume holds one. The second
    // group is a record the applicant has to supply; nothing is invented for
    // it and the run does not pretend the history is complete.
    const plan = recordGroupPlan({
      groups: [
        { kind: null, groupRef: "r1", values: ["Acme"], required: true },
        { kind: null, groupRef: "r2", values: [], required: true },
      ],
      records: [records[0]].flatMap((entry) => (entry ? [entry] : [])),
    })
    expect(plan.bindings.map((binding) => binding.recordId)).toEqual(["exp_1"])
    expect(plan.missing).toEqual(["r2"])
    expect(plan.next).toEqual({ kind: "none" })
  })

  it("leaves an optional group with no record blank", () => {
    const plan = recordGroupPlan({
      groups: [{ kind: null, groupRef: "r1", values: [], required: false }],
      records: [],
    })
    expect(plan.missing).toEqual([])
    expect(plan.refusals).toEqual([])
    expect(plan.next).toEqual({ kind: "none" })
  })

  it("binds an education group to a school", () => {
    const plan = recordGroupPlan({
      groups: [
        {
          kind: "education",
          groupRef: "r1",
          values: ["Instituto Superior"],
          required: true,
        },
      ],
      records: [
        { id: "edu_1", kind: "education", identity: "Instituto Superior" },
      ],
    })
    expect(plan.bindings).toEqual([
      {
        groupRef: "r1",
        recordId: "edu_1",
        evidence: "observed_identity_match",
      },
    ])
  })

  it("ignores the spacing and case the page adds to a name", () => {
    const plan = recordGroupPlan({
      groups: [
        { kind: null, groupRef: "r1", values: ["  acme  "], required: true },
      ],
      records,
    })
    expect(plan.bindings[0]?.recordId).toBe("exp_1")
  })

  it("leaves a blank education group unbound when only a job is left", () => {
    // The page asks for education and the only record left is a job. Binding it
    // would invent a school, so the group is reported as facts the applicant
    // has to supply instead.
    const plan = recordGroupPlan({
      groups: [
        { kind: "education", groupRef: "r1", values: [], required: true },
      ],
      records: [{ id: "exp_2", kind: "experience", identity: "Globex" }],
    })
    expect(plan.bindings).toEqual([])
    expect(plan.refusals).toEqual([])
    expect(plan.missing).toEqual(["r1"])
  })

  it("does not read a job as the answer to an education group", () => {
    // The group's content matches a job's employer, but the group says it is an
    // education group. Content the resume cannot account for in the kind the
    // page asked for stays the applicant's own entry, never a binding.
    const plan = recordGroupPlan({
      groups: [
        { kind: "education", groupRef: "r1", values: ["Acme"], required: true },
      ],
      records,
    })
    expect(plan.supplements).toEqual(["r1"])
    expect(plan.bindings).toEqual([])
  })
})
