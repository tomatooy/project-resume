import { z } from "zod"
import type { Observation, ObservationNode } from "./observation"
import { RecordRefSchema } from "./primitives"
import type { CandidateQuestion } from "./question"
import type { Fact } from "./source"

/**
 * Record expansion as rules rather than orchestration: which page group a
 * source record serves, and when the honest answer is to ask instead of to
 * place. The coordinator decides whether the page wants another group; these
 * rules decide what may be bound to one, and refuse the rest.
 */

export const SourceRecordSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: z.enum(["experience", "education"]),
  /** The employer or school name the selected resume states for this record. */
  identity: z.string().min(1).max(500),
})
export type SourceRecord = z.infer<typeof SourceRecordSchema>

/**
 * The meanings a resume states that can name exactly one record. Anything else
 * a record holds (a title, a date) is a property of it, not a way to recognise
 * it: two records can share a title, and dates repeat across a history.
 */
const IDENTITY_KIND: ReadonlyMap<string, SourceRecord["kind"]> = new Map([
  ["employer name", "experience"],
  ["school name", "education"],
])

/**
 * The records the selected resume can serve, in the order it states them. A
 * record with no name of its own is left out rather than listed under a
 * placeholder: it cannot be recognised, so nothing may be bound to it.
 */
export function sourceRecords(facts: readonly Fact[]): SourceRecord[] {
  const records: SourceRecord[] = []
  const seen = new Set<string>()
  for (const fact of facts) {
    const kind = IDENTITY_KIND.get(fact.meaning)
    if (!kind) continue
    const scope = fact.scope.find((entry) => entry.dimension === "record")
    if (!scope || seen.has(scope.value)) continue
    const identity = fact.display.trim()
    if (!identity) continue
    seen.add(scope.value)
    records.push({ id: scope.value, kind, identity: identity.slice(0, 500) })
  }
  return records
}

/**
 * One repeated group as the page presents it. `values` is what the group
 * already shows, which is the only evidence that can identify the record it
 * holds.
 */
export const PageRecordGroupSchema = z.strictObject({
  groupRef: RecordRefSchema,
  values: z.array(z.string().max(500)).max(40),
  /** Whether the page marks this group as required. */
  required: z.boolean(),
  /**
   * The kind of record this group is for, when something states one. Null means
   * nothing said, never "either kind": the observation cannot state a kind,
   * because a group's label is the record's own name and a section heading is
   * page wording rather than a vocabulary. The caller that added a group knows
   * which control it pressed, declares the kind here, and the rules below then
   * hold it to that.
   */
  kind: z.enum(["experience", "education"]).nullable(),
})
export type PageRecordGroup = z.infer<typeof PageRecordGroupSchema>

/**
 * Assemble the groups from the current observation. A group is its repeat
 * instances, and the values it holds are the live ones: a control the page
 * emptied is not evidence of anything.
 */
export function pageRecordGroups(input: {
  observation: Observation
  questions: readonly CandidateQuestion[]
}): PageRecordGroup[] {
  const nodes = new Map(input.observation.nodes.map((node) => [node.ref, node]))
  const groups = new Map<string, PageRecordGroup>()
  for (const question of input.questions) {
    const groupRef = question.recordRef
    if (groupRef === null) continue
    let group = groups.get(groupRef)
    if (!group) {
      group = { groupRef, values: [], required: false, kind: null }
      groups.set(groupRef, group)
    }
    const value = groupValue(nodes.get(question.controlRef))
    if (value !== null) group.values.push(value)
    if (question.requiredness.state === "required") group.required = true
  }
  return [...groups.values()]
}

/**
 * The text that could name the record a group holds. A selection names itself
 * by its label: a combobox that chose "Acme" holds a value the page chose,
 * which is not the name a person would read.
 */
function groupValue(node: ObservationNode | undefined): string | null {
  const control = node?.control
  if (!control) return null
  const selected = control.options.find((option) => option.selected)
  const value = (selected?.label ?? control.value ?? "").trim()
  return value ? value.slice(0, 500) : null
}

export const RecordGroupBindingSchema = z.strictObject({
  groupRef: RecordRefSchema,
  recordId: z.string().min(1).max(64),
  evidence: z.enum([
    "observed_identity_match",
    "added_for_record",
    "only_remaining_record",
  ]),
})
export type RecordGroupBinding = z.infer<typeof RecordGroupBindingSchema>

export const RecordGroupRefusalSchema = z.strictObject({
  groupRef: RecordRefSchema,
  reason: z.enum(["ambiguous_assignment", "duplicate_record"]),
  /** What the user would choose between, as the resume states it. */
  candidates: z.array(z.string().min(1).max(500)).max(10),
})
export type RecordGroupRefusal = z.infer<typeof RecordGroupRefusalSchema>

export const NextRecordGroupStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("add_group"),
    recordId: z.string().min(1).max(64),
  }),
  z.strictObject({ kind: z.literal("none") }),
])
export type NextRecordGroupStep = z.infer<typeof NextRecordGroupStepSchema>

export const RecordGroupPlanSchema = z.strictObject({
  bindings: z.array(RecordGroupBindingSchema).max(40),
  refusals: z.array(RecordGroupRefusalSchema).max(40),
  /** Groups the resume does not account for. Left as the application holds them. */
  supplements: z.array(RecordRefSchema).max(40),
  /** Required groups the resume cannot serve, so the missing facts are asked for. */
  missing: z.array(RecordRefSchema).max(40),
  next: NextRecordGroupStepSchema,
})
export type RecordGroupPlan = z.infer<typeof RecordGroupPlanSchema>

/**
 * A group this run added itself, and the record it added it for. That is a
 * fact about the run, not a guess about the page.
 */
export const AddedGroupSchema = z.strictObject({
  groupRef: RecordRefSchema,
  recordId: z.string().min(1).max(64),
})
export type AddedGroup = z.infer<typeof AddedGroupSchema>

/**
 * Bind the page's groups to the resume's records.
 *
 * `added` is the only thing that lets a blank group be bound while more than
 * one record is still unplaced. Without it, a blank group is bound only when
 * exactly one record remains, which is the one case where its position carries
 * no information at all. Everywhere else the rule is to refuse: an assignment
 * nobody can justify is not made more likely to be right by guessing from
 * position.
 *
 * A group holding content the resume does not account for is a supplement. It
 * stays in the application and is never written back to the resume.
 */
export function recordGroupPlan(input: {
  groups: readonly PageRecordGroup[]
  records: readonly SourceRecord[]
  added?: readonly AddedGroup[]
}): RecordGroupPlan {
  const bindings: RecordGroupBinding[] = []
  const refusals: RecordGroupRefusal[] = []
  const supplements: string[] = []
  const missing: string[] = []
  const bound = new Set<string>()
  const addedFor = new Map(
    (input.added ?? []).map((entry) => [entry.groupRef, entry.recordId])
  )
  const blank: PageRecordGroup[] = []

  for (const group of input.groups) {
    if (group.values.length === 0) {
      blank.push(group)
      continue
    }
    const matched = input.records.filter(
      (record) =>
        kindMatches(group, record) &&
        group.values.some((value) => sameName(value, record.identity))
    )
    if (matched.length === 0) {
      supplements.push(group.groupRef)
      continue
    }
    if (matched.length > 1) {
      refusals.push({
        groupRef: group.groupRef,
        reason: "ambiguous_assignment",
        candidates: names(matched),
      })
      continue
    }
    const record = matched[0]
    if (!record) continue
    if (bound.has(record.id)) {
      // Never place one record twice: the extra group is the user's to
      // resolve, not something to fill from a record already used.
      refusals.push({
        groupRef: group.groupRef,
        reason: "duplicate_record",
        candidates: names([record]),
      })
      continue
    }
    bound.add(record.id)
    bindings.push({
      groupRef: group.groupRef,
      recordId: record.id,
      evidence: "observed_identity_match",
    })
  }

  for (const group of blank) {
    const recordId = addedFor.get(group.groupRef)
    if (recordId === undefined) continue
    const record = input.records.find((entry) => entry.id === recordId)
    if (!record || bound.has(record.id)) continue
    bound.add(record.id)
    bindings.push({
      groupRef: group.groupRef,
      recordId: record.id,
      evidence: "added_for_record",
    })
  }

  const unclaimed = blank.filter(
    (group) => !bindings.some((binding) => binding.groupRef === group.groupRef)
  )
  const lone = unclaimed.length === 1 ? unclaimed[0] : undefined
  // Only a record of the group's own kind can answer it: a blank education
  // group is not completed by a job, however few jobs are left. A group that
  // declares nothing keeps the old answer, which is that any record may serve.
  const last = lone ? sole(remainingFor(lone, input.records, bound)) : undefined
  if (lone && last) {
    bound.add(last.id)
    bindings.push({
      groupRef: lone.groupRef,
      recordId: last.id,
      evidence: "only_remaining_record",
    })
  } else {
    for (const group of unclaimed) {
      const remaining = remainingFor(group, input.records, bound)
      if (remaining.length === 0) {
        // A page asking for more history than this resume holds is a question
        // for the user, never a reason to invent a record.
        if (group.required) missing.push(group.groupRef)
        continue
      }
      refusals.push({
        groupRef: group.groupRef,
        reason: "ambiguous_assignment",
        candidates: names(remaining),
      })
    }
  }

  // Adding is withheld while anything is unresolved, so a group this run added
  // is bound before the next one is asked for.
  const settled = refusals.length === 0 && missing.length === 0
  const next: NextRecordGroupStep = settled
    ? nextAdd(input.groups, input.records, bound)
    : { kind: "none" }

  return RecordGroupPlanSchema.parse({
    bindings,
    refusals,
    supplements,
    missing,
    next,
  })
}

/** A group that declares no kind is answered by either, so nothing is refused twice. */
function kindMatches(group: PageRecordGroup, record: SourceRecord): boolean {
  return group.kind === null || group.kind === record.kind
}

/** The records still free to answer this group, of its own kind only. */
function remainingFor(
  group: PageRecordGroup,
  records: readonly SourceRecord[],
  bound: ReadonlySet<string>
): SourceRecord[] {
  return records.filter(
    (record) => !bound.has(record.id) && kindMatches(group, record)
  )
}

function sole(records: readonly SourceRecord[]): SourceRecord | undefined {
  return records.length === 1 ? records[0] : undefined
}

/**
 * The record to add a group for next, or none.
 *
 * A page showing no group is not a page asking for one. The reader marks a
 * group by the repetition it sees, so with nothing marked there is no container
 * to grow and no control that grows it. Proposing an add anyway is how a page
 * holding a single unmarked entry gets a blank duplicate of a record it already
 * shows, which puts a wrong entry into a real application. Pressing nothing is
 * the safe answer, and an incomplete run is the honest one.
 */
function nextAdd(
  groups: readonly PageRecordGroup[],
  records: readonly SourceRecord[],
  bound: ReadonlySet<string>
): NextRecordGroupStep {
  if (groups.length === 0) return { kind: "none" }
  const record = records.find((entry) => !bound.has(entry.id))
  return record ? { kind: "add_group", recordId: record.id } : { kind: "none" }
}

/** Two records can share a name; the page's own spacing still identifies them. */
function sameName(left: string, right: string): boolean {
  return normalize(left) === normalize(right)
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function names(records: readonly SourceRecord[]): string[] {
  return records.slice(0, 10).map((record) => record.identity)
}
