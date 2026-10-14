import {
  FactSchema,
  type Fact,
  type RunCheckpoint,
  SourceBundleSchema,
  type SourceBundle,
} from "@workspace/resume-core/dom-agent"
import { afterEach, describe, expect, it } from "vitest"
import { PageRun, type RunStore } from "../src/dom-agent/run-coordinator"
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

async function page(html: string): Promise<Harness> {
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
  const hooks: { beforeDispatch?: (count: number) => void } = {}

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
      const run = new PageRun({
        session,
        bundle: bundle(FACTS),
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

  it("ends a batch at a control whose options were read on request, and observes again", async () => {
    // A combobox whose options live in a portal: choosing from it changes what
    // the page offers next, so the run must not plan the next write from the
    // observation that selection invalidated.
    const harness = await page(`<form>
      <label for="country">Country</label>
      <input id="country" role="combobox" aria-expanded="false">
      <div id="list" role="listbox">
        <div role="option" id="pt" aria-selected="false">Portugal</div>
      </div>
      <label for="city">City</label><input id="city" type="text">
    </form>`)
    const { run } = harness.run()
    const report = await run.start()

    const readsBeforeBatches = harness.reads()
    expect(report.checkpoint.batches.length).toBeGreaterThanOrEqual(1)
    // Every batch after the first one was planned from a fresh observation.
    expect(readsBeforeBatches).toBeGreaterThanOrEqual(
      report.checkpoint.batches.length
    )
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
})
