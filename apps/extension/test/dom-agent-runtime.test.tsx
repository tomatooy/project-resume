import { act, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import {
  createRuntimeState,
  handleDispatch,
} from "../src/dom-agent/runtime/dispatch"
import {
  RUNTIME_EVIDENCE,
  RUNTIME_VERSION,
  type RuntimeExpectation,
} from "../src/dom-agent/runtime/protocol"
import {
  addRecordGroup,
  attachFile,
  discoverOptions,
  readControl,
  selectOption,
  toggle,
  writeText,
} from "../src/dom-agent/runtime/verbs"

/**
 * The verbs run against hand-written markup, including the two cases that make
 * this runtime worth having: a framework that keeps the edit, and one that puts
 * the old value back. The second must never be reported as a success.
 */

/**
 * Hand-written markup, parsed in its own document so nothing is assigned as a
 * string to the document under test.
 */
function mount(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html")
  document.body.replaceChildren(...parsed.body.childNodes)
}

function query<T extends Element>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector)
  if (!(found instanceof type)) throw new Error(`Expected ${selector}`)
  return found
}

function expectation(
  overrides: Partial<RuntimeExpectation> = {}
): RuntimeExpectation {
  return {
    documentGeneration: "gen-1",
    questionRevision: 1,
    sourceBundleId: "bundle-1",
    userEditEpoch: 0,
    settleMs: 50,
    expectedValue: null,
    expectedChecked: null,
    expectedOptionLabel: null,
    ...overrides,
  }
}

/** A PDF that passes the magic-number and length checks. */
function pdfBytes(extra = "1"): { base64: string; sizeBytes: number } {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n${extra}`)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { base64: btoa(binary), sizeBytes: bytes.length }
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("reading", () => {
  it("reports live widget state rather than markup", () => {
    mount('<input id="a" value="typed" aria-label="First name">')
    const control = query("#a", HTMLInputElement)
    control.value = "live"
    const result = readControl(control)
    expect(result.state).toBe("accepted")
    expect(result.observed.value).toBe("live")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.readSucceeded])
  })

  it("refuses a control that has left the document", () => {
    mount('<input id="a">')
    const control = query("#a", HTMLInputElement)
    control.remove()
    expect(readControl(control).evidence).toEqual([
      RUNTIME_EVIDENCE.notConnected,
    ])
  })

  it("lists options in document order with the selected one named", () => {
    mount(
      '<select id="a"><option>First</option><option selected> Second </option></select>'
    )
    const result = discoverOptions(query("#a", HTMLSelectElement))
    expect(result.state).toBe("accepted")
    expect(result.options.map((option) => option.label)).toEqual([
      "First",
      "Second",
    ])
    expect(result.observed.selectedOptionLabel).toBe("Second")
  })

  it("reports a control with no options as unresolved rather than empty", () => {
    mount('<input id="a" type="text">')
    const result = discoverOptions(query("#a", HTMLInputElement))
    expect(result.state).toBe("unresolved")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.optionNotFound])
  })
})

describe("writing text", () => {
  it("sets the value and reports what it observed", async () => {
    mount('<input id="a" aria-label="City">')
    const control = query("#a", HTMLInputElement)
    const result = await writeText(
      control,
      { kind: "write_text", value: "Lisbon" },
      expectation()
    )
    expect(result.state).toBe("accepted")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.valueSet])
    expect(result.observed.value).toBe("Lisbon")
    expect(control.value).toBe("Lisbon")
  })

  it("refuses when the control does not hold what the action expected", async () => {
    mount('<input id="a" value="Someone else">')
    const control = query("#a", HTMLInputElement)
    const result = await writeText(
      control,
      { kind: "write_text", value: "Ada" },
      expectation({ expectedValue: "" })
    )
    expect(result.state).toBe("rejected")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.expectedValueMismatch])
    // The page value the user set is never overwritten by a stale action.
    expect(control.value).toBe("Someone else")
  })

  it("refuses a read-only control", async () => {
    mount('<input id="a" readonly aria-label="Account">')
    const result = await writeText(
      query("#a", HTMLInputElement),
      { kind: "write_text", value: "x" },
      expectation()
    )
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.readOnly])
  })

  it("refuses a disabled control", async () => {
    mount('<input id="a" disabled>')
    const result = await writeText(
      query("#a", HTMLInputElement),
      { kind: "write_text", value: "x" },
      expectation()
    )
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.disabled])
  })

  it("keeps an edit a framework accepts", async () => {
    function Accepting() {
      const [value, setValue] = useState("")
      return (
        <input
          aria-label="First name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      )
    }
    render(<Accepting />)
    const control = query("input", HTMLInputElement)
    let result: Awaited<ReturnType<typeof writeText>> | undefined
    await act(async () => {
      result = await writeText(
        control,
        { kind: "write_text", value: "Ada" },
        expectation()
      )
    })
    expect(result?.state).toBe("accepted")
    expect(control.value).toBe("Ada")
  })

  it("reports a framework putting the value back as rejected, not accepted", async () => {
    function Reverting() {
      const [value] = useState("")
      return (
        <input
          aria-label="First name"
          value={value}
          onChange={() => undefined}
        />
      )
    }
    render(<Reverting />)
    const control = query("input", HTMLInputElement)
    let result: Awaited<ReturnType<typeof writeText>> | undefined
    await act(async () => {
      result = await writeText(
        control,
        { kind: "write_text", value: "Ada" },
        expectation()
      )
    })
    expect(result?.state).toBe("rejected")
    expect(result?.evidence).toEqual([RUNTIME_EVIDENCE.valueReverted])
    expect(control.value).toBe("")
  })

  it("reports a value the page normalized as unresolved", async () => {
    mount('<input id="a" aria-label="Phone">')
    const control = query("#a", HTMLInputElement)
    control.addEventListener("input", () => {
      control.value = control.value.replace(/[^0-9]/g, "")
    })
    const result = await writeText(
      control,
      { kind: "write_text", value: "123-456" },
      expectation()
    )
    expect(result.state).toBe("unresolved")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.valueNotSettled])
    expect(result.observed.value).toBe("123456")
  })
})

describe("toggling", () => {
  it("checks a box and reports the state it observed", async () => {
    mount('<input id="a" type="checkbox">')
    const control = query("#a", HTMLInputElement)
    const result = await toggle(
      control,
      { kind: "toggle", checked: true },
      expectation({ expectedChecked: false })
    )
    expect(result.state).toBe("accepted")
    expect(control.checked).toBe(true)
  })

  it("refuses when the box is not in the state the action expected", async () => {
    mount('<input id="a" type="checkbox">')
    const result = await toggle(
      query("#a", HTMLInputElement),
      { kind: "toggle", checked: true },
      expectation({ expectedChecked: true })
    )
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.expectedCheckedMismatch])
  })

  it("reports a box a page puts back as rejected", async () => {
    mount('<input id="a" type="checkbox">')
    const control = query("#a", HTMLInputElement)
    control.addEventListener("change", () => {
      control.checked = false
    })
    const result = await toggle(
      control,
      { kind: "toggle", checked: true },
      expectation()
    )
    expect(result.state).toBe("rejected")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.checkedReverted])
  })
})

describe("choosing an option", () => {
  function select(): HTMLSelectElement {
    mount(
      '<select id="a"><option>Country</option><option>Portugal</option><option>Spain</option></select>'
    )
    return query("#a", HTMLSelectElement)
  }

  it("selects an option the page shows, by its label", async () => {
    const control = select()
    const result = await selectOption(
      control,
      { kind: "select_option", optionLabel: "Portugal" },
      expectation({ expectedOptionLabel: "Country" })
    )
    expect(result.state).toBe("accepted")
    expect(control.value).toBe("Portugal")
  })

  it("refuses a label the page does not show", async () => {
    const result = await selectOption(
      select(),
      { kind: "select_option", optionLabel: "Atlantis" },
      expectation()
    )
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.optionNotFound])
  })

  it("refuses a label two options share", async () => {
    mount('<select id="a"><option>Yes</option><option>Yes</option></select>')
    const result = await selectOption(
      query("#a", HTMLSelectElement),
      { kind: "select_option", optionLabel: "Yes" },
      expectation()
    )
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.optionAmbiguous])
  })

  it("refuses when the selection is not what the action expected", async () => {
    const result = await selectOption(
      select(),
      { kind: "select_option", optionLabel: "Portugal" },
      expectation({ expectedOptionLabel: "Spain" })
    )
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.expectedOptionMismatch])
  })

  it("selects one radio in a group", async () => {
    mount(`
      <fieldset>
        <label><input type="radio" name="auth" value="yes"> Yes</label>
        <label><input type="radio" name="auth" value="no"> No</label>
      </fieldset>`)
    const control = query('input[value="yes"]', HTMLInputElement)
    const result = await selectOption(
      control,
      { kind: "select_option", optionLabel: "Yes" },
      expectation()
    )
    expect(result.state).toBe("accepted")
    expect(control.checked).toBe(true)
  })

  it("reports an option the page did not commit as unresolved", async () => {
    mount(
      '<select id="a"><option>Country</option><option>Portugal</option></select>'
    )
    const control = query("#a", HTMLSelectElement)
    control.addEventListener("change", () => {
      control.value = "Country"
    })
    const result = await selectOption(
      control,
      { kind: "select_option", optionLabel: "Portugal" },
      expectation()
    )
    expect(result.state).toBe("unresolved")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.optionNotSelected])
  })
})

describe("attaching a file", () => {
  const bytes = pdfBytes()

  it("hands the bytes to the input and says the upload is unverified", () => {
    mount('<input id="a" type="file">')
    const control = query("#a", HTMLInputElement)
    const result = attachFile(control, {
      kind: "attach_file",
      file: {
        name: "ada-resume.pdf",
        type: "application/pdf",
        sizeBytes: bytes.sizeBytes,
        base64: bytes.base64,
      },
      replaceExisting: false,
    })
    // The FileList is a local handoff. The site accepting it is a separate
    // question, so this is never reported as accepted.
    expect(result.state).toBe("unresolved")
    expect(result.evidence).toEqual([
      RUNTIME_EVIDENCE.fileListAssigned,
      RUNTIME_EVIDENCE.uploadStateNotObservable,
    ])
    expect(result.observed.attachmentName).toBe("ada-resume.pdf")
  })

  it("refuses to replace an attachment without a reviewed choice", () => {
    mount('<input id="a" type="file">')
    const control = query("#a", HTMLInputElement)
    Object.defineProperty(control, "files", {
      value: {
        length: 1,
        item: () => new File(["old"], "old.pdf", { type: "application/pdf" }),
      },
      configurable: true,
    })
    const result = attachFile(control, {
      kind: "attach_file",
      file: {
        name: "ada-resume.pdf",
        type: "application/pdf",
        sizeBytes: bytes.sizeBytes,
        base64: bytes.base64,
      },
      replaceExisting: false,
    })
    expect(result.state).toBe("rejected")
    expect(result.evidence).toEqual([
      RUNTIME_EVIDENCE.existingAttachmentPreserved,
    ])
  })

  it("refuses bytes that are not the rendered PDF", () => {
    mount('<input id="a" type="file">')
    const result = attachFile(query("#a", HTMLInputElement), {
      kind: "attach_file",
      file: {
        name: "notes.pdf",
        type: "application/pdf",
        sizeBytes: 8,
        base64: btoa("not a pdf"),
      },
      replaceExisting: true,
    })
    expect(result.state).toBe("rejected")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.fileMalformed])
  })

  it("refuses a control that is not a file input", () => {
    mount('<input id="a" type="text">')
    const result = attachFile(query("#a", HTMLInputElement), {
      kind: "attach_file",
      file: {
        name: "ada-resume.pdf",
        type: "application/pdf",
        sizeBytes: bytes.sizeBytes,
        base64: bytes.base64,
      },
      replaceExisting: true,
    })
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.unsupportedControl])
  })
})

describe("adding a record group", () => {
  it("refuses a button that would submit the form", async () => {
    // An untyped button defaults to submit, so the missing attribute is not
    // evidence that it is safe to activate.
    mount('<form><button id="a">Add another</button></form>')
    const result = await addRecordGroup(query("#a", HTMLButtonElement))
    expect(result.state).toBe("rejected")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.submitAffordanceRefused])
  })

  it("refuses a submit button", async () => {
    mount('<form><button id="a" type="submit">Add another</button></form>')
    const result = await addRecordGroup(query("#a", HTMLButtonElement))
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.submitAffordanceRefused])
  })

  it("activates the named control and reports the container growing", async () => {
    mount(`
      <button id="add" type="button" aria-controls="roles">Add another role</button>
      <div id="roles"><div>Role 1</div></div>`)
    const control = query("#add", HTMLButtonElement)
    control.addEventListener("click", () => {
      const container = document.querySelector("#roles")
      container?.appendChild(document.createElement("div"))
    })
    const result = await addRecordGroup(control)
    expect(result.state).toBe("accepted")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.groupChildCountIncreased])
    expect(result.observed.groupChildCount).toBe(2)
  })

  it("reports unresolved when the page does not name the container", async () => {
    mount('<button id="add" type="button">Add another role</button>')
    const result = await addRecordGroup(query("#add", HTMLButtonElement))
    expect(result.state).toBe("unresolved")
    expect(result.evidence).toEqual([RUNTIME_EVIDENCE.groupGrowthNotObservable])
  })
})

describe("dispatch", () => {
  function call(
    input: {
      actionRef?: string
      questionRef?: string
      verb?: unknown
      step?: unknown
      expect?: unknown
      version?: unknown
    },
    control: unknown,
    state = createRuntimeState()
  ) {
    return handleDispatch.call(
      control,
      input.actionRef ?? "action-1",
      input.questionRef ?? "question-1",
      input.verb ?? "read_control",
      input.step ?? { kind: "read_control" },
      input.expect ?? expectation(),
      input.version ?? RUNTIME_VERSION,
      state
    )
  }

  it("runs a verb that is in the vocabulary, and only that", async () => {
    mount('<input id="a" value="here">')
    const control = query("#a", HTMLInputElement)
    const ok = await call({}, control)
    expect(ok.ok).toBe(true)
    // A verb that is not in the frozen vocabulary is refused before any
    // dispatch, however it is spelled.
    const hostile = await call({ verb: "globalThis.eval('1+1')" }, control)
    expect(hostile).toEqual({ ok: false, reason: RUNTIME_EVIDENCE.unknownVerb })
  })

  it("refuses a step it cannot read", async () => {
    mount('<input id="a">')
    const result = await call(
      { verb: "write_text", step: { kind: "write_text" } },
      query("#a", HTMLInputElement)
    )
    expect(result).toEqual({ ok: false, reason: RUNTIME_EVIDENCE.malformed })
  })

  it("refuses a request with no control behind it", async () => {
    const result = await call({}, null)
    expect(result).toEqual({ ok: false, reason: RUNTIME_EVIDENCE.malformed })
  })

  it("refuses a call from another runtime build", async () => {
    mount('<input id="a">')
    const result = await call(
      { version: RUNTIME_VERSION + 1 },
      query("#a", HTMLInputElement)
    )
    expect(result).toEqual({
      ok: false,
      reason: RUNTIME_EVIDENCE.versionMismatch,
    })
  })

  it("refuses a question revision older than one it already handled", async () => {
    mount('<input id="a">')
    const control = query("#a", HTMLInputElement)
    const state = createRuntimeState()
    const first = await call(
      { expect: expectation({ questionRevision: 4 }) },
      control,
      state
    )
    expect(first.ok).toBe(true)
    const replayed = await call(
      { expect: expectation({ questionRevision: 3 }) },
      control,
      state
    )
    expect(replayed).toEqual({
      ok: true,
      outcome: expect.objectContaining({
        state: "rejected",
        evidence: [RUNTIME_EVIDENCE.staleRevision],
      }),
    })
  })

  it("refuses a source bundle that changed mid-application", async () => {
    mount('<input id="a">')
    const control = query("#a", HTMLInputElement)
    const state = createRuntimeState()
    await call({}, control, state)
    const changed = await call(
      { expect: expectation({ sourceBundleId: "bundle-2" }) },
      control,
      state
    )
    expect(changed).toEqual({
      ok: true,
      outcome: expect.objectContaining({
        state: "rejected",
        evidence: [RUNTIME_EVIDENCE.bundleChanged],
      }),
    })
  })

  it("reports a page that throws as a failed action", async () => {
    const hostile = {
      nodeType: 1,
      get isConnected(): boolean {
        throw new Error("The page is hostile")
      },
    }
    const result = await call({}, hostile)
    expect(result).toEqual({
      ok: true,
      outcome: expect.objectContaining({
        state: "failed",
        evidence: [RUNTIME_EVIDENCE.pageThrew],
      }),
    })
  })
})
