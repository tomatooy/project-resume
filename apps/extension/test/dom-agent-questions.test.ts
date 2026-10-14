import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CandidateQuestionSchema,
  isUnlabelledWording,
  reusableQuestionKey,
  unaccountedQuestions,
} from "@workspace/resume-core/dom-agent"
import { observePage, readOptions } from "../src/dom-agent/observation"
import {
  attachOptions,
  candidateQuestions,
  exactLabelMatch,
  questionKindFor,
  unsupportedQuestions,
} from "../src/dom-agent/questions"
import { attachPage } from "./helpers/cdp-page"
import { FIXTURES_DIR, pageFromMarkup } from "./helpers/fixture-loader"

afterEach(() => vi.unstubAllGlobals())

/**
 * Enumerate a page the way a run does: observe first, then enumerate, because
 * the question list is only ever derived from what was actually read.
 */
async function enumerate(html: string) {
  // A page goes through the recorder and the loader, so this suite enumerates a
  // recorded page rather than a payload handed straight to the transport.
  const page = pageFromMarkup(html)
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
        <input id="email" name="email" type="email" required aria-describedby="hint" maxlength="80" inputmode="email">
      </fieldset></form>`
    )

    const question = page.questions[0]
    expect(question?.text).toBe("Email address")
    expect(question?.description).toBe("We only use this to reply.")
    expect(question?.requiredness).toEqual({
      state: "required",
      evidence: ["native_attribute"],
    })
    // What the page states about an acceptable answer, knowable before a write.
    expect(question?.constraints).toEqual({
      maxLength: 80,
      pattern: null,
      min: null,
      max: null,
      inputMode: "email",
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

  it("gives every option a reference, so a choice can be addressed", async () => {
    const page = await enumerate(
      `<label for="pick">Country</label>
       <select id="pick" name="pick">
         <option value="pt">Portugal</option>
         <option value="es">Spain</option>
       </select>`
    )
    const question = page.questions[0]
    if (!question) throw new Error("fixture missing question")

    // Every option is addressable and resolves to a real browser node, which is
    // what makes a chosen option checkable later.
    expect(question.options.map((option) => option.label)).toEqual([
      "Portugal",
      "Spain",
    ])
    for (const option of question.options) {
      expect(option.ref).not.toBe("")
      expect(page.read.index.resolve(option.ref)).not.toBeNull()
    }
    // Two options are two references, not one shared placeholder.
    expect(question.options[0]?.ref).not.toBe(question.options[1]?.ref)
    // The question still satisfies its own schema with those references in it.
    expect(CandidateQuestionSchema.safeParse(question).success).toBe(true)
    await page.session.detach()
  })

  it("gives a radio group's members references too", async () => {
    const page = await enumerate(
      `<fieldset><legend>Plan</legend>
        <label><input type="radio" name="plan" value="free">Free</label>
        <label><input type="radio" name="plan" value="pro">Pro</label>
      </fieldset>`
    )
    // One question, whose members are its options rather than questions of
    // their own, and each of those options can still be addressed.
    expect(page.questions).toHaveLength(1)
    const question = page.questions[0]
    if (!question) throw new Error("fixture missing question")
    expect(question.options).toHaveLength(2)
    for (const option of question.options) {
      expect(option.ref).not.toBe("")
      expect(page.read.index.resolve(option.ref)).not.toBeNull()
    }
    expect(CandidateQuestionSchema.safeParse(question).success).toBe(true)
    await page.session.detach()
  })

  it("refuses a control that holds more than one selection", async () => {
    const page = await enumerate(
      `<label for="skills">Skills</label>
       <select id="skills" name="skills" multiple>
         <option>TypeScript</option><option>Rust</option>
       </select>
       <label for="name">Name</label><input id="name" name="name">`
    )

    // Refused, not hidden: it stays in the list and in the count, so the gap is
    // visible instead of the question quietly disappearing.
    expect(page.questions).toHaveLength(2)
    expect(page.questions[0]?.kind).toBe("multi_choice")
    expect(page.dispositions.q1).toBe("unsupported")
    expect(page.gaps[0]?.detail).toMatch(/more than one selection/)
    expect(page.gaps[0]?.reason).toBe("unsupported")
    // The single-selection control beside it is unaffected.
    expect(page.dispositions.q2).toBe("unverified")
    await page.session.detach()
  })

  it("refuses a repeated checkbox group, which is also multi-selection", async () => {
    const page = await enumerate(
      `<form><fieldset><legend>Languages</legend>
        <label><input type="checkbox" name="lang" value="en">English</label>
        <label><input type="checkbox" name="lang" value="pt">Portuguese</label>
      </fieldset></form>`
    )

    expect(page.questions).toHaveLength(1)
    expect(page.questions[0]?.kind).toBe("multi_choice")
    expect(page.dispositions.q1).toBe("unsupported")
    expect(page.gaps).toHaveLength(1)
    await page.session.detach()
  })

  it("takes wording from the page and gives an unlabelled question no identity", async () => {
    const page = await enumerate(
      `<form>
        <input name="a" placeholder="First name">
        <input name="b" title="Surname">
        <input name="c">
      </form>`
    )

    expect(page.questions.map((question) => question.text)).toEqual([
      "First name",
      "Surname",
      "[unlabelled short_text]",
    ])
    const labelled = page.questions[0]
    const unlabelled = page.questions[2]
    if (!labelled || !unlabelled) throw new Error("fixture missing question")
    // Wording the page authored is enough to identify the question...
    expect(reusableQuestionKey(labelled)).toHaveLength(16)
    // ...but a question the page never labelled keeps no identity at all, so one
    // saved answer can never attach to two different fields.
    expect(isUnlabelledWording(unlabelled.text)).toBe(true)
    expect(reusableQuestionKey(unlabelled)).toBeNull()
    // It is still a question: kept, counted, and fillable in this run.
    expect(unlabelled.kind).toBe("short_text")
    expect(page.dispositions.q3).toBe("unverified")
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
        <label for="d">Issued</label><input id="d" name="d" readonly value="fixed">
      </form>`
    )

    // Fixed numbers rather than one loop's output compared with itself: a
    // question dropped together with its disposition has to fail something.
    expect(page.questions.map((question) => question.ref)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
    ])
    expect(Object.keys(page.dispositions)).toEqual(["q1", "q2", "q3", "q4"])
    expect(unaccountedQuestions(page.questions, page.dispositions)).toEqual([])
    expect(page.dispositions.q1).toBe("unverified")
    // A disabled control is not something to ask the user about again.
    expect(page.dispositions.q2).toBe("unsupported")
    // Readonly is a reason to leave a value alone, not a reason to call an empty
    // field answered: an empty readonly control is still an open question.
    expect(page.dispositions.q3).toBe("unverified")
    // With a committed value there is something to preserve.
    expect(page.dispositions.q4).toBe("preserved")
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

  it("refuses to match wording on a control whose kind came from a role", async () => {
    const native = await enumerate(
      `<label for="n">First name</label><input id="n" name="n">`
    )
    const nativeQuestion = native.questions[0]
    if (!nativeQuestion) throw new Error("fixture missing question")
    expect(nativeQuestion.controlKind).toBe("text")
    expect(exactLabelMatch(nativeQuestion, ["first name"])).toBe("first name")
    await native.session.detach()

    // The same wording, on a widget this engine classified by reading a role.
    // A match there would rest on our inference about the markup.
    const custom = await enumerate(
      `<div role="combobox" aria-label="First name" aria-haspopup="listbox"></div>`
    )
    const customQuestion = custom.questions[0]
    if (!customQuestion) throw new Error("fixture missing question")
    expect(customQuestion.controlKind).toBe("combobox")
    expect(customQuestion.text).toBe("First name")
    expect(exactLabelMatch(customQuestion, ["first name"])).toBeNull()
    await custom.session.detach()
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

describe("button-based choices, from the capture", () => {
  it("enumerates the Ashby yes/no buttons as questions", async () => {
    // The reduced capture the user took on 2026-09-28, tracked since 5693abd.
    // Read from the file rather than hand-written markup, because the grouping
    // rule for a button choice is read off real markup, not invented.
    const html = readFileSync(
      join(FIXTURES_DIR, "ashby-application.html"),
      "utf8"
    )
    const page = await enumerate(html)

    // One question per field, in document order: the two yes/no pairs are
    // questions whose options are buttons, and the hidden checkbox that carries
    // each answer is not a question of its own.
    expect(page.questions.map((question) => question.controlKind)).toEqual([
      "text",
      "button_choice",
      "button_choice",
    ])
    const choices = page.questions.filter(
      (question) => question.controlKind === "button_choice"
    )
    expect(choices.map((question) => question.text)).toEqual([
      "Are you legally authorized to work in the United States?",
      "Will you now or in the future require visa sponsorship to work in the United States?",
    ])
    expect(choices.map((question) => question.kind)).toEqual([
      "single_choice",
      "single_choice",
    ])
    expect(choices[0]?.options.map((option) => option.label)).toEqual([
      "Yes",
      "No",
    ])
    // A page whose only unanswered question is a button choice cannot be called
    // complete: the question is enumerated here, and nothing has answered it.
    for (const question of choices)
      expect(page.dispositions[question.ref]).toBe("unverified")
    await page.session.detach()
  })
})
