import { describe, expect, it } from "vitest"
import {
  type RunCheckpoint,
  activeMs,
  allReceipts,
  ceilingStatus,
  exhaustionReport,
  intentForAction,
  newCheckpoint,
  openIntents,
  RunCheckpointSchema,
  settleIntent,
  withAttempt,
  withResume,
  withBatch,
  withIntents,
  withStop,
} from "../src/dom-agent/checkpoint"
import { ReceiptSchema } from "../src/dom-agent/receipt"

/**
 * The run's memory. Everything here has to survive a worker restart, so it is a
 * validated shape rather than a bag: a checkpoint that does not parse is a run
 * that cannot be resumed honestly.
 */

const at = 1_000

function checkpoint(): RunCheckpoint {
  return newCheckpoint({
    runId: "run-1",
    stateKey: "domagent:acct:7:https://jobs.example.com/apply?jobid=42",
    sourceBundleId: "bundle-1",
    documentGeneration: "1",
    at,
  })
}

function receipt(actionRef: string, questionRef: string) {
  return ReceiptSchema.parse({
    actionRef,
    questionRef,
    state: "accepted",
    observed: {
      value: "ada@example.com",
      checked: null,
      optionRef: null,
      attachmentLabel: null,
    },
    evidence: ["value_set"],
    at,
  })
}

describe("a new checkpoint", () => {
  it("starts observing, with nothing recorded and the first revision", () => {
    const fresh = checkpoint()
    expect(fresh.state).toBe("observing")
    expect(fresh.questionRevision).toBe(1)
    expect(fresh.waitedMs).toBe(0)
    expect(fresh.batches).toEqual([])
    expect(fresh.intents).toEqual([])
    expect(fresh.stopped).toBeNull()
  })

  it("refuses a shape it does not recognise", () => {
    const fresh = checkpoint()
    expect(() =>
      RunCheckpointSchema.parse({ ...fresh, surprise: true })
    ).toThrow()
    expect(() =>
      RunCheckpointSchema.parse({ ...fresh, state: "nearly_ready" })
    ).toThrow()
  })
})

describe("the run ceiling", () => {
  it("counts working time, not time spent waiting for the user", () => {
    const waiting: RunCheckpoint = { ...checkpoint(), waitedMs: 190_000 }
    // 200 seconds have passed, but the user was the blocker for 190 of them.
    expect(activeMs(waiting, at + 200_000)).toBe(10_000)
    expect(ceilingStatus({ checkpoint: waiting, now: at + 200_000 })).toEqual({
      exhausted: false,
      activeMs: 10_000,
      remainingMs: 110_000,
    })
  })

  it("reports exhaustion with a reason and no remaining budget", () => {
    const status = ceilingStatus({
      checkpoint: checkpoint(),
      now: at + 120_000,
    })
    expect(status.exhausted).toBe(true)
    if (!status.exhausted) throw new Error("expected exhaustion")
    expect(status.reason).toMatch(/two minute|120 second/i)
    expect(status.remainingMs).toBe(0)
  })

  it("offers to continue rather than claiming the page is ready", () => {
    const report = exhaustionReport({
      reason: "The run used its 120 second budget",
      remaining: ["q_email", "q_city"],
    })
    expect(report.state).toBe("incomplete")
    expect(report.remaining).toEqual(["q_email", "q_city"])
    expect(report.offerContinue).toBe(true)
    expect(JSON.stringify(report)).not.toContain("ready")
  })
})

describe("intents that must outlive a lost response", () => {
  it("is recorded before dispatch and unsettled until an observation speaks", () => {
    const intent = intentForAction({
      kind: "record_creation",
      actionRef: "a1",
      questionRef: "r1",
      groupCount: 2,
      attachmentName: null,
      at,
    })
    expect(intent.settled).toBeNull()

    const recorded = withIntents(checkpoint(), [intent])
    expect(openIntents(recorded)).toHaveLength(1)

    const confirmed = settleIntent(recorded, "a1", "confirmed", at + 5)
    expect(openIntents(confirmed)).toHaveLength(0)
    expect(confirmed.intents[0]?.settled).toBe("confirmed")
  })

  it("an upload intent carries what the field showed, so recovery has a baseline", () => {
    const intent = intentForAction({
      kind: "upload",
      actionRef: "a2",
      questionRef: "q_resume",
      groupCount: null,
      attachmentName: null,
      at,
    })
    expect(intent.attachmentName).toBeNull()
    expect(intent.groupCount).toBeNull()
  })

  it("stamps the batch an intent belonged to when it settles", () => {
    const withOne = withBatch(
      withIntents(checkpoint(), [
        intentForAction({
          kind: "upload",
          actionRef: "a2",
          questionRef: "q_resume",
          groupCount: null,
          attachmentName: null,
          at,
        }),
      ]),
      {
        index: 0,
        actionRefs: ["a2"],
        dispatchedAt: at,
        settledAt: null,
        receipts: [receipt("a2", "q_resume")],
        reobserve: "upload_parsing",
        affected: [],
      }
    )

    const settled = settleIntent(withOne, "a2", "confirmed", at + 9)
    expect(settled.batches[0]?.settledAt).toBe(at + 9)
    // A different batch is left alone.
    expect(settled.batches).toHaveLength(1)
  })
})

describe("recording a batch", () => {
  it("advances the revision, because the page refuses a write it already wrote", () => {
    const first = withBatch(checkpoint(), {
      index: 0,
      actionRefs: ["a1"],
      dispatchedAt: at,
      settledAt: null,
      receipts: [receipt("a1", "q_email")],
      reobserve: null,
      affected: [],
    })
    expect(first.questionRevision).toBe(2)
    expect(first.batches).toHaveLength(1)
    expect(allReceipts(first)).toHaveLength(1)
  })

  it("counts attempts per question and leaves other questions alone", () => {
    const attempt = {
      observationKey: "text:enabled:empty",
      correction: "write_text",
    }
    const once = withAttempt(
      withAttempt(checkpoint(), "q_email", attempt),
      "q_email",
      attempt
    )
    expect(once.attempts.q_email?.count).toBe(2)
    // The page a failed control was left on is remembered, so the same
    // correction against the same page is recognisable as a repeat.
    expect(once.attempts.q_email?.observationKey).toBe("text:enabled:empty")
  })

  it("records where a run stopped and why", () => {
    const paused = withStop(checkpoint(), {
      state: "paused",
      stopped: { kind: "user", reason: "The page was edited by hand" },
      at: at + 1_000,
    })
    expect(paused.state).toBe("paused")
    expect(paused.stopped?.kind).toBe("user")

    // Resuming folds the waiting into the time the ceiling does not count, so a
    // run that waited for a person has not spent its budget on waiting.
    const resumed = withResume(paused, at + 11_000)
    expect(resumed.waitedMs).toBe(10_000)
    expect(resumed.state).toBe("observing")
    expect(resumed.stopped).toBeNull()
  })
})
