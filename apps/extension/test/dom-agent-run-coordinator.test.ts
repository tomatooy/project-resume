import {
  BatchRecordSchema,
  FactSchema,
  type Fact,
  ReceiptSchema,
  type Receipt,
  type RunCheckpoint,
  RunCheckpointSchema,
  RunIntentSchema,
  SourceBundleSchema,
  type SourceBundle,
  newCheckpoint,
} from "@workspace/resume-core/dom-agent"
import { afterEach, describe, expect, it } from "vitest"
import { PageRun, type RunStore } from "../src/dom-agent/run-coordinator"
import { StaleResultError } from "../src/dom-agent/session"
import {
  createRuntimeState,
  handleDispatch,
  type RuntimeState,
} from "../src/dom-agent/runtime/dispatch"
import {
  RUNTIME_EVIDENCE,
  RUNTIME_GLOBAL_PREFIX,
  RUNTIME_VERSION,
} from "../src/dom-agent/runtime/protocol"
import {
  countsAsUserEdit,
  watchUserEdits,
} from "../src/dom-agent/runtime/user-edits"
import {
  type PageTransport,
  attachPage,
  buildPage,
  buildPageFrom,
  createPageTransport,
} from "./helpers/cdp-page"

/**
 * The run, driven against a page double: batching, checkpoints, recovery,
 * pause and continue, the user's own edits, interruptions and the ceilings.
 *
 * The double is the same one the tracer bullet is tested with, so the receipts
 * and the writes are the real ones. What is added here is the page's own edit
 * count and a store that records the order in which the checkpoint was written
 * relative to what was dispatched.
 */

const RESUME_ID = "33333333-3333-4333-8333-333333333333"
const BUNDLE_TEXT = "var VsDomAgent={};"
const STATE_KEY = "domagent:acct:11:https://jobs.example.com/apply?jobid=42"

const globalSlots = globalThis as unknown as Record<string, unknown>

type Harness = {
  run: (options?: {
    store?: RecordingStore
    attachments?: boolean
    /** Called before each action leaves, with how many already have. */
    beforeDispatch?: (count: number) => void
    /**
     * True for the control whose reply never comes back. The action still
     * leaves and the intent is still on disk; only the answer is missing.
     */
    loseResponse?: (element: Element) => boolean
  }) => {
    run: PageRun
    store: RecordingStore
  }
  session: Awaited<ReturnType<typeof attachPage>>["session"]
  transport: PageTransport
  state: RuntimeState
  reread: () => void
  installs: () => number
  dispatches: DispatchEntry[]
  reads: () => number
}

type DispatchEntry = {
  actionRef: string
  questionRef: string
  intentsSavedSoFar: string[]
}

class RecordingStore implements RunStore {
  checkpoint: RunCheckpoint | null = null
  readonly saves: RunCheckpoint[] = []
  /** How many saves had happened when the run cleared its state. */
  readonly clearedAtIndex: number[] = []

  async load(): Promise<RunCheckpoint | null> {
    return this.checkpoint
  }

  async save(checkpoint: RunCheckpoint): Promise<void> {
    this.checkpoint = checkpoint
    this.saves.push(checkpoint)
  }

  async clear(): Promise<void> {
    this.clearedAtIndex.push(this.saves.length)
    this.checkpoint = null
  }

  intents(): string[] {
    return this.checkpoint?.intents.map((intent) => intent.actionRef) ?? []
  }
}

async function page(
  html: string,
  pageOptions?: { facts?: Fact[] }
): Promise<Harness> {
  const base = createPageTransport()
  let built = buildPage(html)
  const rootId = built.dom.backendNodeId
  const root = rootId === undefined ? undefined : built.elements.get(rootId)
  if (root) document.body.appendChild(root as Element)
  base.setDocument(null, built)
  const objects = new Map<string, Element>()
  const dispatches: DispatchEntry[] = []
  let installs = 0
  let reads = 0
  let state = createRuntimeState()
  let currentStore: RecordingStore | null = null
  const hooks: {
    beforeDispatch?: (count: number) => void
    loseResponse?: (element: Element) => boolean
  } = {}

  const open = () => {
    installs += 1
    const key = `${RUNTIME_GLOBAL_PREFIX}_test${installs}`
    state = createRuntimeState()
    watchUserEdits(state)
    type DispatchArgs = [unknown, unknown, unknown, unknown, unknown, unknown]
    globalSlots[key] = function (
      this: unknown,
      ...[actionRef, questionRef, verb, step, expect, version]: DispatchArgs
    ) {
      return handleDispatch.call(
        this,
        actionRef,
        questionRef,
        verb,
        step,
        expect,
        version,
        state
      )
    }
    return { version: RUNTIME_VERSION, nonce: `test${installs}`, key }
  }

  const transport: PageTransport = {
    ...base,
    commands: base.commands,
    transport: {
      async send(sessionId, method, params) {
        if (method === "Runtime.evaluate") return { result: { value: open() } }
        if (method === "DOM.getDocument") {
          reads += 1
          return base.transport.send(sessionId, method, params)
        }
        if (method === "DOM.resolveNode") {
          const element = built.elements.get(Number(params?.backendNodeId))
          if (!element) throw new Error("No such node")
          const objectId = `node-${String(params?.backendNodeId)}`
          objects.set(objectId, element as Element)
          return { object: { objectId } }
        }
        if (method === "Runtime.callFunctionOn") {
          const paramsRecord = params as Record<string, unknown> | undefined
          const objectId = paramsRecord?.objectId
          const args = paramsRecord?.arguments
          if (typeof objectId !== "string" || !Array.isArray(args))
            throw new Error("Malformed call")
          const values = args.map(
            (argument) => (argument as { value?: unknown }).value
          )
          const element = objects.get(objectId)
          if (!element) throw new Error("No such object")
          const runtime = globalSlots[String(values[0])]
          if (typeof runtime !== "function") throw new Error("Not installed")
          hooks.beforeDispatch?.(dispatches.length)
          dispatches.push({
            actionRef: String(values[1]),
            questionRef: String(values[2]),
            intentsSavedSoFar: currentStore?.intents() ?? [],
          })
          // The action left; the answer did not come back. A CDP reply that is
          // worthless is the shape of a lost response here, and it leaves no
          // receipt and no attempt behind for the next pass to judge on.
          if (hooks.loseResponse?.(element))
            throw new StaleResultError("The reply never arrived")
          const bound = runtime as (...args: unknown[]) => Promise<unknown>
          return {
            result: { value: await bound.call(element, ...values.slice(1)) },
          }
        }
        if (method === "Runtime.releaseObject") return {}
        return base.transport.send(sessionId, method, params)
      },
    },
  }

  const { session } = await attachPage({ tabId: 11, runId: "run-1", transport })

  return {
    session,
    transport,
    get state() {
      return state
    },
    reread: () => {
      if (!root) return
      built = buildPageFrom(root)
      base.setDocument(null, built)
    },
    installs: () => installs,
    dispatches,
    reads: () => reads,
    run: (options) => {
      const store = options?.store ?? new RecordingStore()
      currentStore = store
      hooks.beforeDispatch = options?.beforeDispatch
      hooks.loseResponse = options?.loseResponse
      const run = new PageRun({
        session,
        bundle: bundle(pageOptions?.facts ?? FACTS),
        store,
        stateKey: STATE_KEY,
        loadBundle: async () => BUNDLE_TEXT,
        attachments: options?.attachments
          ? {
              render: async () => ({
                identity: "0123456789abcdef",
                name: "ada-resume.pdf",
                type: "application/pdf",
                sizeBytes: 1_024,
                // The bytes are never read by the fake page, only their
                // presence and identity, so a short payload is enough here.
                base64: "JVBERi0=",
              }),
            }
          : undefined,
        clock: () => clock,
      })
      return { run, store }
    },
  }
}

let clock = 1_000

function fact(meaning: string, text: string): Fact {
  return FactSchema.parse({
    id: `f_${meaning.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    meaning,
    display: text,
    value: { type: "text", text },
    scope: [],
    source: { kind: "profile", section: "contact", field: meaning },
  })
}

const FACTS = [fact("email address", "ada@example.com"), fact("city", "Lisbon")]

function bundle(facts: Fact[]): SourceBundle {
  return SourceBundleSchema.parse({
    id: "bundle-1",
    resumeId: RESUME_ID,
    resumeVersionId: null,
    sources: [
      { kind: "resume", id: RESUME_ID, revision: 1, contentHash: "hash-1" },
    ],
    facts,
    render: {
      templateId: "lisbon",
      templateOptions: { pageSize: "LETTER", fontScale: 1 },
      locale: null,
      renderVersion: "1",
    },
  })
}

const FORM = `<form>
  <label for="email">Email address</label><input id="email" type="text">
  <label for="city">City</label><input id="city" type="text">
</form>`

const FILE_FORM = `<form>
  <label for="resume">Resume</label><input id="resume" type="file">
</form>`

/** One record the resume states, as the source records are built from facts. */
function recordFact(recordId: string, name: string): Fact {
  return FactSchema.parse({
    id: `f_${recordId}`,
    meaning: "employer name",
    display: name,
    value: { type: "text", text: name },
    scope: [{ dimension: "record", value: recordId }],
    source: {
      kind: "resume",
      resumeId: RESUME_ID,
      versionId: null,
      nodeId: `exp_${recordId}`,
      field: "employer",
    },
  })
}

function isFileInput(element: Element): boolean {
  return element instanceof HTMLInputElement && element.type === "file"
}

/** The receipt a page hands back when it takes the bytes. */
function acceptedUpload(questionRef: string): Receipt {
  return ReceiptSchema.parse({
    actionRef: "a1",
    questionRef,
    state: "accepted",
    observed: {
      value: null,
      checked: null,
      optionRef: null,
      attachmentLabel: "ada-resume.pdf",
    },
    evidence: [RUNTIME_EVIDENCE.fileListAssigned],
    at: clock,
  })
}

/**
 * A checkpoint exactly as an upload whose response was lost leaves one: the
 * intent is on disk, and what came back is either a receipt or nothing.
 */
function seededCheckpoint(input: {
  questionRef: string
  receipt: Receipt | null
  settled: "confirmed" | "uncertain" | null
}): RunCheckpoint {
  const base = newCheckpoint({
    runId: "run-1",
    stateKey: STATE_KEY,
    sourceBundleId: "bundle-1",
    documentGeneration: "1",
    at: clock,
  })
  return RunCheckpointSchema.parse({
    ...base,
    state: "paused",
    stopped: {
      kind: "connection",
      reason: "The debugging connection was lost",
      at: clock,
    },
    questionRevision: 2,
    intents: [
      RunIntentSchema.parse({
        kind: "upload",
        actionRef: "a1",
        questionRef: input.questionRef,
        // The site's own file list is not part of an observation, so an upload
        // is written down with no baseline for a later look to compare against.
        groupCount: null,
        attachmentName: null,
        at: clock,
        settled: input.settled,
      }),
    ],
    batches:
      input.receipt === null
        ? []
        : [
            BatchRecordSchema.parse({
              index: 0,
              actionRefs: ["a1"],
              dispatchedAt: clock,
              settledAt: null,
              receipts: [input.receipt],
              reobserve: "upload_parsing",
            }),
          ],
  })
}

afterEach(() => {
  document.body.replaceChildren()
  clock = 1_000
})

describe("batching independent work", () => {
  it("writes independent controls in one batch, with no stop between them", async () => {
    const harness = await page(FORM)
    const { run, store } = harness.run()
    const report = await run.start()

    expect(report.progress.accepted).toBe(2)
    // One batch, two actions: an independent write never forces a re-read of
    // the page the other one came from.
    expect(report.checkpoint.batches).toHaveLength(1)
    expect(report.checkpoint.batches[0]?.actionRefs).toHaveLength(2)
    expect(store.saves.length).toBeGreaterThan(0)
    expect(report.state).toBe("auditing")
    await harness.session.detach()
  })

  it("reads a control's options on request when they live outside its subtree", async () => {
    // A combobox whose options live in a portal: choosing from it is what
    // changes what the page asks next, so the options are read on request and
    // attached to the control that owns them.
    const harness = await page(`<form>
      <label for="country">Country</label>
      <input id="country" role="combobox" aria-expanded="false"
        aria-controls="list" aria-haspopup="listbox">
      <div id="list" role="listbox">
        <div role="option" id="pt" aria-selected="false">Portugal</div>
      </div>
    </form>`)
    const { run } = harness.run()
    const report = await run.start()

    const country = report.questions.find(
      (question) => question.text === "Country"
    )
    expect(country?.options.map((option) => option.label)).toEqual(["Portugal"])
    await harness.session.detach()
  })

  it("ends a batch at an action that changes what the page offers, and observes again", async () => {
    // The upload is the effect this double can drive to completion: what the
    // site makes of the file changes what it asks next, so the batch it belongs
    // to ends there and the next one is planned from an observation of its own.
    const harness = await page(`<form>
      <label for="email">Email address</label><input id="email" type="text">
      <label for="resume">Resume</label><input id="resume" type="file">
    </form>`)
    const { run } = harness.run({
      attachments: true,
      // A real page's DOM follows its own writes; this double only re-reads the
      // live DOM on demand, so it is asked to between the actions.
      beforeDispatch: () => harness.reread(),
    })
    const report = await run.start()

    expect(report.checkpoint.batches).toHaveLength(1)
    expect(report.checkpoint.batches[0]?.reobserve).toBe("upload_parsing")
    // The observation the effect invalidated is not reused: the page is read
    // again before anything else is planned from it.
    expect(harness.reads()).toBeGreaterThan(report.checkpoint.batches.length)
    await harness.session.detach()
  })
})

describe("checkpoints and intents", () => {
  it("writes the upload intent down before the attachment is dispatched", async () => {
    const harness = await page(`<form>
      <label for="resume">Resume</label><input id="resume" type="file">
    </form>`)
    const { run } = harness.run({ attachments: true })
    await run.start()

    const attach = harness.dispatches.find(
      (entry) => entry.questionRef.length > 0 && entry.actionRef.length > 0
    )
    expect(attach).toBeDefined()
    // The proof that matters: at the moment the action left, the checkpoint
    // already held its intent, so a response that never arrives leaves a
    // record rather than a silent second upload.
    expect(attach?.intentsSavedSoFar).toContain(attach?.actionRef)
    await harness.session.detach()
  })

  it("records the checkpoint at a batch boundary and on a pause", async () => {
    const harness = await page(FORM)
    const { run, store } = harness.run()
    await run.start()
    expect(store.saves.length).toBeGreaterThanOrEqual(2)
    const beforePause = store.saves.length
    await run.pause("The user asked it to wait")
    expect(store.saves.length).toBe(beforePause + 1)
    expect(store.checkpoint?.stopped?.kind).toBe("user")
    expect(store.checkpoint?.state).toBe("paused")
    await harness.session.detach()
  })
})

describe("recovering an action whose answer was lost", () => {
  it("leaves an upload intent open and explicit rather than retrying it blind", async () => {
    const harness = await page(`<form>
      <label for="resume">Resume</label><input id="resume" type="file">
    </form>`)
    const { run, store } = harness.run({ attachments: true })
    await run.start()
    // A lost response: the intent was saved, and the page cannot say whether
    // the upload landed, since the observation cannot see the site's state.
    expect(store.checkpoint?.intents.length).toBeGreaterThan(0)

    const readsBefore = harness.reads()
    const again = await run.continueRun()
    expect(harness.reads()).toBeGreaterThan(readsBefore)
    const note = again.recovered.find((entry) => entry.verdict === "uncertain")
    expect(note).toBeDefined()
    expect(note?.detail).toMatch(/region|attachment|could not/i)
    expect(
      store.checkpoint?.intents.every((intent) => intent.settled !== null)
    ).toBe(true)
    await harness.session.detach()
  })
})

describe("pause, continue and cancel", () => {
  it("continues by observing again, never by replaying the stored plan", async () => {
    const harness = await page(FORM)
    const { run, store } = harness.run()
    await run.start()
    const stored = store.checkpoint?.batches.flatMap(
      (batch) => batch.actionRefs
    )
    expect(stored?.length).toBe(2)

    // The page's own tree is the source of truth, so a second observation sees
    // what the writes did.
    harness.reread()
    const readsBefore = harness.reads()
    const dispatchedBefore = harness.dispatches.length
    const again = await run.continueRun()

    // A continue always re-observes before it proposes anything.
    expect(harness.reads()).toBeGreaterThan(readsBefore)
    // And the stored actions are history: a continue that finds them all still
    // true has nothing to send.
    const replayed = harness.dispatches
      .slice(dispatchedBefore)
      .map((entry) => entry.actionRef)
    expect(replayed).toEqual([])
    expect(again.progress.accepted).toBe(2)
    await harness.session.detach()
  })

  it("notices a value the page reverted and writes it again", async () => {
    const harness = await page(FORM)
    const { run } = harness.run()
    await run.start()
    const field = document.querySelector<HTMLInputElement>("#email")
    // The page takes the value back, which is what a framework can do after a
    // write the run believed: continue has to see that rather than trust its
    // own receipt.
    if (field) field.value = ""
    harness.reread()

    const again = await run.continueRun()
    expect(document.querySelector<HTMLInputElement>("#email")?.value).toBe(
      "ada@example.com"
    )
    expect(again.progress.accepted).toBeGreaterThanOrEqual(1)
    await harness.session.detach()
  })

  it("cancels without losing what was already written", async () => {
    const harness = await page(FORM)
    const { run } = harness.run()
    await run.start()
    const report = await run.cancel()
    expect(report.state).toBe("cancelled")
    // Values already written stay where they are: cancelling stops further
    // work, it does not promise to undo any.
    expect(document.querySelector<HTMLInputElement>("#email")?.value).toBe(
      "ada@example.com"
    )
    await harness.session.detach()
  })
})

describe("the user's own edits", () => {
  it("counts a trusted edit, and not our own write or the panel", async () => {
    const harness = await page(`<label for="email">Email address</label>
      <input id="email" type="text">
      <div data-vs-autofill="true"><input id="panel" type="text"></div>`)
    const field = document.querySelector<HTMLInputElement>("#email")
    const panel = document.querySelector<HTMLInputElement>("#panel")
    expect(harness.state.userEditEpoch).toBe(0)

    // A write this run makes dispatches its own event, and the browser marks it
    // untrusted. Counting it would pause the run on its own work.
    field?.dispatchEvent(new Event("input", { bubbles: true }))
    expect(harness.state.userEditEpoch).toBe(0)

    // jsdom will not let a test forge `isTrusted` on a dispatched event, so the
    // trusted half is asserted on the decision the listener makes, and the
    // untrusted half above went through the real listener.
    expect(countsAsUserEdit({ isTrusted: true, target: field ?? null })).toBe(
      true
    )
    // Answering a question in the extension's own panel is an input to the
    // review flow, not an edit to the application form.
    expect(countsAsUserEdit({ isTrusted: true, target: panel ?? null })).toBe(
      false
    )
    expect(RUNTIME_EVIDENCE.userEditedPage).toBe("user_edited_page")
    await harness.session.detach()
  })

  it("pauses when the page refuses an action the user edited over", async () => {
    const harness = await page(FORM)
    const { run } = harness.run({
      // The user edits the form after the observation and before the write,
      // which is the moment the page can see and the worker cannot.
      beforeDispatch: (count) => {
        if (count === 0) harness.state.userEditEpoch = 1
      },
    })
    const report = await run.start()

    expect(report.state).toBe("paused")
    expect(report.waiting?.reason).toMatch(/edited/i)
    expect(report.progress.accepted).toBe(0)
    // Nothing was written into the page the user is working in.
    expect(document.querySelector<HTMLInputElement>("#email")?.value).toBe("")
    await harness.session.detach()
  })
})

describe("interruptions", () => {
  it("recovers a worker restart from the checkpoint and replays no action", async () => {
    const harness = await page(FORM)
    const { run, store } = harness.run()
    const first = await run.start()
    const written = first.checkpoint.batches.flatMap(
      (batch) => batch.actionRefs
    )
    expect(written.length).toBe(2)
    // The page's tree follows its own writes, so a fresh observation sees them.
    harness.reread()

    // A worker restart is a new object with the same storage: the checkpoint is
    // loaded, and the page is observed again rather than trusted.
    const restarted = harness.run({ store })
    const readsBefore = harness.reads()
    const dispatchedBefore = harness.dispatches.length
    const report = await restarted.run.interrupted({
      kind: "worker_restart",
      differentApplication: false,
      reason: "The service worker restarted",
    })

    expect(harness.reads()).toBeGreaterThan(readsBefore)
    // What was written before the restart is still accounted for.
    expect(report.receipts.length).toBeGreaterThanOrEqual(2)
    expect(report.checkpoint.batches.length).toBeGreaterThanOrEqual(1)
    // Nothing from the interrupted run is sent again: its actions are history.
    const replayed = harness.dispatches
      .slice(dispatchedBefore)
      .map((entry) => entry.actionRef)
    expect(replayed).toEqual([])
    // And the revision never moves backwards, because a write at a revision
    // the page already wrote is refused as a replay.
    expect(report.checkpoint.questionRevision).toBeGreaterThanOrEqual(
      first.checkpoint.questionRevision
    )
    await harness.session.detach()
  })

  it("pauses rather than throwing when the debugging session is taken away", async () => {
    const harness = await page(FORM)
    const { run } = harness.run()
    await run.start()
    // The tab navigated, another client attached, or the worker lost its
    // attachment: every command on this session now fails, and none of that is
    // a failed action.
    await harness.session.detach()

    const report = await run.continueRun()
    expect(report.state).toBe("paused")
    expect(report.waiting?.reason).toMatch(/connection/i)
    expect(report.checkpoint.stopped?.kind).toBe("connection")
  })

  it("starts fresh for a different application and inherits nothing", async () => {
    const harness = await page(FORM)
    const { run, store } = harness.run()
    await run.start()
    expect(store.checkpoint?.batches.length).toBeGreaterThan(0)
    harness.reread()

    const report = await run.interrupted({
      kind: "navigation",
      differentApplication: true,
      reason: "The tab moved to another application",
    })
    // The store was cleared, and the checkpoint that replaced it carries no
    // history from the application that is gone.
    expect(store.clearedAtIndex).toHaveLength(1)
    const fresh = store.saves[store.clearedAtIndex[0] ?? 0]
    expect(fresh?.batches).toEqual([])
    expect(fresh?.intents).toEqual([])
    expect(fresh?.attempts).toEqual({})
    // Whatever it reports is its own work: nothing was inherited.
    expect(report.checkpoint.stopped?.kind).not.toBe("interruption")
    await harness.session.detach()
  })
})

describe("the run ceiling", () => {
  it("stops incomplete with what is left and an offer to continue", async () => {
    const harness = await page(FORM)
    const { run } = harness.run()
    // Two minutes of working time is the ceiling, and waiting for a person is
    // not working time.
    clock = 1_000 + 121_000
    const report = await run.start()

    expect(report.exhausted?.offerContinue).toBe(true)
    expect(report.exhausted?.remaining.length).toBeGreaterThan(0)
    expect(report.state).toBe("incomplete")
    // It dispatched nothing, and it does not claim the page is ready.
    expect(report.progress.dispatched).toBe(0)
    expect(JSON.stringify(report.exhausted)).not.toContain("ready")
    await harness.session.detach()
  })

  it("does not count the time the user was the blocker", async () => {
    const harness = await page(FORM)
    const { run, store } = harness.run()
    await run.start()
    // A hundred seconds of work, which is inside the ceiling.
    clock = 1_000 + 100_000
    await run.pause("Waiting for the user")
    // Two hundred seconds pass while a person, not the engine, is the blocker.
    clock = 1_000 + 300_000
    const resumed = await run.continueRun()
    expect(resumed.exhausted).toBeNull()
    expect(store.checkpoint?.waitedMs).toBeGreaterThanOrEqual(200_000)
    await harness.session.detach()
  })

  it("checks the ceiling between the batches of one round, not only between rounds", async () => {
    // More fields than one batch holds, so there is a batch boundary in the
    // middle of a round for the ceiling to be checked at.
    const indexes = Array.from({ length: 26 }, (_, index) => index)
    const harness = await page(
      `<form>${indexes
        .map(
          (index) =>
            `<label for="f${index}">Field ${index}</label><input id="f${index}">`
        )
        .join("")}</form>`,
      { facts: indexes.map((index) => fact(`field ${index}`, `v${index}`)) }
    )
    const { run } = harness.run({
      // The budget runs out while the first batch is still dispatching.
      beforeDispatch: (count) => {
        if (count === 23) clock = 1_000 + 121_000
      },
    })
    const report = await run.start()

    expect(report.state).toBe("incomplete")
    expect(report.exhausted?.offerContinue).toBe(true)
    // The batch on the far side of the boundary was never sent: the run stopped
    // for its budget instead of overshooting it to the end of the round.
    expect(harness.dispatches).toHaveLength(24)
    await harness.session.detach()
  })
})

describe("an upload whose answer was lost", () => {
  it("is not sent again, and reaches the user instead", async () => {
    const harness = await page(FILE_FORM)
    const { run, store } = harness.run({
      attachments: true,
      loseResponse: isFileInput,
    })
    const first = await run.start()

    // The action left, its intent was already on disk, and nothing came back.
    expect(first.state).toBe("paused")
    expect(first.receipts).toEqual([])
    expect(store.checkpoint?.intents.map((intent) => intent.settled)).toEqual([
      null,
    ])
    expect(harness.dispatches).toHaveLength(1)

    // A continue looks at the page before it retries anything. The observation
    // cannot read the site's own file list, so the upload stays doubtful, and a
    // doubtful upload is the user's to settle rather than a second send.
    const again = await run.continueRun()
    expect(again.recovered.map((note) => note.verdict)).toContain("uncertain")
    expect(harness.dispatches).toHaveLength(1)
    expect(
      again.review.some((item) => item.reason === "not_dispatchable")
    ).toBe(true)
    await harness.session.detach()
  })
})

describe("what a fresh observation says about a lost upload", () => {
  it("confirms one the page answered for rather than reporting doubt", async () => {
    const harness = await page(FILE_FORM)
    const { run, store } = harness.run({ attachments: true })
    // The page's own reply did arrive, and only the intent is still open. A
    // receipt is the page's answer, and a fresh look at a file list cannot
    // improve on it, because there is nothing there to read.
    store.checkpoint = seededCheckpoint({
      questionRef: "q1",
      receipt: acceptedUpload("q1"),
      settled: null,
    })
    const report = await run.continueRun()

    expect(report.questions.map((question) => question.ref)).toEqual(["q1"])
    expect(report.recovered.map((note) => note.verdict)).toEqual(["confirmed"])
    expect(store.checkpoint?.intents[0]?.settled).toBe("confirmed")
    expect(harness.dispatches).toEqual([])
    await harness.session.detach()
  })

  it("cannot settle an intent whose question is no longer on the page", async () => {
    const harness = await page(FILE_FORM)
    const { run } = harness.run({
      attachments: true,
      loseResponse: isFileInput,
    })
    await run.start()
    // The page replaced what the intent was made for. Nothing here can say
    // whether the upload landed, and saying it did would be a guess.
    document.querySelector("#resume")?.remove()
    harness.reread()
    const report = await run.continueRun()

    const note = report.recovered.find((entry) => entry.actionRef === "a1")
    expect(note?.verdict).toBe("uncertain")
    expect(note?.detail).toMatch(/application/i)
    await harness.session.detach()
  })
})

describe("a failed write", () => {
  it("is not attempted again while the page says exactly the same thing", async () => {
    const harness = await page(FORM)
    const field = document.querySelector<HTMLInputElement>("#email")
    // The page takes the value back the moment it is written: the write fails
    // and the control is empty again, so the next observation sees the page it
    // saw before. That is the case a retry cannot learn anything from.
    field?.addEventListener("input", () => {
      if (field) field.value = ""
    })

    const { run, store } = harness.run()
    const first = await run.start()
    const emailRef = first.questions.find(
      (question) => question.text === "Email address"
    )?.ref
    expect(first.progress.accepted).toBe(1)
    expect(first.progress.failed).toBe(1)
    const dispatched = harness.dispatches.length
    expect(dispatched).toBe(2)
    // What the page said is kept beside the page's own state rather than folded
    // into it, which is what lets the next decision compare page with page.
    expect(store.checkpoint?.attempts[emailRef ?? ""]?.failure).toMatch(
      /value_reverted/
    )

    harness.reread()
    const again = await run.continueRun()
    expect(harness.dispatches.length).toBe(dispatched)
    expect(
      again.receipts.filter((receipt) => receipt.questionRef === emailRef)
    ).toHaveLength(1)
    await harness.session.detach()
  })
})

describe("what a report says about a question the page confirmed", () => {
  it("reads the same in a cold run and a warm one", async () => {
    const harness = await page(FORM)
    const { run, store } = harness.run()
    const cold = await run.start()

    // Both questions were confirmed by the page, so both are answered. A cold
    // run cannot report them as unverified: the receipts that decide it arrive
    // after the observation that planned them.
    expect(cold.progress.accepted).toBe(2)
    expect(Object.values(cold.dispositions)).toEqual(["answered", "answered"])

    harness.reread()
    const warm = await harness.run({ store }).run.continueRun()
    for (const question of cold.questions)
      expect(warm.dispositions[question.ref]).toBe(
        cold.dispositions[question.ref]
      )
    await harness.session.detach()
  })
})

describe("record groups", () => {
  it("plans the page's groups against the resume, and names what it cannot place", async () => {
    const harness = await page(
      `<form>
        <div id="jobs">
          <div class="job"><label for="e1">Employer name</label><input id="e1" value="Acme"></div>
          <div class="job"><label for="e2">Employer name</label><input id="e2" value="Globex"></div>
        </div>
      </form>`,
      {
        facts: [
          recordFact("rec_1", "Acme"),
          recordFact("rec_2", "Globex"),
          recordFact("rec_3", "Initech"),
        ],
      }
    )
    const { run } = harness.run()
    const report = await run.start()

    // Two entries on the page, and each one names a record the resume states.
    expect(
      report.recordGroups.bindings.map((binding) => binding.recordId)
    ).toEqual(["rec_1", "rec_2"])
    expect(report.recordGroups.refusals).toEqual([])
    // The third record has no group on this page. Stated rather than pressed:
    // the observation does not name a control that adds a group, and guessing
    // one is worse than reporting it.
    expect(report.recordGroups.next).toEqual({
      kind: "add_group",
      recordId: "rec_3",
    })
    expect(report.progress.dispatched).toBe(2)
    await harness.session.detach()
  })
})

describe("what the state table refuses", () => {
  it("does not continue a run the user cancelled", async () => {
    const harness = await page(FORM)
    const { run } = harness.run()
    await run.start()
    await run.cancel()
    const dispatched = harness.dispatches.length

    const again = await run.continueRun()
    expect(again.state).toBe("cancelled")
    expect(again.waiting?.reason).toMatch(/cancelled/i)
    expect(harness.dispatches.length).toBe(dispatched)
    await harness.session.detach()
  })
})
