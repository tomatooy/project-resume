import {
  ActionSchema,
  DOM_AGENT_LIMITS,
  ReceiptSchema,
} from "@workspace/resume-core/dom-agent"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDebuggerHarness } from "./helpers/chrome-debugger"
import { install } from "../src/dom-agent/runtime/main"
import {
  RUNTIME_SETTLE_MAX_MS,
  type RuntimeStep,
} from "../src/dom-agent/runtime/protocol"
import {
  DISPATCH_DECLARATION,
  dispatchParams,
  installExpression,
  installParams,
  readInstall,
  releaseParams,
  remoteObjectId,
  remoteValue,
  replyFromCdpResult,
} from "../src/dom-agent/runtime-inject"
import { receiptFromReply } from "../src/dom-agent/runtime-receipt"
import { runtimeCall } from "../src/dom-agent/runtime-request"
import { DriverSession } from "../src/dom-agent/session"

/**
 * The worker side of the runtime: what it sends, what it reads back, and what a
 * receipt says. One case drives a real action through a real session, with the
 * protocol double standing in for the page's evaluation.
 */

const TAB = 11
const RUN = "run-7"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function expectation(overrides: Record<string, unknown> = {}) {
  return {
    documentGeneration: "gen-1",
    questionRevision: 1,
    sourceBundleId: "bundle-1",
    userEditEpoch: 0,
    settleMs: DOM_AGENT_LIMITS.controlInteractionMs,
    expectedValue: null,
    expectedChecked: null,
    expectedOptionLabel: null,
    ...overrides,
  }
}

type CallParams = { objectId: string; declaration: string; values: unknown[] }

function readCallParams(params: Record<string, unknown>): CallParams {
  const objectId = params.objectId
  const declaration = params.functionDeclaration
  const args = params.arguments
  if (typeof objectId !== "string") throw new Error("No call target")
  if (typeof declaration !== "string") throw new Error("No declaration")
  if (!Array.isArray(args)) throw new Error("No arguments")
  const values: unknown[] = []
  for (const argument of args) {
    if (!isRecord(argument)) throw new Error("Argument is not a value")
    values.push(argument.value)
  }
  return { objectId, declaration, values }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("installing", () => {
  it("appends one fixed call to the bundle the build emitted", () => {
    const bundle =
      "var VsDomAgent=(function(){return {install: function(){return 1}}})();"
    const expression = installExpression(bundle)
    expect(expression.startsWith(bundle)).toBe(true)
    expect(expression).toBe(`${bundle};\nVsDomAgent.install()`)
  })

  it("evaluates in the frame's own world and reads the result by value", () => {
    const params = installParams("var VsDomAgent={};")
    expect(params.contextId).toBeUndefined()
    expect(params.worldName).toBeUndefined()
    expect(params.returnByValue).toBe(true)
  })

  it("refuses an installation that is not this build", () => {
    const real = install()
    expect(readInstall(real)).toEqual(real)
    expect(readInstall({ ...real, version: real.version + 1 })).toBeNull()
    expect(readInstall({ ...real, nonce: "" })).toBeNull()
    expect(readInstall({ ...real, key: "somewhere_else" })).toBeNull()
    expect(readInstall(null)).toBeNull()
  })
})

describe("one action through the session", () => {
  function browserDouble() {
    const harness = createDebuggerHarness(TAB)
    vi.stubGlobal("chrome", harness.chrome)
    const elements = new Map<string, Element>()
    const slots = globalThis as unknown as Record<string, unknown>
    harness.on("Runtime.evaluate", () => ({
      result: { value: install() },
    }))
    harness.on("DOM.resolveNode", (params) => {
      const nodeRef = String(params.backendNodeId ?? "")
      const element = document.querySelector(`[data-ref="${nodeRef}"]`)
      if (!element) throw new Error("No such node")
      elements.set(`node-${nodeRef}`, element)
      return { object: { objectId: `node-${nodeRef}` } }
    })
    harness.on("Runtime.callFunctionOn", async (params) => {
      const call = readCallParams(params)
      const element = elements.get(call.objectId)
      if (!element) throw new Error("No such object")
      // The declaration does exactly this: read the installed function by the
      // key it was given, then call it with the control bound to `this`.
      const runtime = slots[String(call.values[0])]
      if (typeof runtime !== "function") throw new Error("Not installed")
      const bound = runtime as (...args: unknown[]) => Promise<unknown>
      return {
        result: { value: await bound.call(element, ...call.values.slice(1)) },
      }
    })
    return { harness, slots }
  }

  it("sends data, never code, and reads the outcome back", async () => {
    const { harness } = browserDouble()
    document.body.replaceChildren(
      Object.assign(document.createElement("input"), {})
    )
    const control = document.querySelector("input")
    if (!control) throw new Error("No control")
    control.setAttribute("data-ref", "42")

    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    const installation = readInstall(
      remoteValue(
        await session.send(
          "root",
          "Runtime.evaluate",
          installParams("var VsDomAgent={};")
        )
      )
    )
    expect(installation).not.toBeNull()

    const objectId = remoteObjectId(
      await session.send("root", "DOM.resolveNode", { backendNodeId: 42 })
    )
    if (!objectId || !installation) throw new Error("No control to act on")

    const step: RuntimeStep = { kind: "write_text", value: "Ada" }
    const params = dispatchParams({
      key: installation.key,
      elementObjectId: objectId,
      actionRef: "action-1",
      questionRef: "question-1",
      step,
      expect: expectation({ expectedValue: "" }),
    })
    const result = await session.send("root", "Runtime.callFunctionOn", params)
    const reply = replyFromCdpResult(result)
    expect(reply?.ok).toBe(true)
    expect(control.value).toBe("Ada")

    const receipt = receiptFromReply({
      actionRef: "action-1",
      questionRef: "question-1",
      reply,
      observedOptions: [],
      at: 1_700_000_000_000,
    })
    expect(receipt.state).toBe("accepted")
    expect(receipt.observed.value).toBe("Ada")
    // The receipt is the contract the rest of the engine reads.
    expect(ReceiptSchema.parse(receipt)).toEqual(receipt)

    await session.send("root", "Runtime.releaseObject", releaseParams(objectId))
    expect(harness.methods()).toContain("Runtime.callFunctionOn")
    expect(harness.methods()).toContain("Runtime.releaseObject")
    await session.detach()
  })

  it("sends the control as the target and everything else as an argument", () => {
    const params = dispatchParams({
      key: "__vsDomAgent_abc",
      elementObjectId: "node-42",
      actionRef: "action-1",
      questionRef: "question-1",
      step: { kind: "write_text", value: "Ada" },
      expect: expectation({ expectedValue: "" }),
    })
    expect(params.objectId).toBe("node-42")
    expect(params.awaitPromise).toBe(true)
    // The declaration's parameters and the argument list are one contract.
    const names = DISPATCH_DECLARATION.slice(
      DISPATCH_DECLARATION.indexOf("(") + 1,
      DISPATCH_DECLARATION.indexOf(")")
    )
      .split(",")
      .map((name) => name.trim())
    expect(names).toEqual([
      "key",
      "actionRef",
      "questionRef",
      "verb",
      "step",
      "expect",
      "version",
    ])
    const call = readCallParams(params)
    expect(call.values).toHaveLength(names.length)
    // No argument is a function or a string of code: the only thing a request
    // can carry into the page is data.
    for (const value of call.values)
      expect(["string", "number", "boolean", "object"]).toContain(typeof value)
    expect(call.declaration).toBe(DISPATCH_DECLARATION)
  })
})

describe("reading a reply", () => {
  it("reads a by-value result and refuses one it cannot parse", () => {
    const reply = {
      ok: true,
      outcome: {
        state: "accepted",
        verb: "write_text",
        observed: {
          value: "Ada",
          checked: null,
          selectedOptionLabel: null,
          attachmentName: null,
          groupChildCount: null,
        },
        evidence: ["value_set"],
        options: [],
      },
    }
    expect(replyFromCdpResult({ result: { value: reply } })).toEqual(reply)
    expect(
      replyFromCdpResult({ result: { value: { ok: "maybe" } } })
    ).toBeNull()
    expect(replyFromCdpResult(null)).toBeNull()
  })

  it("names the observed option by label when the observation holds exactly one", () => {
    const receipt = receiptFromReply({
      actionRef: "action-1",
      questionRef: "question-1",
      reply: {
        ok: true,
        outcome: {
          state: "accepted",
          verb: "select_option",
          observed: {
            value: "pt",
            checked: null,
            selectedOptionLabel: "Portugal",
            attachmentName: null,
            groupChildCount: null,
          },
          evidence: ["option_selected"],
          options: [],
        },
      },
      observedOptions: [
        { ref: "opt-1", label: "Country" },
        { ref: "opt-2", label: " Portugal " },
      ],
      at: 1,
    })
    expect(receipt.observed.optionRef).toBe("opt-2")
  })

  it("says so when a label names no single observed option", () => {
    const receipt = receiptFromReply({
      actionRef: "action-1",
      questionRef: "question-1",
      reply: {
        ok: true,
        outcome: {
          state: "accepted",
          verb: "select_option",
          observed: {
            value: null,
            checked: null,
            selectedOptionLabel: "Yes",
            attachmentName: null,
            groupChildCount: null,
          },
          evidence: ["option_selected"],
          options: [],
        },
      },
      observedOptions: [
        { ref: "opt-1", label: "Yes" },
        { ref: "opt-2", label: "Yes" },
      ],
      at: 1,
    })
    expect(receipt.observed.optionRef).toBeNull()
    expect(receipt.evidence).toContain("observed_option_ref_unresolved")
  })

  it("reports a missing reply as a failed action", () => {
    const receipt = receiptFromReply({
      actionRef: "action-1",
      questionRef: "question-1",
      reply: null,
      observedOptions: [],
      at: 1,
    })
    expect(receipt.state).toBe("failed")
    expect(receipt.evidence).toEqual(["reply_not_readable"])
  })

  it("reports a call the page refused outright as failed", () => {
    const receipt = receiptFromReply({
      actionRef: "action-1",
      questionRef: "question-1",
      reply: { ok: false, reason: "unknown_verb" },
      observedOptions: [],
      at: 1,
    })
    expect(receipt.state).toBe("failed")
    expect(receipt.evidence).toEqual(["unknown_verb"])
  })

  it("clips a value the page reported", () => {
    const receipt = receiptFromReply({
      actionRef: "action-1",
      questionRef: "question-1",
      reply: {
        ok: true,
        outcome: {
          state: "unresolved",
          verb: "write_text",
          observed: {
            value: "x".repeat(5000),
            checked: null,
            selectedOptionLabel: null,
            attachmentName: "y".repeat(400),
            groupChildCount: null,
          },
          evidence: ["value_not_settled"],
          options: [],
        },
      },
      observedOptions: [],
      at: 1,
    })
    expect(receipt.observed.value).toHaveLength(2000)
    expect(receipt.observed.attachmentLabel).toHaveLength(300)
  })
})

describe("translating an action", () => {
  const precondition = {
    documentGeneration: "gen-1",
    questionRevision: 2,
    sourceBundleId: "bundle-1",
    userEditEpoch: 0,
  }
  const options = [
    { ref: "opt-1", label: "Country" },
    { ref: "opt-2", label: "Portugal" },
  ]

  it("uses the interaction limit as the settle budget, not a wish", () => {
    expect(RUNTIME_SETTLE_MAX_MS).toBe(DOM_AGENT_LIMITS.controlInteractionMs)
  })

  it("carries text entry and the value the control should already hold", () => {
    const action = ActionSchema.parse({
      type: "write_text",
      ref: "a1",
      questionRef: "q1",
      value: "Ada",
      expectedValue: "",
    })
    const call = runtimeCall({
      action,
      precondition,
      options,
      attachment: null,
    })
    expect(call?.step).toEqual({ kind: "write_text", value: "Ada" })
    expect(call?.expect.expectedValue).toBe("")
    expect(call?.expect.settleMs).toBe(DOM_AGENT_LIMITS.controlInteractionMs)
  })

  it("resolves both option references to the page's own labels", () => {
    const action = ActionSchema.parse({
      type: "select_option",
      ref: "a1",
      questionRef: "q1",
      optionRef: "opt-2",
      expectedOptionRef: "opt-1",
    })
    const call = runtimeCall({
      action,
      precondition,
      options,
      attachment: null,
    })
    expect(call?.step).toEqual({
      kind: "select_option",
      optionLabel: "Portugal",
    })
    expect(call?.expect.expectedOptionLabel).toBe("Country")
  })

  it("refuses an option reference the observation no longer holds", () => {
    const action = ActionSchema.parse({
      type: "select_option",
      ref: "a1",
      questionRef: "q1",
      optionRef: "opt-9",
      expectedOptionRef: null,
    })
    expect(
      runtimeCall({ action, precondition, options, attachment: null })
    ).toBeNull()
  })

  it("treats an empty expected selection as nothing selected", () => {
    const action = ActionSchema.parse({
      type: "select_option",
      ref: "a1",
      questionRef: "q1",
      optionRef: "opt-2",
      expectedOptionRef: null,
    })
    const call = runtimeCall({
      action,
      precondition,
      options,
      attachment: null,
    })
    expect(call?.expect.expectedOptionLabel).toBe("")
  })

  it("refuses attachment bytes that are not the ones the action named", () => {
    const action = ActionSchema.parse({
      type: "attach_file",
      ref: "a1",
      questionRef: "q1",
      pdfIdentity: "0123456789abcdef",
      replaceExisting: false,
      replacementConfirmedAt: null,
    })
    if (action.type !== "attach_file")
      throw new Error("Expected an attachment action")
    const attachment = {
      identity: "fedcba9876543210",
      name: "ada-resume.pdf",
      type: "application/pdf",
      sizeBytes: 12,
      base64: "JVBERi0xLjQK",
    }
    expect(
      runtimeCall({ action, precondition, options, attachment })
    ).toBeNull()
    const call = runtimeCall({
      action,
      precondition,
      options,
      attachment: { ...attachment, identity: action.pdfIdentity },
    })
    expect(call?.step).toEqual({
      kind: "attach_file",
      file: {
        name: "ada-resume.pdf",
        type: "application/pdf",
        sizeBytes: 12,
        base64: "JVBERi0xLjQK",
      },
      replaceExisting: false,
      replacementConfirmed: true,
    })
  })

  it("refuses to express a replacement no reviewed choice authorized", () => {
    // Finding a conflict is not a review. The gate lives in the shared
    // vocabulary and this is the path that has to consult it: when
    // authorization cannot be established, nothing is expressed at all rather
    // than asking the page to keep whatever it finds.
    const attachment = {
      identity: "0123456789abcdef",
      name: "ada-resume.pdf",
      type: "application/pdf",
      sizeBytes: 12,
      base64: "JVBERi0xLjQK",
    }
    const unconfirmed = ActionSchema.parse({
      type: "attach_file",
      ref: "a1",
      questionRef: "q1",
      pdfIdentity: "0123456789abcdef",
      replaceExisting: true,
      replacementConfirmedAt: null,
    })
    expect(
      runtimeCall({ action: unconfirmed, precondition, options, attachment })
    ).toBeNull()

    // The same replacement is expressible once a reviewed choice confirmed it.
    const confirmed = ActionSchema.parse({
      type: "attach_file",
      ref: "a1",
      questionRef: "q1",
      pdfIdentity: "0123456789abcdef",
      replaceExisting: true,
      replacementConfirmedAt: 1,
    })
    expect(
      runtimeCall({ action: confirmed, precondition, options, attachment })
        ?.step
    ).toEqual(
      expect.objectContaining({ kind: "attach_file", replaceExisting: true })
    )
  })

  it("does not assert a checkbox state the action left open", () => {
    const action = ActionSchema.parse({
      type: "toggle",
      ref: "a1",
      questionRef: "q1",
      checked: true,
      expectedChecked: null,
    })
    const call = runtimeCall({
      action,
      precondition,
      options,
      attachment: null,
    })
    expect(call?.step).toEqual({ kind: "toggle", checked: true })
    expect(call?.expect.expectedChecked).toBeNull()
  })

  it("asks for a record group with no payload beyond the control", () => {
    const action = ActionSchema.parse({
      type: "add_record_group",
      ref: "a1",
      questionRef: "q1",
      recordRef: "rec-1",
    })
    const call = runtimeCall({
      action,
      precondition,
      options,
      attachment: null,
    })
    expect(call?.step).toEqual({ kind: "add_record_group" })
  })
})
