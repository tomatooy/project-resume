import { readFileSync } from "node:fs"
import { join } from "node:path"
import type {
  InterpretationCache,
  Fact,
  RunCheckpoint,
} from "@workspace/resume-core/dom-agent"
import type { CdpMethod, CdpParams } from "../../src/dom-agent/cdp"
import {
  payloadBytes,
  runMetrics,
  type RunMetrics,
} from "../../src/dom-agent/metrics"
import {
  PageRun,
  type RunReport,
  type RunStore,
} from "../../src/dom-agent/run-coordinator"
import { attachPage } from "./cdp-page"
import { FIXTURES_DIR } from "./fixture-loader"
import { BUNDLE_TEXT, bundle, fact, writingPage } from "./writing-page"

/**
 * The performance acceptance harness: one frozen form, one known set of facts,
 * and the run driven over both so the numbers are comparable between passes and
 * between changes.
 *
 * It drives the same page double the deterministic-path suite uses, because a
 * recording replays a page's data and holds no live elements, and a run that
 * writes needs elements. Sharing the double is the point: a second one would be
 * a second write path to keep in step with the runtime, and any difference
 * between them would show up as a performance number rather than as a bug.
 *
 * Nothing here asserts a speed. It measures and returns what it measured.
 */

/** One file, read once, so both the tests and a browser run use the same page. */
export const FROZEN_FORM_FILE = "frozen-form.html"

export function frozenFormHtml(): string {
  return readFileSync(join(FIXTURES_DIR, FROZEN_FORM_FILE), "utf8")
}

const text = (display: string): Fact["value"] => ({
  type: "text",
  text: display,
})
const choice = (display: string): Fact["value"] => ({
  type: "choice",
  optionIds: [display],
})
const yes: Fact["value"] = { type: "boolean", state: "yes" }
const no: Fact["value"] = { type: "boolean", state: "no" }

/**
 * Every fact the form is meant to be answerable from. The meaning is written
 * exactly as the form's label, because the deterministic tier binds a fact to a
 * question by wording alone: reword either side and the field stops being
 * answered without anything else changing.
 *
 * One field is deliberately left without a usable fact. A salary needs an
 * amount, a currency and a period together, and the deterministic tier refuses
 * to guess which reading a page wants, so it belongs in the review queue. A form
 * where everything is silently filled would measure a path nobody ships.
 */
export const FROZEN_FACTS: Fact[] = [
  fact("First name", "Ada", text("Ada")),
  fact("Last name", "Lovelace", text("Lovelace")),
  fact("Email address", "ada@example.com", text("ada@example.com")),
  fact("Phone number", "+1 555 0100", text("+1 555 0100")),
  fact("City", "London", text("London")),
  fact("Country", "United Kingdom", choice("United Kingdom")),
  fact(
    "LinkedIn profile",
    "https://linkedin.example/ada",
    text("https://linkedin.example/ada")
  ),
  fact(
    "Portfolio or website",
    "https://ada.example",
    text("https://ada.example")
  ),
  fact("Current company", "Analytical Engines", text("Analytical Engines")),
  fact("Current job title", "Software Engineer", text("Software Engineer")),
  fact("Years of experience", "12", { type: "number", number: 12 }),
  fact("University", "Cambridge", text("Cambridge")),
  fact("Field of study", "Mathematics", text("Mathematics")),
  fact("Highest education level", "Master's degree", choice("Master's degree")),
  fact("Are you authorized to work in this country?", "Yes", yes),
  fact("Will you require sponsorship?", "No", no),
  fact("Preferred work arrangement", "Hybrid", choice("Hybrid")),
  fact("Notice period", "One month", choice("One month")),
  fact("Earliest start date", "2026-01-05", {
    type: "date",
    year: 2026,
    month: 1,
    day: 5,
  }),
  fact("Desired salary", "120000 USD per year", {
    type: "money",
    amount: 120_000,
    currency: "USD",
    period: "year",
  }),
]

/** What the frozen form holds, counted from the file rather than assumed. */
export const FROZEN_FORM = {
  /** Questions the form presents. */
  controls: 20,
  /** Fields a fact answers without a model. */
  answerable: 19,
  /** Fields left for the user, which is one salary. */
  review: 1,
} as const

/** Checkpoints in memory: a run's own store, with nothing written to disk. */
export class MemoryRunStore implements RunStore {
  private checkpoint: RunCheckpoint | null = null

  async load(): Promise<RunCheckpoint | null> {
    return this.checkpoint
  }

  async save(checkpoint: RunCheckpoint): Promise<void> {
    this.checkpoint = checkpoint
  }

  async clear(): Promise<void> {
    this.checkpoint = null
  }
}

export type FrozenRunInput = {
  /** Cold is the first pass over the page; warm reuses what that pass built. */
  phase: "cold" | "warm"
  store: MemoryRunStore
  cache: InterpretationCache
  clock?: () => number
  /** Shared so a warm pass continues over the page a cold pass filled. */
  form: FrozenFormSession
}

export type FrozenRun = {
  metrics: RunMetrics
  report: RunReport
  observations: number
  /** The run itself, for a test that has to pause or continue it by hand. */
  run: PageRun
}

/**
 * What a pass planned, counted from the batches it wrote rather than from a
 * second tally that could disagree with them. A question that took a place in
 * more than one batch of this pass was planned again, which is the number this
 * harness exists to keep at zero on a form where nothing changes under the run.
 *
 * `from` is how many batches the pass inherited. A continue carries the batches
 * of the pass before it, and crediting it with their questions would report
 * planning that never happened.
 */
export function planCounts(
  checkpoint: RunCheckpoint,
  from = 0
): {
  planned: number
  replanned: number
} {
  const batchesPerQuestion = new Map<string, number>()
  for (const batch of checkpoint.batches.slice(from)) {
    for (const receipt of batch.receipts) {
      const seen = batchesPerQuestion.get(receipt.questionRef) ?? 0
      batchesPerQuestion.set(receipt.questionRef, seen + 1)
    }
  }
  let replanned = 0
  for (const count of batchesPerQuestion.values())
    if (count > 1) replanned += count - 1
  return { planned: batchesPerQuestion.size, replanned }
}

/** Drive one pass over the frozen form and measure it. */
export async function runFrozenForm(input: FrozenRunInput): Promise<FrozenRun> {
  const clock = input.clock ?? (() => Date.now())
  // A read sees the page as it stands, including what a previous pass wrote.
  input.form.reread()
  // Counted per pass: the counter is the session's, and a warm pass must not be
  // credited with the reads the cold pass made.
  const readsBefore = input.form.observations()
  // What this pass inherited, so its planning is counted as its own.
  const inherited = await input.store.load()
  const run = new PageRun({
    session: input.form.session,
    bundle: bundle(FROZEN_FACTS),
    store: input.store,
    stateKey: "perf:frozen-form",
    loadBundle: async () => BUNDLE_TEXT,
    cache: input.cache,
    clock,
  })
  const report =
    input.phase === "cold" ? await run.start() : await run.continueRun()
  const counts = planCounts(report.checkpoint, inherited?.batches.length ?? 0)
  const reads = input.form.observations() - readsBefore
  const metrics = runMetrics({
    phase: input.phase,
    now: clock(),
    state: report.state,
    receipts: report.receipts,
    coverage: report.coverage,
    checkpoint: report.checkpoint,
    observations: reads,
    observationBytes: report.observationBytes,
    plannedQuestions: counts.planned,
    replannedQuestions: counts.replanned,
    awaitingInput: report.review.length,
    model: { requests: 0, tokens: 0 },
  })
  return { metrics, report, observations: reads, run }
}

export type FrozenFormSession = {
  session: Awaited<ReturnType<typeof attachPage>>["session"]
  page: ReturnType<typeof writingPage>["page"]
  /** Full document reads served, which is what an observation costs. */
  observations: () => number
  /** The bytes the observation was built from, on the way out of the browser. */
  payloadBytes: () => number
  /**
   * Rebuild the trees from the page as it stands. A real read sees the page
   * after its own writes did, so the harness asks for that rather than leaving
   * the second pass reading the snapshot the first pass started from.
   */
  reread: () => void
}

/**
 * A page the run can read and write, counting what the reader actually asked
 * for. Counting at the transport is deliberate: it measures the reads that
 * happened rather than the reads the run believes it made.
 */
export async function frozenFormSession(): Promise<FrozenFormSession> {
  const built = writingPage(frozenFormHtml())
  let reads = 0
  let bytes = 0
  const page = {
    ...built.page,
    transport: {
      async send(
        sessionId: string | null,
        method: CdpMethod,
        params?: CdpParams
      ) {
        const reply = await built.page.transport.send(sessionId, method, params)
        if (
          method === "DOM.getDocument" ||
          method === "Accessibility.getFullAXTree"
        )
          bytes += payloadBytes(reply)
        if (method === "DOM.getDocument") reads += 1
        return reply
      },
    },
  }
  const { session } = await attachPage({
    tabId: 21,
    runId: "perf-run-1",
    transport: page,
  })
  return {
    session,
    page,
    observations: () => reads,
    payloadBytes: () => bytes,
    reread: built.reread,
  }
}
