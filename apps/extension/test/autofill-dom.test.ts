import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { reviewPolicy, type FillPlan } from "@workspace/resume-core/contracts"
import { Registry, committed } from "../src/autofill/registry"
import { Scanner } from "../src/autofill/scanner"
import { Executor } from "../src/autofill/executor"
import { webcrypto } from "node:crypto"
import { pdfDigest, type ResumePdf } from "../src/autofill/pdf-contract"

let registry: Registry
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() =>
    Object.assign([new DOMRect(0, 0, 100, 20)], { item: () => null })
  )
  document.body.innerHTML =
    '<form aria-label="Application"><label>Email<input name="email" type="email"></label></form>'
  registry = new Registry(document)
})
afterEach(() => {
  registry.release()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function fixture() {
  const scanner = new Scanner(registry)
  const observed = scanner.observe().snapshot
  if (!observed?.fields[0]) throw new Error("Missing fixture field")
  const f = observed.fields[0]
  const plan: FillPlan = {
    schemaVersion: 1,
    planId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    generation: 1,
    sourceStamp: {
      resumeId: crypto.randomUUID(),
      resumeSource: { kind: "head", revision: 1, contentHash: "a".repeat(64) },
      profileRevision: 0,
      overridesRevision: 0,
    },
    target: {
      tabId: 1,
      frameId: 0,
      documentId: "document",
      origin: location.origin,
      formId: observed.formId,
    },
    snapshotId: observed.snapshotId,
    documentEpoch: observed.documentEpoch,
    formRevision: observed.formRevision,
    expiresAt: new Date(Date.now() + 30000).toISOString(),
    actions: [
      {
        actionId: crypto.randomUUID(),
        decisionId: crypto.randomUUID(),
        fieldId: f.fieldId,
        fieldRevision: f.fieldRevision,
        guardRef: f.guardRef,
        userEditEpoch: 0,
        precondition: "empty",
        op: "set_text",
        value: "applicant@example.test",
        format: "email",
      },
    ],
    interactions: [],
  }
  const executor = new Executor(registry, "document", () => true)
  executor.authorize(plan.sessionId, plan.generation)
  const action = plan.actions[0]
  if (!action) throw new Error("Missing action")
  return { scanner, plan, executor, action, f }
}
async function uploadFixture() {
  vi.stubGlobal("crypto", webcrypto)
  document.body.innerHTML =
    '<form><label>Resume / CV<input type="file" accept=".pdf"></label></form>'
  const base = fixture()
  const el = document.querySelector("input")
  if (!el) throw new Error("Missing input")
  let chosen: File[] = []
  Object.defineProperty(el, "files", {
    configurable: true,
    get: () => chosen,
    set: (files: FileList) => {
      chosen = [...files]
    },
  })
  vi.stubGlobal(
    "DataTransfer",
    class {
      files: File[] = []
      items = {
        add: (file: File) => {
          this.files.push(file)
        },
      }
    }
  )
  const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF")
  const file: ResumePdf = {
    sourceStamp: base.plan.sourceStamp,
    filename: "applicant-resume.pdf",
    byteLength: bytes.length,
    base64: btoa(new TextDecoder().decode(bytes)),
    sha256: await pdfDigest(bytes),
  }
  const action = {
    ...base.action,
    op: "upload_resume",
    mimeType: "application/pdf",
  } as const
  return { ...base, el, file, action }
}
it("attaches the exact PDF and reports success only after file readback", async () => {
  const { el, file, action, executor, plan } = await uploadFixture()
  const change = vi.fn()
  el.addEventListener("change", change)
  const pending = executor.execute(plan, action, reviewPolicy(), false, file)
  await vi.waitFor(() => expect(change).toHaveBeenCalledOnce())
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({
    status: "filled",
    reasonCode: "resume_attached",
  })
  expect(el.files?.[0]).toMatchObject({
    name: file.filename,
    size: file.byteLength,
    type: "application/pdf",
  })
  expect(change).toHaveBeenCalledOnce()
  expect(
    await executor.execute(plan, action, reviewPolicy(), false, file)
  ).toMatchObject({ status: "already_applied" })
  expect(change).toHaveBeenCalledOnce()
})
it("rejects changed sources, corrupted bytes and cancellation before file disclosure", async () => {
  const { el, file, action, executor, plan } = await uploadFixture()
  expect(
    await executor.execute(plan, action, reviewPolicy(), false, {
      ...file,
      sourceStamp: { ...file.sourceStamp, profileRevision: 99 },
    })
  ).toMatchObject({ status: "unsupported" })
  expect(
    await executor.execute(
      plan,
      { ...action, actionId: crypto.randomUUID() },
      reviewPolicy(),
      false,
      { ...file, sha256: "0".repeat(64) }
    )
  ).toMatchObject({ status: "failed" })
  const pending = executor.execute(
    plan,
    { ...action, actionId: crypto.randomUUID() },
    reviewPolicy(),
    false,
    file
  )
  executor.cancel(2)
  await pending
  expect(el.files?.length).toBe(0)
})
it("preserves an attachment and detects changed accept rules", async () => {
  const { el, file, action, executor, plan } = await uploadFixture()
  el.accept = ".docx"
  expect(
    await executor.execute(plan, action, reviewPolicy(), false, file)
  ).toMatchObject({ status: "stale" })
  el.accept = ".pdf"
  Object.defineProperty(el, "files", {
    configurable: true,
    value: [new File(["saved"], "existing.pdf", { type: "application/pdf" })],
  })
  expect(
    await executor.execute(
      plan,
      { ...action, actionId: crypto.randomUUID() },
      reviewPolicy(),
      false,
      file
    )
  ).toMatchObject({ status: "stale" })
  expect(el.files?.[0]?.name).toBe("existing.pdf")
})
it("does not report a site-rejected attachment as uploaded", async () => {
  const { el, file, action, executor, plan } = await uploadFixture()
  el.addEventListener("change", () => el.setAttribute("aria-invalid", "true"))
  const pending = executor.execute(plan, action, reviewPolicy(), false, file)
  await vi.waitFor(() => expect(el.getAttribute("aria-invalid")).toBe("true"))
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({
    status: "failed",
    reasonCode: "control_rejected",
  })
})
it("discovers hidden file inputs through their visible upload labels", () => {
  document.body.innerHTML =
    '<form><label>Resume<input type="file" style="display:none" accept="application/pdf"></label></form>'
  const { f } = fixture()
  expect(f).toMatchObject({
    control: "file",
    label: "Resume",
    attributes: { accept: "application/pdf" },
    capabilities: { write: true },
  })
})
it("observes all form regions without using resume upload to discard other candidates", () => {
  document.body.innerHTML =
    '<form aria-label="Search"><input aria-label="Query"></form><form aria-label="Apply"><label>Resume<input type="file"></label><label>Email<input type="email"></label></form>'
  const observed = new Scanner(registry).observe()
  expect(observed.forms).toHaveLength(3)
  expect(observed.snapshot?.fields.map((field) => field.label)).toEqual([
    "Query",
    "Resume",
    "Email",
  ])
})
it("reports filled only after stable readback and deduplicates observed success", async () => {
  const { plan, executor, action } = fixture()
  const events = vi.fn()
  document.addEventListener("input", events, { once: true })
  const pending = executor.execute(plan, action, reviewPolicy())
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({
    status: "filled",
    verification: "accepted",
  })
  expect(await executor.execute(plan, action, reviewPolicy())).toMatchObject({
    status: "already_applied",
  })
  expect(events).toHaveBeenCalledTimes(1)
})
it("rejects a stale original value without dispatching events", async () => {
  const { plan, executor, action } = fixture()
  const el = document.querySelector("input")
  if (!el) throw new Error("Missing input")
  el.value = "human@example.test"
  expect(await executor.execute(plan, action, reviewPolicy())).toMatchObject({
    status: "stale",
  })
  expect(el.value).toBe("human@example.test")
})
it("rejects changed documents, generations, policy expiry, and labels", async () => {
  const { plan, executor, action } = fixture()
  expect(
    await executor.execute(
      { ...plan, target: { ...plan.target, documentId: "different" } },
      action,
      reviewPolicy()
    )
  ).toMatchObject({ status: "stale" })
  expect(
    await executor.execute(
      plan,
      { ...action, actionId: crypto.randomUUID() },
      { ...reviewPolicy(), expiresAt: new Date(0).toISOString() }
    )
  ).toMatchObject({ status: "stale" })
  document.querySelector("input")?.setAttribute("aria-label", "Referee email")
  expect(
    await executor.execute(
      plan,
      { ...action, actionId: crypto.randomUUID() },
      reviewPolicy()
    )
  ).toMatchObject({ status: "stale" })
  executor.cancel(2)
  expect(
    await executor.execute(
      plan,
      { ...action, actionId: crypto.randomUUID() },
      reviewPolicy()
    )
  ).toMatchObject({ status: "stale" })
})
it("does not call a controlled input rollback successful", async () => {
  const { plan, executor, action } = fixture()
  const el = document.querySelector("input")
  if (!el) throw new Error("Missing input")
  el.addEventListener("input", () => {
    el.value = ""
  })
  const pending = executor.execute(plan, action, reviewPolicy())
  await vi.advanceTimersByTimeAsync(8100)
  expect(await pending).not.toMatchObject({ status: "filled" })
})
it("reads native option labels separately from submitted values", () => {
  document.body.innerHTML =
    '<form><label>Country<select><option value="">Choose</option><option value="840">United States</option></select></label></form>'
  const { f } = fixture()
  const option = f.options?.options.find((o) => o.label === "United States")
  expect(option?.optionId).toBeTruthy()
  expect(option?.optionId).not.toBe("840")
  expect(
    registry.entries.get(f.fieldId)?.options.get(option?.optionId ?? "")?.value
  ).toBe("840")
})
it("does not treat combobox query text as a committed value", () => {
  document.body.innerHTML =
    '<form><label>School<input role="combobox" aria-controls="schools" value="Berkeley"></label><div id="schools" role="listbox"><div role="option">UC Berkeley</div></div></form>'
  const { f } = fixture()
  const entry = registry.entries.get(f.fieldId)
  if (!entry) throw new Error("Missing entry")
  expect(committed(entry)).toBe("")
  expect(f.options?.loadState).not.toBe("ready")
})
it("keeps multiple form regions selectable while withholding password contents", () => {
  document.body.innerHTML +=
    '<form><input type="password"><input aria-label="Email"></form><form aria-label="Second application"><label>Name<input></label></form>'
  const scanner = new Scanner(registry)
  const observed = scanner.observe()
  expect(observed.forms).toHaveLength(4)
  expect(observed.snapshot?.fields).toHaveLength(3)
  expect(
    scanner.observe(
      observed.forms.find((form) => form.label === "Application")?.id
    ).snapshot?.fields
  ).toHaveLength(1)
})
it("finds fields in open shadow roots", () => {
  const form = document.querySelector("form")
  const host = document.createElement("div")
  form?.append(host)
  host.attachShadow({ mode: "open" }).innerHTML =
    '<label>Phone<input type="tel"></label>'
  expect(
    new Scanner(registry).observe().snapshot?.fields.map((f) => f.label)
  ).toEqual(["Email", "Phone"])
})
it("reports opaque custom hosts without accessing closed shadow content", () => {
  const host = document.createElement("application-details")
  document.querySelector("form")?.append(host)
  host.attachShadow({ mode: "closed" }).innerHTML =
    "<label>Hidden field<input></label>"
  const observed = new Scanner(registry).observe()
  expect(observed.uncovered).toBe(true)
  expect(observed.snapshot?.coverage).toBe("partial")
  expect(observed.snapshot?.coverageReasons).toContain("unsupported")
  expect(observed.snapshot?.fields.map((f) => f.label)).toEqual(["Email"])
})

it("does not reauthorize a cancelled generation", () => {
  const { plan, executor } = fixture()
  executor.cancel(plan.generation)
  expect(() => executor.authorize(plan.sessionId, plan.generation)).toThrow(
    "stale_generation"
  )
  expect(() =>
    executor.authorize(plan.sessionId, plan.generation + 1)
  ).not.toThrow()
})
it("rejects a field moved into a different record and a replaced form", async () => {
  document.body.innerHTML =
    "<form><fieldset><legend>Contact</legend><label>Email<input></label></fieldset><fieldset><legend>Reference</legend></fieldset></form>"
  const { plan, executor, action } = fixture()
  const input = document.querySelector("input")
  const other = document.querySelectorAll("fieldset")[1]
  if (!input || !other) throw new Error("Fixture unavailable")
  other.append(input)
  expect(await executor.execute(plan, action, reviewPolicy())).toMatchObject({
    status: "stale",
  })
  document.querySelector("form")?.replaceWith(document.createElement("form"))
  expect(
    await executor.execute(
      plan,
      { ...action, actionId: crypto.randomUUID() },
      reviewPolicy()
    )
  ).toMatchObject({ status: "stale" })
})
it("requires explicit replacement and a matching local guard", async () => {
  const input = document.querySelector("input")
  if (!input) throw new Error("Fixture unavailable")
  input.value = "existing@example.test"
  const { plan, executor, action } = fixture()
  const replace = { ...action, precondition: "explicit_replace" as const }
  expect(await executor.execute(plan, replace, reviewPolicy())).toMatchObject({
    status: "skipped",
  })
  const pending = executor.execute(
    plan,
    { ...replace, actionId: crypto.randomUUID() },
    reviewPolicy(),
    true
  )
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ status: "filled" })
})
it("uses only a referenced portal listbox and rejects virtual option reuse", async () => {
  document.body.innerHTML =
    '<form><button type="button" role="combobox" aria-label="School" aria-expanded="true" aria-controls="schools" data-value=""></button></form><div role="listbox" id="other"><div role="option">Wrong school</div></div><div role="listbox" id="schools"><div role="option" data-value="uc">UC Berkeley</div></div>'
  const { plan, executor, f, action } = fixture()
  const entry = registry.entries.get(f.fieldId)
  if (!entry || !f.options?.options[0]) throw new Error("Missing options")
  entry.ready = true
  expect(f.options.options.map((o) => o.label)).toEqual(["UC Berkeley"])
  const select = {
    ...action,
    op: "set_single" as const,
    optionId: f.options.options[0].optionId,
    optionsRevision: f.options.optionsRevision,
    queryRevision: f.options.queryRevision,
  }
  document
    .querySelector("#schools [role=option]")
    ?.setAttribute("data-value", "other-school")
  expect(await executor.execute(plan, select, reviewPolicy())).toMatchObject({
    status: "stale",
  })
})
it("requires current-query attribution, not only a loading transition", async () => {
  document.body.innerHTML =
    '<form><label>School<input role="combobox" aria-controls="schools" aria-expanded="true"></label><div id="schools" role="listbox" aria-busy="true" data-query="older search"><div role="option">Older school</div></div></form>'
  const { plan, executor, f } = fixture()
  const pending = executor.discover(plan, {
    interactionId: crypto.randomUUID(),
    kind: "discover_options",
    fieldId: f.fieldId,
    fieldRevision: f.fieldRevision,
    guardRef: f.guardRef,
    bindingRef: { semanticKey: "education_school", factId: "school" },
    queries: ["New search"],
    maxQueries: 1,
    maxScrollPages: 0,
  })
  const result = expect(pending).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(100)
  document.querySelector("#schools")?.setAttribute("aria-busy", "false")
  await vi.advanceTimersByTimeAsync(8000)
  await result
})

it("invalidates dependent state options after country selection", async () => {
  document.body.innerHTML =
    '<form><label>Country<select><option value="">Choose</option><option value="US">United States</option></select></label><label>State<select><option value="">Choose</option><option value="MA">Massachusetts</option></select></label></form>'
  const { plan, executor, f, action, scanner } = fixture()
  const option = f.options?.options.find((o) => o.label === "United States")
  if (!option || !f.options) throw new Error("Missing option")
  const select = {
    ...action,
    op: "set_single" as const,
    optionId: option.optionId,
    optionsRevision: f.options.optionsRevision,
    queryRevision: f.options.queryRevision,
  }
  const pending = executor.execute(plan, select, reviewPolicy())
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ status: "filled" })
  expect(
    scanner.observe().snapshot?.fields.find((f) => f.label === "State")?.options
      ?.loadState
  ).toBe("loading")
  const state = document.querySelectorAll("select")[1]
  if (!state) throw new Error("Missing state")
  state.add(new Option("New York", "NY"))
  expect(
    scanner.observe().snapshot?.fields.find((f) => f.label === "State")?.options
      ?.loadState
  ).toBe("ready")
})
it("keeps a pre-existing combobox query as user input without calling it committed", () => {
  document.body.innerHTML =
    '<form><label>School<input role="combobox" value="My unfinished search" aria-controls="schools"></label></form>'
  const { f } = fixture()
  expect(f.state).toMatchObject({ empty: false, hasUserValue: true })
  const entry = registry.entries.get(f.fieldId)
  if (!entry) throw new Error("Missing input")
  expect(committed(entry)).toBe("")
})
it("discovers a newly opened inline listbox without treating its popup as another field", async () => {
  document.body.innerHTML =
    '<form><button type="button" role="combobox" aria-label="School" aria-controls="schools" data-value="" aria-expanded="false"></button></form>'
  const button = document.querySelector("button")
  button?.addEventListener("click", () => {
    button.setAttribute("aria-expanded", "true")
    document
      .querySelector("form")
      ?.insertAdjacentHTML(
        "beforeend",
        '<div role="listbox" tabindex="-1" id="schools"><div role="option" data-value="uc">UC Berkeley</div></div>'
      )
  })
  const { plan, executor, f, scanner } = fixture()
  await executor.discover(plan, {
    interactionId: crypto.randomUUID(),
    kind: "discover_options",
    fieldId: f.fieldId,
    fieldRevision: f.fieldRevision,
    guardRef: f.guardRef,
    bindingRef: { semanticKey: "education_school", factId: "school" },
    queries: ["UC Berkeley"],
    maxQueries: 1,
    maxScrollPages: 1,
  })
  const next = scanner.observe().snapshot
  expect(next?.fields).toHaveLength(1)
  expect(next?.fields[0]?.options).toMatchObject({
    loadState: "ready",
    coverage: "partial",
  })
})

it("focuses an editable field and verifies contenteditable text without typing fake keys", async () => {
  document.body.innerHTML =
    '<main><div role="textbox" contenteditable="true" tabindex="0" aria-label="Summary"></div></main>'
  const { plan, executor, action } = fixture()
  const field = document.querySelector<HTMLElement>("[contenteditable]")
  if (!field) throw new Error("Missing editor")
  const scroll = vi.fn()
  field.scrollIntoView = scroll
  const input = vi.fn()
  const keys = vi.fn()
  field.addEventListener("input", input)
  field.addEventListener("keydown", keys)
  const pending = executor.execute(
    plan,
    { ...action, op: "set_text", value: "A useful summary", format: "plain" },
    reviewPolicy()
  )
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ status: "filled" })
  expect(field.textContent).toBe("A useful summary")
  expect(document.activeElement).toBe(field)
  expect(scroll).toHaveBeenCalledOnce()
  expect(input).toHaveBeenCalledOnce()
  expect(keys).not.toHaveBeenCalled()
})

it("fills semantic ARIA checkbox and radio controls using actual selected state", async () => {
  document.body.innerHTML =
    '<main><div role="checkbox" tabindex="0" aria-checked="false" aria-label="Willing to relocate"></div><div role="radiogroup" aria-label="Work authorization"><div role="radio" tabindex="0" aria-checked="false">Yes</div><div role="radio" tabindex="0" aria-checked="false">No</div></div></main>'
  const { plan, executor, action, scanner } = fixture()
  const checkbox = document.querySelector('[role="checkbox"]')
  checkbox?.addEventListener("click", () =>
    checkbox.setAttribute("aria-checked", "true")
  )
  const pending = executor.execute(
    plan,
    { ...action, op: "set_checked", checked: true },
    reviewPolicy()
  )
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ status: "filled" })
  const snapshot = scanner.observe().snapshot
  const radio = snapshot?.fields.find(
    (field) => field.label === "Work authorization"
  )
  const yes = radio?.options?.options.find((option) => option.label === "Yes")
  if (!radio?.options || !yes || !snapshot) throw new Error("Missing radio")
  const option = document.querySelector('[role="radio"]')
  option?.addEventListener("click", () =>
    option.setAttribute("aria-checked", "true")
  )
  const selected = executor.execute(
    {
      ...plan,
      snapshotId: snapshot.snapshotId,
      formRevision: snapshot.formRevision,
    },
    {
      ...action,
      actionId: crypto.randomUUID(),
      fieldId: radio.fieldId,
      fieldRevision: radio.fieldRevision,
      guardRef: radio.guardRef,
      op: "set_single",
      optionId: yes.optionId,
      optionsRevision: radio.options.optionsRevision,
      queryRevision: radio.options.queryRevision,
    },
    reviewPolicy()
  )
  await vi.advanceTimersByTimeAsync(500)
  expect(await selected).toMatchObject({ status: "filled" })
})

it("discovers changed stable query options without a site-specific data-query attribute", async () => {
  document.body.innerHTML =
    '<main><input role="combobox" aria-label="School" data-value="" aria-expanded="true" aria-controls="schools"><div role="listbox" id="schools"><div role="option">Previous school</div></div></main>'
  const { plan, executor, f, scanner } = fixture()
  document.querySelector("input")?.addEventListener("input", () => {
    const list = document.querySelector("#schools")
    if (list)
      list.innerHTML = '<div role="option" data-value="new">New school</div>'
  })
  const pending = executor.discover(plan, {
    interactionId: crypto.randomUUID(),
    kind: "discover_options",
    fieldId: f.fieldId,
    fieldRevision: f.fieldRevision,
    guardRef: f.guardRef,
    bindingRef: { semanticKey: "education_school", factId: "school" },
    queries: ["New school"],
    maxQueries: 1,
    maxScrollPages: 0,
  })
  await vi.advanceTimersByTimeAsync(500)
  await pending
  expect(scanner.observe().snapshot?.fields[0]?.options).toMatchObject({
    loadState: "ready",
    options: [{ label: "New school" }],
  })
})

it("adds only a newly observed safe record group and never activates submit buttons", async () => {
  document.body.innerHTML =
    '<main><fieldset><legend>Experience</legend><label>Employer<input></label></fieldset><button type="button">Add experience</button><form><button>Add education</button></form></main>'
  const { executor, scanner } = fixture()
  const observed = scanner.observe()
  expect(observed.recordEntrypoints).toHaveLength(1)
  const entry = observed.recordEntrypoints[0]
  if (!entry) throw new Error("Missing entry")
  document
    .querySelector('button[type="button"]')
    ?.addEventListener("click", () => {
      document
        .querySelector("main")
        ?.insertAdjacentHTML(
          "beforeend",
          "<fieldset><legend>Experience</legend><label>Employer<input></label></fieldset>"
        )
    })
  const pending = executor.addRecord(
    entry.entryRef,
    entry.entryRevision,
    "experience"
  )
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ changed: true })
  expect(document.querySelectorAll("fieldset")).toHaveLength(2)
  const button = document.querySelector('button[type="button"]')
  button?.setAttribute("type", "submit")
  await expect(
    executor.addRecord(entry.entryRef, entry.entryRevision, "experience")
  ).rejects.toThrow()
})

it("audits exact prior writes after rescans without exposing expected values", async () => {
  const { executor, plan, action, scanner } = fixture()
  const pending = executor.execute(plan, action, reviewPolicy())
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ status: "filled" })
  scanner.observe()
  expect(executor.audit()[0]).toMatchObject({
    status: "filled",
    verification: "accepted",
  })
  const input = document.querySelector("input")
  if (!input) throw new Error("Missing input")
  input.value = "different@example.test"
  scanner.observe()
  const report = executor.audit()
  expect(report[0]).toMatchObject({
    status: "unverified",
    reasonCode: "final_readback_changed",
  })
  expect(JSON.stringify(report)).not.toContain("example.test")
})

it("audits late validation and replaced controls as unverified", async () => {
  const { executor, plan, action, scanner } = fixture()
  const pending = executor.execute(plan, action, reviewPolicy())
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toMatchObject({ status: "filled" })
  const input = document.querySelector("input")
  if (!input) throw new Error("Missing input")
  input.setCustomValidity("Later validation rejected")
  scanner.observe()
  expect(executor.audit()[0]).toMatchObject({ status: "unverified" })
  input.setCustomValidity("")
  const replacement = input.cloneNode(true)
  input.replaceWith(replacement)
  scanner.observe()
  expect(executor.audit()[0]).toMatchObject({ status: "unverified" })
})
