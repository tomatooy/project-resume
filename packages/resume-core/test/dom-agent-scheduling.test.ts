import { describe, expect, it } from "vitest"
import type { RunIntent } from "../src/dom-agent/checkpoint"
import {
  type PlannedAction,
  attemptPolicy,
  planBatches,
  recoveryFor,
} from "../src/dom-agent/scheduling"

/**
 * Batching, attempts and recovery as arithmetic over evidence. A page is not
 * needed for any of it, which is the point: the decisions that decide whether a
 * write is repeated are testable without a browser.
 */

function action(
  ref: string,
  effect: PlannedAction["effect"] = null,
  affects: string[] = []
): PlannedAction {
  return { actionRef: ref, questionRef: `q_${ref}`, effect, affects }
}

describe("batching independent work", () => {
  it("runs plain writes together, up to the batch size", () => {
    const plans = planBatches({
      actions: ["a1", "a2", "a3", "a4", "a5"].map((ref) => action(ref)),
      limit: 3,
    })

    expect(
      plans.map((plan) => plan.actions.map((entry) => entry.actionRef))
    ).toEqual([
      ["a1", "a2", "a3"],
      ["a4", "a5"],
    ])
    expect(plans[0]?.closedBy).toBe("full")
    // A full batch is a scheduling limit, not a dependency: nothing forces a
    // re-read, which is what keeps five checkbox writes from stopping the run.
    expect(plans[0]?.reobserve).toBeNull()
    expect(plans[1]?.closedBy).toBe("end")
  })

  it("ends the batch after an action that changes the page, and says why", () => {
    const plans = planBatches({
      actions: [
        action("a1"),
        action("a2", "record_group", ["q_a3"]),
        action("a3"),
      ],
    })

    expect(plans).toHaveLength(2)
    expect(plans[0]?.actions.map((entry) => entry.actionRef)).toEqual([
      "a1",
      "a2",
    ])
    expect(plans[0]?.closedBy).toBe("effect")
    expect(plans[0]?.reobserve).toBe("record_group")
    expect(plans[0]?.affected).toEqual(["q_a3"])
    // The deferred question is planned against the next observation, not
    // reinterpreted with everything else.
    expect(plans[1]?.actions.map((entry) => entry.actionRef)).toEqual(["a3"])
  })

  it("defers only the questions an action affects", () => {
    const plans = planBatches({
      actions: [
        action("a1", "option_discovery", ["q_a9"]),
        action("a2"),
        action("a3"),
      ],
    })

    expect(plans[0]?.affected).toEqual(["q_a9"])
    expect(plans[1]?.affected).toEqual([])
    expect(plans[1]?.reobserve).toBeNull()
  })

  it("refuses an action that claims to affect others without saying what changed", () => {
    expect(() =>
      planBatches({ actions: [action("a1", null, ["q_a2"])] })
    ).toThrow(/affects other questions without an effect/)
  })

  it("keeps every action exactly once and in order", () => {
    const actions = [
      action("a1"),
      action("a2", "upload_parsing", []),
      action("a3"),
      action("a4"),
    ]
    const planned = planBatches({ actions, limit: 2 }).flatMap((plan) =>
      plan.actions.map((entry) => entry.actionRef)
    )
    expect(planned).toEqual(["a1", "a2", "a3", "a4"])
  })
})

describe("corrective attempts", () => {
  const failed = {
    observationKey: "text:enabled:empty",
    correction: "write_text",
  }

  it("allows two corrective attempts and then skips the control", () => {
    expect(attemptPolicy({ attempts: 0, previous: null, now: failed })).toEqual(
      { kind: "retry", attempt: 1 }
    )
    expect(
      attemptPolicy({
        attempts: 1,
        previous: failed,
        now: {
          observationKey: "text:enabled:valued",
          correction: "write_text",
        },
      })
    ).toEqual({ kind: "retry", attempt: 2 })
    expect(
      attemptPolicy({
        attempts: 2,
        previous: {
          observationKey: "text:enabled:valued",
          correction: "write_text",
        },
        now: {
          observationKey: "checkbox:enabled:empty",
          correction: "select_option",
        },
      })
    ).toEqual({ kind: "skip", reason: "attempts_exhausted" })
  })

  it("skips a retry that repeats the same attempt against the same page", () => {
    expect(
      attemptPolicy({ attempts: 1, previous: failed, now: failed })
    ).toEqual({
      kind: "skip",
      reason: "no_new_evidence",
    })
  })

  it("retries with new evidence or a different correction", () => {
    expect(
      attemptPolicy({
        attempts: 1,
        previous: failed,
        now: { ...failed, observationKey: "text:disabled:empty" },
      })
    ).toEqual({ kind: "retry", attempt: 2 })
    expect(
      attemptPolicy({
        attempts: 1,
        previous: failed,
        now: { ...failed, correction: "select_option" },
      })
    ).toEqual({ kind: "retry", attempt: 2 })
  })
})

describe("recovering an action whose answer was lost", () => {
  const intent: RunIntent = {
    kind: "record_creation",
    actionRef: "a1",
    questionRef: "r1",
    groupCount: 2,
    attachmentName: null,
    at: 10,
    settled: null,
  }

  it("confirms a record that the page now holds", () => {
    expect(
      recoveryFor({
        intent,
        evidence: {
          sameApplication: true,
          covered: true,
          groupCount: 3,
          attachmentName: null,
        },
      })
    ).toEqual({
      kind: "confirmed",
      detail: "The page holds 1 more group(s) than before the action",
    })
  })

  it("retries only when the page is the same and readable", () => {
    expect(
      recoveryFor({
        intent,
        evidence: {
          sameApplication: true,
          covered: true,
          groupCount: 2,
          attachmentName: null,
        },
      }).kind
    ).toBe("retry")
  })

  it("stays uncertain rather than guessing when it cannot tell", () => {
    const unreadable = recoveryFor({
      intent,
      evidence: {
        sameApplication: true,
        covered: false,
        groupCount: null,
        attachmentName: null,
      },
    })
    const elsewhere = recoveryFor({
      intent,
      evidence: {
        sameApplication: false,
        covered: true,
        groupCount: 9,
        attachmentName: null,
      },
    })
    expect(unreadable.kind).toBe("uncertain")
    expect(elsewhere.kind).toBe("uncertain")
  })

  it("never reopens an intent an observation already settled", () => {
    expect(
      recoveryFor({
        intent: { ...intent, settled: "uncertain" },
        evidence: {
          sameApplication: true,
          covered: true,
          groupCount: 2,
          attachmentName: null,
        },
      }).kind
    ).toBe("uncertain")
    expect(
      recoveryFor({
        intent: { ...intent, settled: "confirmed" },
        evidence: {
          sameApplication: true,
          covered: false,
          groupCount: null,
          attachmentName: null,
        },
      }).kind
    ).toBe("confirmed")
  })
})
