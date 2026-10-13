import { readFileSync } from "node:fs"
import { webcrypto } from "node:crypto"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import type { InterpretedPage } from "@workspace/resume-core/contracts"
import { Registry } from "../src/autofill/registry"
import { Scanner } from "../src/autofill/scanner"
import { Executor } from "../src/autofill/executor"

const captured = readFileSync("test/fixtures/ashby-application.html", "utf8")
let registry: Registry
let scanner: Scanner
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("crypto", webcrypto)
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() =>
    Object.assign([new DOMRect(0, 0, 100, 20)], { item: () => null })
  )
  document.title = "Software Engineer"
  document.body.innerHTML = captured
  registry = new Registry(document)
  scanner = new Scanner(registry)
})
afterEach(() => {
  registry.release()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function snapshot() {
  const observed = scanner.observe().snapshot
  if (!observed) throw new Error("Application was not recognized")
  return observed
}
function choiceButton(field = "work-authorization", answer = "yes") {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-field-path="${field}"] button[data-option="${answer}"]`
  )
  if (!button) throw new Error("Missing choice button")
  return button
}
it("observes the application tab and button choices without hiding unrelated candidates", () => {
  const observed = snapshot()
  expect(observed.formLabel).toBe("Software Engineer")
  expect(observed.fields.map((field) => field.label)).toEqual([
    "Search",
    "Are you legally authorized to work in the United States?",
    "Will you now or in the future require visa sponsorship to work in the United States?",
  ])
  for (const field of observed.fields.filter(
    (field) => field.control === "radio_group"
  )) {
    expect(field.control).toBe("radio_group")
    expect(field.state.empty).toBe(true)
    expect(field.options).toMatchObject({
      loadState: "ready",
      coverage: "complete",
    })
    expect(field.options?.options.map((option) => option.label)).toEqual([
      "Yes",
      "No",
    ])
  }
})
async function plan() {
  const ports = inMemoryPorts()
  ports.autofillPolicy.value.jevEnabled = true
  const services = createServices({
    ...ports,
    clock: () => new Date(),
    autofillInterpreter: {
      async interpret(input, options) {
        await options.beforeAttempt()
        const region = input.pageView.nodes.find((node) => node.tag === "body")
        const evidence = input.fields.find(
          (field) => field.control === "radio_group"
        )
        if (!region || !evidence) throw new Error("Missing application context")
        return {
          snapshotId: input.pageView.snapshotId,
          regions: [
            { regionRef: region.ref, evidenceRefs: [evidence.fieldId] },
          ],
          fields: input.fields
            .filter((field) => field.control === "radio_group")
            .map((field) => ({
              fieldId: field.fieldId,
              fieldRevision: field.fieldRevision,
              regionRef: region.ref,
              concept: field.label.includes("sponsorship")
                ? "sponsorship_now_or_future"
                : "work_authorized",
              evidenceRefs: [field.fieldId],
              requiresDraft: false,
            })),
          groups: [],
          excluded: input.fields
            .filter((field) => field.control !== "radio_group")
            .map((field) => ({
              fieldId: field.fieldId,
              reason: "search",
              evidenceRefs: [field.fieldId],
            })),
          needsContext: [],
          unresolvedFieldIds: [],
        } satisfies InterpretedPage
      },
    },
  })
  const resume = await services.resumes.create()
  await services.autofillProfile.update({
    expectedRevision: 0,
    section: "workAuthorization",
    data: [
      {
        countryCode: "US",
        authorizedToWork: "yes",
        requiresSponsorshipNow: "no",
        requiresSponsorshipFuture: "no",
      },
    ],
  })
  const prepared = await services.autofill.prepare({ resumeId: resume.id })
  const observed = snapshot()
  const result = await services.autofill.plan({
    schemaVersion: 1,
    automation: "automatic",
    requestId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    generation: 1,
    sourceStamp: prepared.sourceStamp,
    target: {
      tabId: 1,
      frameId: 0,
      documentId: "document",
      origin: location.origin,
      formId: observed.formId,
    },
    snapshot: observed,
    selections: [],
    overrides: [],
    remainingAttempts: 8,
  })
  const executor = new Executor(registry, "document", () => true)
  executor.authorize(result.sessionId, result.generation)
  return { ...result, executor, ports }
}
it("fills both saved answers by clicking their buttons and reading pressed state", async () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "button[data-option]"
  )) {
    button.addEventListener("click", () => {
      for (const peer of button.parentElement?.querySelectorAll("button") ?? [])
        peer.setAttribute("aria-pressed", String(peer === button))
    })
  }
  const submit = vi.fn()
  document
    .querySelector(".ashby-application-form-container > button")
    ?.addEventListener("click", submit)
  const result = await plan()
  expect(result.plan.actions).toHaveLength(2)
  for (const action of result.plan.actions) {
    expect(action.op).toBe("set_single")
    const pending = result.executor.execute(result.plan, action, result.policy)
    await vi.advanceTimersByTimeAsync(500)
    const actual = await pending
    expect(actual, JSON.stringify(actual)).toMatchObject({
      status: "filled",
      verification: "accepted",
    })
  }
  expect(
    [...document.querySelectorAll('[aria-pressed="true"]')].map((button) =>
      button.getAttribute("data-option")
    )
  ).toEqual(["yes", "no"])
  expect(submit).not.toHaveBeenCalled()
  expect(result.ports.autofillDecider.calls).toEqual([])
})
it("preserves a selected No even though the hidden checkbox is unchecked", async () => {
  choiceButton("work-authorization", "no").setAttribute("aria-pressed", "true")
  const result = await plan()
  const decision = result.decisions.find(
    (item) => item.semanticKey === "work_authorized"
  )
  expect(decision?.status).toBe("preserved")
  expect(
    result.plan.actions.some((action) => action.fieldId === decision?.fieldId)
  ).toBe(false)
  expect(
    snapshot().fields.find((field) => field.control === "radio_group")?.state
  ).toMatchObject({
    empty: false,
    hasUserValue: true,
  })
})
it.each([
  {
    name: "label",
    mutate: () => {
      const label = document.querySelector(
        '[data-field-path="work-authorization"] > label'
      )
      if (label) label.textContent = "A different question"
    },
  },
  {
    name: "option identity",
    mutate: () => choiceButton().setAttribute("data-option", "no"),
  },
  {
    name: "disabled option",
    mutate: () => {
      choiceButton().disabled = true
    },
  },
  {
    name: "replaced button",
    mutate: () => {
      const button = choiceButton()
      button.replaceWith(button.cloneNode(true))
    },
  },
  {
    name: "form owner",
    mutate: () => {
      const form = document.createElement("form")
      form.id = "submit-target"
      document.body.append(form)
      choiceButton().setAttribute("form", form.id)
    },
  },
])("rejects a changed $name before clicking", async ({ mutate }) => {
  const result = await plan()
  const action = result.plan.actions[0]
  if (!action) throw new Error("Missing action")
  const click = vi.fn()
  choiceButton().addEventListener("click", click)
  mutate()
  expect(
    await result.executor.execute(result.plan, action, result.policy)
  ).toMatchObject({ status: "stale" })
  expect(click).not.toHaveBeenCalled()
})
it("does not report a click as success when the page rolls back its selected state", async () => {
  const result = await plan()
  const action = result.plan.actions[0]
  if (!action) throw new Error("Missing action")
  const button = choiceButton()
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", "true")
    setTimeout(() => button.setAttribute("aria-pressed", "false"), 150)
  })
  const pending = result.executor.execute(result.plan, action, result.policy)
  await vi.advanceTimersByTimeAsync(8100)
  expect(await pending).toMatchObject({
    status: "unverified",
    reasonCode: "readback_unconfirmed",
  })
})
it("honors cancellation and the adapter kill switch before clicking", async () => {
  const result = await plan()
  const action = result.plan.actions[0]
  if (!action) throw new Error("Missing action")
  const click = vi.fn()
  choiceButton().addEventListener("click", click)
  expect(
    await result.executor.execute(result.plan, action, {
      ...result.policy,
      disabledAdapters: ["button-choice-v1"],
    })
  ).toMatchObject({ status: "stale" })
  result.executor.cancel(2)
  expect(
    await result.executor.execute(result.plan, action, result.policy)
  ).toMatchObject({ status: "stale" })
  expect(click).not.toHaveBeenCalled()
})
