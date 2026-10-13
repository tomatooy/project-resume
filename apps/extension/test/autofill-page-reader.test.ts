import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PageReader } from "../src/autofill/page-reader"
import { Registry } from "../src/autofill/registry"
import { Scanner } from "../src/autofill/scanner"
import { PageViewSchema } from "@workspace/resume-core/contracts"

let registry: Registry
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() =>
    Object.assign([new DOMRect(0, 0, 100, 20)], { item: () => null })
  )
  document.title = "Engineer"
  document.body.innerHTML = ""
  registry = new Registry(document)
})
afterEach(() => {
  registry.release()
  vi.restoreAllMocks()
})

it("collects fields without a form or application heading and keeps raw context", () => {
  document.body.innerHTML =
    '<main><h2>About you</h2><p id="note">Use the name you want us to use.</p><div><span id="name">Preferred name</span><input aria-labelledby="name" aria-describedby="note"></div><div contenteditable="true" role="textbox" aria-label="Summary"></div></main>'
  const read = new PageReader(registry).read()
  expect(read.controls).toHaveLength(2)
  expect(read.view.nodes.some((node) => node.text === "About you")).toBe(true)
  const input = document.querySelector("input")
  if (!input) throw new Error("Missing input")
  const node = read.view.nodes.find(
    (item) => item.ref === registry.idFor(input)
  )
  expect(
    node?.relations.filter((relation) => relation.kind === "label")
  ).toHaveLength(1)
  expect(
    node?.relations.filter((relation) => relation.kind === "description")
  ).toHaveLength(1)
  const observed = new Scanner(registry).observe().snapshot
  expect(observed?.fields.map((field) => field.label)).toEqual([
    "Preferred name",
    "Summary",
  ])
})

it("keeps unrelated controls observable without selecting a form first", () => {
  document.body.innerHTML =
    '<nav><input aria-label="Search"></nav><main><label>Email<input type="email"></label><button type="button">Add experience</button></main><div data-vs-autofill><input aria-label="Extension"></div>'
  const observed = new Scanner(registry).observe()
  expect(observed.snapshot?.fields.map((field) => field.label)).toEqual([
    "Search",
    "Email",
  ])
  const read = new PageReader(registry).read()
  expect(read.buttons.map((button) => button.textContent)).toEqual([
    "Add experience",
  ])
})

it("resolves shadow labels and external portal relations without duplicating slotted fields", () => {
  document.body.innerHTML =
    '<section id="host"><label slot="fields">Email<input type="email"></label></section><div role="listbox" id="countries"><div role="option">Canada</div></div>'
  const host = document.querySelector("#host")
  if (!host) throw new Error("Missing host")
  host.attachShadow({ mode: "open" }).innerHTML =
    '<h2 id="heading">Contact details</h2><slot name="fields"></slot><button type="button" role="combobox" aria-labelledby="heading" aria-controls="countries"></button>'
  const read = new PageReader(registry).read()
  expect(read.controls).toHaveLength(2)
  expect(read.roots).toHaveLength(2)
  const combo = read.controls.find(
    (element) => element.getAttribute("role") === "combobox"
  )
  if (!combo) throw new Error("Missing combo")
  const node = read.view.nodes.find(
    (item) => item.ref === registry.idFor(combo)
  )
  expect(
    node?.relations.filter((relation) => relation.kind === "controls")
  ).toHaveLength(1)
  expect(
    node?.relations.filter((relation) => relation.kind === "label")
  ).toHaveLength(1)
})

it("consumes shadow text mutations and reads silent property changes", async () => {
  document.body.innerHTML = '<main id="host"></main>'
  const host = document.querySelector("#host")
  if (!host) throw new Error("Missing host")
  const shadow = host.attachShadow({ mode: "open" })
  shadow.innerHTML = '<label><span>Email</span><input type="email"></label>'
  const scanner = new Scanner(registry)
  const first = scanner.observe().snapshot?.fields[0]
  if (!first) throw new Error("Missing field")
  const input = shadow.querySelector("input")
  const labelText = shadow.querySelector("span")?.firstChild
  if (!input || !labelText) throw new Error("Missing nodes")
  labelText.textContent = "Contact email"
  input.value = "saved@example.test"
  await Promise.resolve()
  expect(registry.entries.get(first.fieldId)?.dirty).toBe(true)
  const next = scanner.observe().snapshot?.fields[0]
  expect(next?.label).toBe("Contact email")
  expect(next?.state.empty).toBe(false)
  expect(next?.guardRef).not.toBe(first.guardRef)
  expect(registry.entries.get(first.fieldId)?.dirty).toBe(false)
})

it("reports candidate and text truncation rather than claiming complete coverage", () => {
  document.body.innerHTML = `<main><p>${"Context ".repeat(12000)}</p>${Array.from({ length: 205 }, (_, index) => `<input aria-label="Field ${index}">`).join("")}</main>`
  const read = new PageReader(registry).read()
  expect(read.truncated).toBe(true)
  const observed = new Scanner(registry).observe().snapshot
  expect(observed?.fields).toHaveLength(200)
  expect(observed?.coverage).toBe("partial")
  expect(observed?.coverageReasons).toContain("truncated")
})

it("tracks unknown combobox commitment separately from a known empty value", () => {
  document.body.innerHTML =
    '<input role="combobox" aria-label="School" aria-expanded="false"><input aria-label="Email">'
  const fields = new Scanner(registry).observe().snapshot?.fields
  expect(fields?.[0]?.state).toMatchObject({
    empty: false,
    commitState: "unknown",
  })
  expect(fields?.[1]?.state).toMatchObject({
    empty: true,
    commitState: "known",
  })
})

it("invalidates refs on replaced nodes and never exposes password contents", () => {
  document.body.innerHTML =
    '<input aria-label="Email"><input type="password" value="secret-value">'
  const reader = new PageReader(registry)
  const first = reader.read()
  const input = document.querySelector("input")
  if (!input) throw new Error("Missing input")
  const before = registry.idFor(input)
  input.replaceWith(input.cloneNode(true))
  const second = reader.read()
  expect(
    second.controls.map((element) => registry.idFor(element))
  ).not.toContain(before)
  expect(JSON.stringify(first.view)).not.toContain("secret-value")
  expect(JSON.stringify(second.view)).not.toContain("secret-value")
})

it("keeps the model graph within its byte budget without dropping field identities", () => {
  document.body.innerHTML = Array.from(
    { length: 200 },
    (_, index) => `<label>${"名字".repeat(500)} ${index}<input></label>`
  ).join("")
  const observed = new Scanner(registry).observe().snapshot
  expect(observed?.fields).toHaveLength(200)
  const view = observed?.pageView
  if (!view) throw new Error("Missing view")
  expect(
    new TextEncoder().encode(JSON.stringify(view)).byteLength
  ).toBeLessThanOrEqual(49152)
  expect(view.nodes.filter((node) => node.fieldId)).toHaveLength(200)
  expect(view.coverage.truncated).toBe(true)
})

it("does not leak rich-editor contents through nested context nodes", () => {
  document.body.innerHTML =
    '<label>Summary<div contenteditable="true"><p><span>Private current answer</span></p></div></label><label>Bio<textarea>Private textarea answer</textarea></label>'
  const view = new PageReader(registry).read().view
  expect(JSON.stringify(view)).not.toContain("Private current answer")
  expect(JSON.stringify(view)).not.toContain("Private textarea answer")
})

it("gives top-level shadow fields a same-root region and bounded root coverage", () => {
  for (let index = 0; index < 42; index++) {
    const host = document.createElement("section")
    document.body.append(host)
    host.attachShadow({
      mode: "open",
    }).innerHTML = `<input aria-label="Email ${index}">`
  }
  const observed = new Scanner(registry).observe().snapshot
  const view = observed?.pageView
  if (!view) throw new Error("Missing view")
  expect(PageViewSchema.safeParse(view).success).toBe(true)
  expect(view.roots).toHaveLength(40)
  expect(observed?.fields).toHaveLength(39)
  expect(view.coverage.truncated).toBe(true)
  expect(registry.validStructure()).toBe(true)
  for (const field of observed?.fields ?? []) {
    const node = view.nodes.find((entry) => entry.fieldId === field.fieldId)
    expect(node?.parentRef).toBe(node?.rootId)
    expect(view.nodes.find((entry) => entry.ref === node?.parentRef)?.tag).toBe(
      "#shadow-root"
    )
  }
})

it("retains graph identities when many radio candidates collapse into one field", () => {
  document.body.innerHTML = `<fieldset><legend>Availability</legend>${Array.from({ length: 150 }, (_, index) => `<label>Option ${index}<input type="radio" name="availability" value="${index}"></label>`).join("")}</fieldset>${Array.from({ length: 100 }, (_, index) => `<input aria-label="Field ${index}">`).join("")}`
  const observed = new Scanner(registry).observe().snapshot
  if (!observed?.pageView) throw new Error("Missing view")
  expect(observed.fields).toHaveLength(51)
  expect(
    observed.fields.every((field) =>
      observed.pageView?.nodes.some((node) => node.fieldId === field.fieldId)
    )
  ).toBe(true)
  expect(observed.pageView.coverage.truncated).toBe(true)
  expect(registry.validStructure()).toBe(true)
})

it("keeps unsupported ARIA values unknown and hides their rendered value text", () => {
  document.body.innerHTML =
    '<div role="textbox" aria-label="Name"><span>Private saved name</span></div><button type="button" role="combobox" aria-label="School"><span>Private selected school</span></button><select role="combobox" aria-label="Country"><option value="">Choose</option></select>'
  const observed = new Scanner(registry).observe().snapshot
  expect(observed?.fields[0]?.state).toMatchObject({
    empty: false,
    commitState: "unknown",
  })
  expect(observed?.fields[2]?.state).toMatchObject({
    empty: true,
    commitState: "known",
  })
  expect(JSON.stringify(observed?.pageView)).not.toContain("Private saved name")
  expect(JSON.stringify(observed?.pageView)).not.toContain(
    "Private selected school"
  )
})

it("reports late native and ARIA validation failures on a new observation", () => {
  document.body.innerHTML =
    '<input type="email" aria-label="Email"><div contenteditable="true" role="textbox" aria-label="Summary" aria-errormessage="error"></div><p id="error" hidden>Answer rejected</p>'
  const scanner = new Scanner(registry)
  const input = document.querySelector("input")
  const error = document.querySelector("#error")
  if (!input || !(error instanceof HTMLElement))
    throw new Error("Missing controls")
  input.value = "valid@example.test"
  expect(scanner.observe().snapshot?.fields[0]?.state.validationState).toBe(
    "valid"
  )
  input.setCustomValidity("Email rejected")
  error.hidden = false
  expect(
    scanner
      .observe()
      .snapshot?.fields.map((field) => field.state.validationState)
  ).toEqual(["invalid", "invalid"])
})

it("keeps nested record-entry buttons inside their actual application region", () => {
  document.body.innerHTML =
    '<main><label>Employer<input></label><div><div><button type="button">Add experience</button></div></div></main>'
  const observed = new Scanner(registry).observe()
  const view = observed.snapshot?.pageView
  const entry = observed.recordEntrypoints[0]
  const region = view?.nodes.find((node) => node.tag === "main")
  if (!view || !entry || !region) throw new Error("Missing observed region")
  let node = view.nodes.find((item) => item.ref === entry.entryRef)
  const ancestors: string[] = []
  while (node?.parentRef) {
    const parentRef = node.parentRef
    ancestors.push(parentRef)
    node = view.nodes.find((item) => item.ref === parentRef)
  }
  expect(ancestors).toContain(region.ref)
})

it("keeps referenced descriptions free of editable values and refreshes shadow portal meaning", () => {
  document.body.innerHTML =
    '<p id="note">Contact email<textarea>Private saved answer</textarea></p><section id="host"></section>'
  const host = document.querySelector("#host")
  const note = document.querySelector("#note")
  if (!host || !note) throw new Error("Missing host")
  host.attachShadow({ mode: "open" }).innerHTML =
    '<input aria-label="Email" aria-describedby="note">'
  const scanner = new Scanner(registry)
  const first = scanner
    .observe()
    .snapshot?.fields.find((field) => field.label === "Email")
  expect(first?.description).toBe("Contact email")
  if (!note.firstChild) throw new Error("Missing description")
  note.firstChild.textContent = "School email"
  const next = scanner
    .observe()
    .snapshot?.fields.find((field) => field.label === "Email")
  expect(next?.fieldRevision).not.toBe(first?.fieldRevision)
})
