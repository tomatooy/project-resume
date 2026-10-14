import { afterEach, describe, expect, it, vi } from "vitest"
import { unaccountedQuestions } from "@workspace/resume-core/dom-agent"
import { observePage, readOptions } from "../src/dom-agent/observation"
import {
  attachOptions,
  candidateQuestions,
  exactLabelMatch,
  questionKindFor,
  unsupportedQuestions,
} from "../src/dom-agent/questions"
import { attachPage, buildPage, createPageTransport } from "./helpers/cdp-page"

afterEach(() => vi.unstubAllGlobals())

/**
 * Enumerate a page the way a run does: observe first, then enumerate, because
 * the question list is only ever derived from what was actually read.
 */
async function enumerate(html: string) {
  const page = createPageTransport()
  page.setDocument(null, buildPage(html))
  const { session } = await attachPage({ transport: page })
  const read = await observePage({ session })
  const enumeration = candidateQuestions({
    observation: read.observation,
    evidence: read.evidence,
    regions: read.regions,
    records: read.records,
  })
  return { read, session, page, ...enumeration }
}

describe("enumeration", () => {
  it("lists every control in document order before classifying anything", async () => {
    const page = await enumerate(
      `<form>
        <label for="name">Full name</label><input id="name" name="name">
        <label for="country">Country</label>
        <select id="country" name="country"><option>Portugal</option></select>
        <label for="why">Why us?</label><textarea id="why" name="why"></textarea>
      </form>`
    )

    expect(page.questions.map((question) => question.ref)).toEqual([
      "q1",
      "q2",
      "q3",
    ])
    expect(page.questions.map((question) => question.kind)).toEqual([
      "short_text",
      "single_choice",
      "long_text",
    ])
    await page.session.detach()
  })

  it("carries wording, description, constraints and group context", async () => {
    const page = await enumerate(
      `<form><fieldset><legend>Contact</legend>
        <div id="hint">We only use this to reply.</div>
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" required aria-describedby="hint">
      </fieldset></form>`
    )

    const question = page.questions[0]
    expect(question?.text).toBe("Email address")
    expect(question?.description).toBe("We only use this to reply.")
    expect(question?.requiredness).toEqual({
      state: "required",
      evidence: ["native_attribute"],
    })
    // The group context is the fieldset the control sits in.
    const group = page.read.observation.nodes.find(
      (node) => node.ref === question?.groupRef
    )
    expect(group?.tag).toBe("fieldset")
    // The constraint rides on the control, which the question points at.
    const control = page.read.observation.nodes.find(
      (node) => node.ref === question?.controlRef
    )
    expect(control?.control?.kind).toBe("email")
    await page.session.detach()
  })

  it("stays the same for an unchanged observation", async () => {
    const html = `<form>
      <label for="a">First name</label><input id="a" name="a">
      <label for="b">Last name</label><input id="b" name="b">
      <label for="c">Email</label><input id="c" name="c">
    </form>`
    const first = await enumerate(html)
    const second = await enumerate(html)

    expect(second.questions.map((question) => question.ref)).toEqual(
      first.questions.map((question) => question.ref)
    )
    expect(second.questions.map((question) => question.text)).toEqual(
      first.questions.map((question) => question.text)
    )
    await first.session.detach()
    await second.session.detach()
  })

  it("accounts for every candidate with exactly one disposition", async () => {
    const page = await enumerate(
      `<form>
        <label for="a">Name</label><input id="a" name="a">
        <label for="b">Notes</label><input id="b" name="b" disabled>
        <label for="c">Reference</label><input id="c" name="c" readonly>
      </form>`
    )

    expect(Object.keys(page.dispositions)).toHaveLength(page.questions.length)
    expect(unaccountedQuestions(page.questions, page.dispositions)).toEqual([])
    expect(page.dispositions.q1).toBe("unverified")
    // A disabled control is not something to ask the user about again.
    expect(page.dispositions.q2).toBe("unsupported")
    // A readonly control is a value the page set and we leave alone.
    expect(page.dispositions.q3).toBe("preserved")
    await page.session.detach()
  })

  it("keeps a control the page never labelled", async () => {
    const page = await enumerate(`<input name="mystery">`)
    expect(page.questions).toHaveLength(1)
    expect(page.questions[0]?.text).toBe("[unlabelled short_text]")
    await page.session.detach()
  })
})

describe("awkward shapes", () => {
  it("keeps an upload input the page hid behind a visible interaction", async () => {
    const page = await enumerate(
      `<div>
        <label for="cv" class="button">Upload your CV</label>
        <input id="cv" name="cv" type="file" hidden aria-hidden="true"
               style="display:none">
      </div>`
    )

    expect(page.questions).toHaveLength(1)
    expect(page.questions[0]?.kind).toBe("file")
    expect(page.questions[0]?.text).toBe("Upload your CV")
    await page.session.detach()
  })

  it("treats a radio set as one question, not one per option", async () => {
    const page = await enumerate(
      `<fieldset><legend>Right to work</legend>
        <label><input type="radio" name="rtw" value="yes">Yes</label>
        <label><input type="radio" name="rtw" value="no">No</label>
      </fieldset>`
    )

    expect(page.questions).toHaveLength(1)
    expect(page.questions[0]?.kind).toBe("single_choice")
    expect(page.questions[0]?.options.map((option) => option.label)).toEqual([
      "Yes",
      "No",
    ])
    await page.session.detach()
  })

  it("reads a yes/no looking select as a single choice, not a yes/no question", async () => {
    const page = await enumerate(
      `<label for="sponsor">Will you require sponsorship?</label>
       <select id="sponsor" name="sponsor">
         <option>Yes</option><option>No</option>
       </select>`
    )

    // Deciding that Yes/No options mean a yes/no question is an interpretation.
    expect(page.questions[0]?.kind).toBe("single_choice")
    await page.session.detach()
  })

  it("marks repeated record groups with their own record reference", async () => {
    const page = await enumerate(
      `<form>
        <div class="record"><label for="c1">Company</label><input id="c1" name="company1"></div>
        <div class="record"><label for="c2">Company</label><input id="c2" name="company2"></div>
      </form>`
    )

    const records = page.questions.map((question) => question.recordRef)
    expect(records[0]).not.toBeNull()
    expect(records[1]).not.toBeNull()
    expect(records[0]).not.toBe(records[1])
    await page.session.detach()
  })

  it("owns the options of a portal rather than inventing a question for them", async () => {
    const page = await enumerate(
      `<div>
        <label for="pick">Location</label>
        <input id="pick" role="combobox" aria-controls="list" aria-haspopup="listbox">
        <div id="list" role="listbox">
          <div role="option">Lisbon</div>
          <div role="option">Porto</div>
        </div>
      </div>`
    )

    // One question. The listbox is the control's option list, not a question.
    expect(page.questions).toHaveLength(1)
    expect(page.questions[0]?.text).toBe("Location")
    expect(page.needingOptions).toEqual(["q1"])

    const question = page.questions[0]
    if (!question) throw new Error("fixture missing question")
    const portal = await readOptions({
      session: page.session,
      read: page.read,
      controlRef: question.controlRef,
    })
    expect(portal.gap).toBeNull()
    const filled = attachOptions(question, portal.options)
    expect(filled.options.map((option) => option.label)).toEqual([
      "Lisbon",
      "Porto",
    ])
    await page.session.detach()
  })

  it("asks for the options of a combobox whose list is not mounted", async () => {
    const page = await enumerate(
      `<label for="pick">Location</label>
       <input id="pick" role="combobox" aria-controls="list" aria-haspopup="listbox">`
    )

    expect(page.questions).toHaveLength(1)
    expect(page.questions[0]?.options).toEqual([])
    // The question is listed as needing a read, and the read says why not.
    expect(page.needingOptions).toEqual(["q1"])

    const question = page.questions[0]
    if (!question) throw new Error("fixture missing question")
    const portal = await readOptions({
      session: page.session,
      read: page.read,
      controlRef: question.controlRef,
    })
    expect(portal.options).toEqual([])
    expect(portal.gap?.detail).toMatch(/not mounted/)
    await page.session.detach()
  })
})

describe("the deterministic tier stays bounded", () => {
  it("matches wording exactly and near misses return nothing", async () => {
    const page = await enumerate(
      `<label for="a">First name*</label><input id="a" name="a">`
    )
    const question = page.questions[0]
    if (!question) throw new Error("fixture missing question")

    // Normalization is the only licence: case, spacing and the required marker.
    expect(exactLabelMatch(question, ["first name"])).toBe("first name")
    expect(exactLabelMatch(question, ["First name *"])).toBe("First name *")
    // A near miss is not a match, because matching it would be a reading.
    expect(exactLabelMatch(question, ["name"])).toBeNull()
    expect(exactLabelMatch(question, ["given name"])).toBeNull()
    expect(exactLabelMatch(question, ["First name", "Surname"])).toBe(
      "First name"
    )
    await page.session.detach()
  })

  it("reads kinds from the control only", () => {
    expect(questionKindFor("checkbox")).toBe("yes_no")
    expect(questionKindFor("checkbox_group")).toBe("multi_choice")
    expect(questionKindFor("radio_group")).toBe("single_choice")
    expect(questionKindFor("file")).toBe("file")
    expect(questionKindFor("unknown")).toBe("unknown")
  })

  it("reports a control it cannot classify instead of guessing", async () => {
    const page = await enumerate(
      `<div contenteditable="true" role="application"></div>`
    )
    expect(unsupportedQuestions(page.questions)).toHaveLength(
      page.questions.length
    )
    await page.session.detach()
  })
})
