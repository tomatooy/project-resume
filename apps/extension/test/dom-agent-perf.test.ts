import {
  InterpretationCache,
  newCheckpoint,
} from "@workspace/resume-core/dom-agent"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  METRICS_RING_SIZE,
  RunMetricsRing,
  RunMetricsSchema,
  devMetricsReadout,
  metricsReadout,
  payloadBytes,
  runMetrics,
  runMetricsRing,
  type RunMetrics,
} from "../src/dom-agent/metrics"
import {
  FROZEN_FORM,
  MemoryRunStore,
  frozenFormSession,
  planCounts,
  runFrozenForm,
} from "./helpers/perf-harness"

/**
 * The harness measures, and these tests pin what it measured so a change that
 * makes the run slower, or less honest about what it did, shows up as a number
 * rather than as a feeling. They also pin the privacy rule, so a later field
 * cannot quietly become a place to put content.
 *
 * Wall-clock time here is the harness in jsdom. The timings below therefore
 * prove the derivation and the exclusion of user wait, not any browser's speed.
 * A number a person would quote needs a real page, and nothing in this file
 * pretends otherwise.
 *
 * Two things limit what can be measured here, and both are recorded rather than
 * glossed. The page double cannot be told a site accepts a file, so the upload
 * path is not measured at all. And jsdom has one thread: a timing is the whole
 * harness, which is why the cold and warm passes are reported as counts and
 * kept apart, never as a ratio.
 */

afterEach(() => {
  document.body.replaceChildren()
  // Both, not just the env: this suite stubs `chrome` and `fetch`, and a global
  // left standing follows it into the next file and fails tests there.
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function checkpointAt(at: number) {
  return newCheckpoint({
    runId: "run-1",
    stateKey: "perf:frozen-form",
    sourceBundleId: "bundle-1",
    documentGeneration: "1",
    at,
  })
}

const NO_RECEIPTS: never[] = []

function metricsFor(input: {
  at: number
  now: number
  receipts?: Parameters<typeof runMetrics>[0]["receipts"]
  coverage?: { complete: boolean; gaps: readonly unknown[] }
}) {
  return runMetrics({
    phase: "cold",
    now: input.now,
    state: "auditing",
    receipts: input.receipts ?? NO_RECEIPTS,
    coverage: input.coverage ?? { complete: true, gaps: [] },
    checkpoint: checkpointAt(input.at),
    observations: 1,
    observationBytes: null,
    plannedQuestions: 0,
    replannedQuestions: 0,
    awaitingInput: 0,
  })
}

function receipt(
  questionRef: string,
  state: "dispatched" | "accepted" | "unresolved" | "failed" | "rejected",
  at: number
): Parameters<typeof runMetrics>[0]["receipts"][number] {
  return {
    actionRef: `a_${questionRef}`,
    questionRef,
    state,
    observed: {
      value: null,
      checked: null,
      optionRef: null,
      attachmentLabel: null,
    },
    evidence: [],
    at,
  }
}

function value(id: string): string {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "missing"
}

function checked(id: string): boolean {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false
}

describe("what a metrics record can hold", () => {
  it("holds numbers and booleans, so nothing describing a page can pass", () => {
    const record = metricsFor({ at: 1_000, now: 2_000 })
    const leaves: unknown[] = []
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry)
        return
      }
      if (typeof value === "object" && value !== null) {
        for (const entry of Object.values(value)) walk(entry)
        return
      }
      leaves.push(value)
    }
    walk(record)
    expect(leaves.length).toBeGreaterThan(10)
    // The only strings are members of two closed sets this module defines. There
    // is no free-text field, so there is nowhere for content to sit even if a
    // caller wanted to put it there.
    expect(new Set(leaves.filter((leaf) => typeof leaf === "string"))).toEqual(
      new Set(["cold", "auditing"])
    )
    expect(leaves.every((leaf) => typeof leaf !== "undefined")).toBe(true)
  })

  it("refuses content offered to either string field", () => {
    const record = metricsFor({ at: 1_000, now: 2_000 })
    for (const sentinel of ["Ada Lovelace", "Email address", "Cambridge"]) {
      expect(
        RunMetricsSchema.safeParse({ ...record, phase: sentinel }).success
      ).toBe(false)
      expect(
        RunMetricsSchema.safeParse({ ...record, state: sentinel }).success
      ).toBe(false)
    }
  })

  it("refuses a field the schema does not declare", () => {
    const record = metricsFor({ at: 1_000, now: 2_000 })
    expect(
      RunMetricsSchema.safeParse({ ...record, question: "Email address" })
        .success
    ).toBe(false)
  })

  it("drops the oldest record instead of growing without bound", () => {
    const ring = new RunMetricsRing(3)
    for (let index = 0; index < 5; index += 1)
      ring.record(metricsFor({ at: 1_000, now: 2_000 + index }))
    expect(ring.entries().length).toBe(3)
    // `at` is when the record was written, so the three survivors are the last
    // three clock readings.
    expect(ring.entries().map((entry) => entry.at)).toEqual([
      2_002, 2_003, 2_004,
    ])
    expect(METRICS_RING_SIZE).toBeGreaterThan(3)
  })

  it("keeps the dev readout out of a production build", () => {
    // The module's own buffer, which is the thing a dev build reads and the
    // only consumer this surface has until the panel wires it up.
    runMetricsRing.record(metricsFor({ at: 1_000, now: 2_000 }))
    expect(metricsReadout(runMetricsRing.entries()).length).toBe(1)

    vi.stubEnv("DEV", false)
    expect(devMetricsReadout()).toBeNull()
    vi.stubEnv("DEV", true)
    expect(devMetricsReadout()?.length).toBeGreaterThan(0)
    runMetricsRing.clear()
  })
})

describe("the numbers the boxes name", () => {
  it("times the first fill the page itself confirmed", () => {
    const record = runMetrics({
      phase: "cold",
      now: 5_000,
      state: "auditing",
      receipts: [
        receipt("q1", "dispatched", 4_000),
        receipt("q2", "accepted", 1_250),
        receipt("q3", "accepted", 1_900),
        receipt("q4", "unresolved", 1_100),
      ],
      coverage: { complete: false, gaps: [{}, {}] },
      checkpoint: checkpointAt(1_000),
      observations: 2,
      observationBytes: 512,
      plannedQuestions: 3,
      replannedQuestions: 1,
      awaitingInput: 2,
      model: { requests: 2, tokens: 1_024 },
    })
    // The earliest confirmation wins, and a dispatch is not a confirmation.
    expect(record.firstVerifiedFillMs).toBe(250)
    // Working time only: nothing waited on a person here.
    expect(record.completionMs).toBe(4_000)
    expect(record.accepted).toBe(2)
    // A dispatched write has not settled, so it counts as unresolved here. That
    // is the run's own rule: a dispatch is never a confirmation.
    expect(record.unresolved).toBe(2)
    expect(record.dispatched).toBe(4)
    expect(record.verificationFailures).toBe(0)
    expect(record.coverageComplete).toBe(false)
    expect(record.coverageGaps).toBe(2)
    expect(record.awaitingInput).toBe(2)
    expect(record.modelRequests).toBe(2)
    expect(record.modelTokens).toBe(1_024)
  })

  it("leaves the first fill null rather than zero when nothing was confirmed", () => {
    const record = metricsFor({
      at: 1_000,
      now: 2_000,
      receipts: [receipt("q1", "unresolved", 1_500)],
    })
    // Zero would read as instant; null says the thing never happened.
    expect(record.firstVerifiedFillMs).toBeNull()
    expect(record.accepted).toBe(0)
  })

  it("excludes the time the user was the blocker, over a real run", async () => {
    let now = 1_000_000
    const clock = () => now
    const form = await frozenFormSession()
    const store = new MemoryRunStore()
    const cache = new InterpretationCache()

    const cold = await runFrozenForm({
      phase: "cold",
      store,
      cache,
      clock,
      form,
    })
    await cold.run.pause("the user stepped away")
    // Ten minutes of a person, which is not the engine being slow.
    now += 600_000
    const warm = await runFrozenForm({
      phase: "warm",
      store,
      cache,
      clock,
      form,
    })

    expect(warm.report.checkpoint.waitedMs).toBeGreaterThanOrEqual(600_000)
    // The wall clock moved ten minutes; the measurement did not.
    expect(warm.metrics.completionMs).toBeLessThan(600_000)
    expect(cold.metrics.completionMs).toBeLessThan(600_000)
  })
})

describe("the frozen multi-field form", () => {
  it("answers every field a fact matches, with no model and no replanning", async () => {
    const form = await frozenFormSession()
    const measured = await runFrozenForm({
      phase: "cold",
      store: new MemoryRunStore(),
      cache: new InterpretationCache(),
      form,
    })

    expect(measured.report.questions.length).toBe(FROZEN_FORM.controls)
    expect(measured.metrics.accepted).toBe(FROZEN_FORM.answerable)
    expect(measured.metrics.dispatched).toBe(FROZEN_FORM.answerable)
    expect(measured.metrics.failed).toBe(0)
    // The salary is the one field left for a person, and nothing invented it.
    expect(measured.metrics.awaitingInput).toBe(FROZEN_FORM.review)
    expect(measured.metrics.state).toBe("needs_input")
    // No model round at all: the whole form is answered by wording.
    expect(measured.metrics.modelRequests).toBe(0)
    expect(measured.metrics.modelTokens).toBe(0)
    // One full read, and no question planned twice.
    expect(measured.observations).toBe(1)
    expect(measured.metrics.plannedQuestions).toBe(FROZEN_FORM.answerable)
    expect(measured.metrics.replannedQuestions).toBe(0)
    expect(measured.metrics.coverageComplete).toBe(true)
    expect(measured.metrics.coverageGaps).toBe(0)
    expect(measured.metrics.firstVerifiedFillMs).not.toBeNull()
    expect(measured.metrics.observationBytes).toBeGreaterThan(0)

    // The page itself holds the values, so "confirmed" is not the run's opinion.
    expect(value("first-name")).toBe("Ada")
    expect(value("email-address")).toBe("ada@example.com")
    expect(value("years-experience")).toBe("12")
    expect(value("earliest-start")).toBe("2026-01-05")
    expect(value("country")).toBe("gb")
    expect(checked("work-authorization-yes")).toBe(true)
    expect(checked("work-authorization-no")).toBe(false)
    expect(checked("sponsorship-no")).toBe(true)
    expect(checked("arrangement-hybrid")).toBe(true)
    // The one field it refused, it left alone.
    expect(value("desired-salary")).toBe("")
  })

  it("measures a warm pass separately, and it writes nothing new", async () => {
    const form = await frozenFormSession()
    const store = new MemoryRunStore()
    const cache = new InterpretationCache()
    const cold = await runFrozenForm({ phase: "cold", store, cache, form })
    const warm = await runFrozenForm({ phase: "warm", store, cache, form })

    // The evidence that a continue re-verified rather than rewrote: it appended
    // no batch, and it recorded no corrective attempt against any question.
    expect(warm.report.checkpoint.batches.length).toBe(
      cold.report.checkpoint.batches.length
    )
    expect(Object.keys(warm.report.checkpoint.attempts).length).toBe(0)
    // The confirmations it inherited survived a fresh observation of the page.
    expect(warm.metrics.accepted).toBe(FROZEN_FORM.answerable)
    expect(warm.metrics.modelRequests).toBe(0)
    expect(warm.observations).toBeGreaterThanOrEqual(1)
    // A pass that found nothing to do planned nothing. The questions it counts
    // as answered were planned by the pass that wrote them.
    expect(warm.metrics.plannedQuestions).toBe(0)
    expect(warm.metrics.replannedQuestions).toBe(0)

    const lines = metricsReadout([entry(cold), entry(warm)])
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain("cold")
    expect(lines[1]).toContain("warm")
    // Each pass is reported on its own terms. A speed claim would need a ratio
    // between them, and there is none, because this harness cannot make one.
    for (const line of lines) expect(line).not.toMatch(/\d\s*(x|×|faster)/i)
  })

  it("counts a question that had to be planned twice", async () => {
    const form = await frozenFormSession()
    const measured = await runFrozenForm({
      phase: "cold",
      store: new MemoryRunStore(),
      cache: new InterpretationCache(),
      form,
    })
    const [first] = measured.report.checkpoint.batches
    expect(first).toBeDefined()
    if (!first) return
    // A counter that always reads zero is indistinguishable from no counter, so
    // the same question is put in a second batch and the count has to move.
    const replanned = planCounts({
      ...measured.report.checkpoint,
      batches: [
        first,
        { ...first, index: first.index + 1, actionRefs: [...first.actionRefs] },
      ],
    })
    expect(replanned.replanned).toBeGreaterThan(0)
    expect(planCounts(measured.report.checkpoint).replanned).toBe(0)
  })
})

describe("privacy: content cannot reach a record", () => {
  /**
   * The applicant's own words: the facts the run answers from, and the labels
   * on the page. If any of them appears in a record, the rule is broken. The
   * assertion that they were in the run's hands is what stops this passing
   * because the run did nothing.
   */
  const SENTINELS = [
    "Lovelace",
    "ada@example.com",
    "+1 555 0100",
    "Analytical Engines",
    "Cambridge",
    "Mathematics",
    "Email address",
    "Desired salary",
  ]

  it("leaves the run's content in the run, and the record clean", async () => {
    const form = await frozenFormSession()
    const ring = new RunMetricsRing()
    const measured = await runFrozenForm({
      phase: "cold",
      store: new MemoryRunStore(),
      cache: new InterpretationCache(),
      form,
    })
    ring.record(measured.metrics)

    // The content was really there: the run read the labels and confirmed the
    // values, so a record that stays clean did so against real material.
    const whatTheRunHeld = JSON.stringify({
      questions: measured.report.questions,
      receipts: measured.report.receipts,
    })
    for (const sentinel of SENTINELS) expect(whatTheRunHeld).toContain(sentinel)

    // Nothing in the record, on any field, at any depth.
    const record = JSON.stringify(ring.entries())
    for (const sentinel of SENTINELS) expect(record).not.toContain(sentinel)

    // The dev readout renders the same fields, so it cannot show more than they
    // hold. Including its sequence number and its labels.
    const readout = metricsReadout(ring.entries()).join("\n")
    for (const sentinel of SENTINELS) expect(readout).not.toContain(sentinel)

    // Bounded too, so a long session cannot accumulate text through repetition.
    expect(payloadBytes(ring.entries()[0])).toBeLessThan(1_000)
  })

  it("never writes anywhere: no storage, no network", async () => {
    const fetchSpy = vi.fn()
    const read = vi.fn()
    const write = vi.fn()
    const remove = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    vi.stubGlobal("chrome", {
      storage: {
        session: { get: read, set: write, remove },
        local: { get: read, set: write, remove },
      },
    })

    const form = await frozenFormSession()
    const measured = await runFrozenForm({
      phase: "cold",
      store: new MemoryRunStore(),
      cache: new InterpretationCache(),
      form,
    })
    // The whole metrics path a run would take, end to end.
    runMetricsRing.record(measured.metrics)
    metricsReadout(runMetricsRing.entries())
    devMetricsReadout()

    // A record goes into memory and no further. The privacy rule cannot be
    // broken by a logging mistake if there is no logger.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    runMetricsRing.clear()
  })

  it("cannot be made to hold content by a caller that tries", async () => {
    const form = await frozenFormSession()
    const measured = await runFrozenForm({
      phase: "cold",
      store: new MemoryRunStore(),
      cache: new InterpretationCache(),
      form,
    })
    // Every field a caller can reach, offered content. None of them takes it.
    for (const sentinel of SENTINELS) {
      const attempt = { ...measured.metrics, phase: sentinel, state: sentinel }
      expect(RunMetricsSchema.safeParse(attempt).success).toBe(false)
    }
  })
})

function entry(run: { metrics: RunMetrics }) {
  const ring = new RunMetricsRing(1)
  ring.record(run.metrics)
  const [stored] = ring.entries()
  if (!stored) throw new Error("the ring kept nothing")
  return stored
}
