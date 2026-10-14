import { InterpretationCache } from "@workspace/resume-core/dom-agent"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fillCurrentPage } from "../src/dom-agent/run-page"
import { type PageTransport, attachPage } from "./helpers/cdp-page"
import { BUNDLE_TEXT, bundle, fact, writingPage } from "./helpers/writing-page"

/**
 * The deterministic path end to end, with no model anywhere in it: a page is
 * observed, its questions enumerated, the ones a fact already matches are
 * written through the page runtime, and the run reports what the page
 * confirmed.
 *
 * The page double composes the two halves a page offers: the scripted reading
 * transport, and a runtime installed in the page the way `install()` installs
 * it, once per document. It lives in `helpers/writing-page.ts` because the
 * performance harness needs the same double, and a copy would be a second
 * write path to keep in step with the runtime.
 */

function fieldValue(id: string): string | undefined {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.value
}

/**
 * Drive one pass over a page. The transport is injectable because the
 * performance harness needs the same page with its reads counted, and the cache
 * is injectable because passing one across two calls is how the warm case is
 * tested: the second pass has to reuse an interpretation rather than read the
 * question again.
 */
async function fill(
  html: string,
  facts: ReturnType<typeof fact>[],
  options?: {
    cache?: InterpretationCache
    questionRevision?: number
    transport?: PageTransport
  }
) {
  const { session } = await attachPage({
    tabId: 11,
    runId: "run-1",
    transport: options?.transport ?? writingPage(html).page,
  })
  const result = await fillCurrentPage({
    session,
    bundle: bundle(facts),
    loadBundle: async () => BUNDLE_TEXT,
    cache: options?.cache,
    questionRevision: options?.questionRevision,
  })
  return { result, session }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("filling a page with no model", () => {
  const FORM = `<form>
    <label for="email">Email address</label><input id="email" type="text">
    <label for="city">City</label><input id="city" type="text">
  </form>`

  it("writes what a fact already says and reports what the page confirmed", async () => {
    const { result, session } = await fill(FORM, [
      fact("email address", "ada@example.com"),
      fact("city", "Lisbon"),
    ])

    expect(result.progress).toEqual({
      accepted: 2,
      unresolved: 0,
      failed: 0,
      dispatched: 2,
    })
    expect(Object.values(result.dispositions)).toEqual(["answered", "answered"])
    expect(result.review).toEqual([])
    expect(result.state).toBe("auditing")
    expect(fieldValue("email")).toBe("ada@example.com")
    expect(fieldValue("city")).toBe("Lisbon")
    await session.detach()
  })

  it("counts only confirmed writes, never dispatched ones", async () => {
    // The application id is readonly and empty, so the reader treats it as a
    // question nobody answered and the page refuses the write on its own.
    const { result, session } = await fill(
      `<form>
        <label for="email">Email address</label><input id="email" type="text">
        <label for="app">Application id</label>
        <input id="app" type="text" readonly>
      </form>`,
      [fact("email address", "ada@example.com"), fact("application id", "4821")]
    )

    expect(result.progress.dispatched).toBe(2)
    expect(result.progress.accepted).toBe(1)
    expect(result.progress.failed).toBe(1)
    expect(fieldValue("app")).not.toBe("4821")
    expect(fieldValue("email")).toBe("ada@example.com")
    // The one that came back is still a question for the user.
    expect(result.review).toHaveLength(1)
    expect(result.review[0]?.reason).toBe("write_failed")
    expect(result.review[0]?.text).toBe("Application id")
    expect(result.state).toBe("needs_input")
    await session.detach()
  })

  it("keeps an unanswered question in the queue with the page's wording", async () => {
    const { result, session } = await fill(
      `<form>
        <label for="email">Email address</label><input id="email" type="text">
        <label for="why">Why do you want to work here?</label>
        <textarea id="why"></textarea>
      </form>`,
      [fact("email address", "ada@example.com")]
    )

    expect(result.progress.accepted).toBe(1)
    expect(result.review).toHaveLength(1)
    expect(result.review[0]?.text).toBe("Why do you want to work here?")
    expect(result.review[0]?.reason).toBe("no_matching_fact")
    expect(result.review[0]?.blocking).toBe(true)
    // Nothing was written into a field nobody had an answer for.
    expect(document.querySelector<HTMLTextAreaElement>("#why")?.value).toBe("")
    await session.detach()
  })

  it("fills a twenty-field form in one interpretation pass and reuses it", async () => {
    const fields = Array.from({ length: 20 }, (_, index) => ({
      id: `f${index}`,
      label: `Field number ${index}`,
      value: `value ${index}`,
    }))
    const html = `<form>${fields
      .map(
        (field) =>
          `<label for="${field.id}">${field.label}</label><input id="${field.id}" type="text">`
      )
      .join("")}</form>`
    const facts = fields.map((field) =>
      fact(field.label.toLowerCase(), field.value)
    )
    const cache = new InterpretationCache()

    const form = writingPage(html)
    const first = await fill(html, facts, { cache, transport: form.page })
    expect(first.result.progress.accepted).toBe(20)
    expect(first.result.interpreted.interpreted).toHaveLength(20)
    expect(first.result.interpreted.reused).toEqual([])
    for (const field of fields) expect(fieldValue(field.id)).toBe(field.value)
    await first.session.detach()

    // The same page again, as it now stands: the questions are read once, not
    // once per control.
    form.reread()
    const second = await fill(html, facts, {
      cache,
      questionRevision: 2,
      transport: form.page,
    })
    expect(second.result.interpreted.reused).toHaveLength(20)
    expect(second.result.interpreted.interpreted).toEqual([])
    expect(second.result.progress.accepted).toBe(20)
    expect(second.result.review).toEqual([])
    await second.session.detach()
  })

  it("refuses a second write at a revision the page already wrote", async () => {
    const fields = [
      { id: "email", label: "Email address", value: "ada@example.com" },
    ]
    const html = `<form><label for="email">Email address</label><input id="email" type="text"></form>`
    const facts = fields.map((field) =>
      fact(field.label.toLowerCase(), field.value)
    )
    const form = writingPage(html)

    const first = await fill(html, facts, { transport: form.page })
    expect(first.result.progress.accepted).toBe(1)
    await first.session.detach()

    // A second pass that states the same revision is a replay, and the page
    // refuses it even though the control now holds the value it was asked for.
    // Advancing the revision is the coordinator's job.
    form.reread()
    const replay = await fill(html, facts, { transport: form.page })
    expect(replay.result.progress.accepted).toBe(0)
    expect(replay.result.progress.dispatched).toBe(1)
    expect(replay.result.receipts[0]?.evidence).toContain(
      "stale_question_revision"
    )
    expect(fieldValue("email")).toBe("ada@example.com")
    await replay.session.detach()
  })
})
