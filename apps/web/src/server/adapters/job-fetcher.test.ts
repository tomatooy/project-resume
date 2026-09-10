import { describe, expect, it } from "vitest"

import { htmlToText } from "./job-fetcher"

describe("htmlToText", () => {
  it("drops the blank space a pretty-printed page leaves behind", () => {
    // The shape that caused the problem: indentation and empty lines between
    // tags come out as whitespace-only lines once the tags are gone.
    const html = `
      <div class="top">
        <div class="inner">

          <span>Software Engineer - Backend</span>

          <span>Realm Alliance</span>
        </div>
      </div>`

    expect(htmlToText(html)).toBe("Software Engineer - Backend\nRealm Alliance")
  })

  it("keeps one line per block, without a blank line between them", () => {
    const html =
      "<div><p>Company Overview</p></div><div><p>Realm builds AI.</p></div>"

    expect(htmlToText(html)).toBe("Company Overview\nRealm builds AI.")
  })

  it("reads a break a posting does mean as a line", () => {
    expect(htmlToText("<li>Ship features</li><li>Own services</li>")).toBe(
      "Ship features\nOwn services"
    )
  })

  it("reads inline tags as word boundaries", () => {
    expect(htmlToText("<span>Software</span><span>Engineer</span>")).toBe(
      "Software Engineer"
    )
  })

  it("takes the contents of a script or a style with it", () => {
    const html =
      "<style>.a{color:red}</style><p>Real text</p><script>var a = 1</script>"

    expect(htmlToText(html)).toBe("Real text")
  })

  it("decodes entities, and reads a non-breaking space as a space", () => {
    expect(htmlToText("<p>R&amp;D&nbsp;team</p>")).toBe("R&D team")
  })
})
