import { describe, expect, it } from "vitest"

import { type Classification, classifyField } from "../src/classify"
import type { AutofillVendor, Control } from "../src/fields"
import { field } from "./helpers"

type Extra = {
  vendor?: AutofillVendor
  id?: string
  autocomplete?: string
  section?: string
}

function classify(
  label: string,
  control: Control,
  extra: Extra = {}
): Classification {
  const { vendor = "greenhouse", id = "question_1", ...rest } = extra
  return classifyField(vendor, field({ id, label, control, ...rest }))
}

const normal = (key: Classification["key"]): Classification => ({
  key,
  zone: "normal",
})
const forbidden: Classification = { key: null, zone: "forbidden" }

describe("classifyField", () => {
  it.each<[string, Control, Extra, Classification]>([
    [
      "First Name",
      "text",
      { autocomplete: "given-name" },
      normal("name.first"),
    ],
    [
      "Will you require Visa Sponsorship now, or in the future?",
      "combobox",
      {},
      normal("workAuth.sponsorship.any"),
    ],
    [
      "Do you currently require visa sponsorship?",
      "combobox",
      {},
      normal("workAuth.sponsorship.now"),
    ],
    [
      "Will you in the future require sponsorship?",
      "combobox",
      {},
      normal("workAuth.sponsorship.future"),
    ],
    [
      "Are you legally authorized to work in the United States?",
      "combobox",
      {},
      normal("workAuth.authorized"),
    ],
    [
      "Your authorization to work in the country where you live",
      "combobox",
      {},
      normal("workAuth.status"),
    ],
    [
      "I acknowledge that I have read the Job Applicant Privacy Notice",
      "combobox",
      {},
      forbidden,
    ],
    [
      "Please double-check all the information provided above. Ensuring accuracy is crucial for your application.",
      "combobox",
      {},
      forbidden,
    ],
    [
      "Do you have a valid driver's license?",
      "combobox",
      {},
      normal("other.driversLicense"),
    ],
    ["Driver's license number", "text", {}, forbidden],
    [
      "Are you willing to undergo a background check?",
      "combobox",
      {},
      normal("other.backgroundCheck"),
    ],
    ["Have you ever been convicted of a felony?", "combobox", {}, forbidden],
    ["Gender", "select", {}, normal(null)],
    [
      "Desired salary",
      "text",
      {},
      { key: "pref.salary", zone: "forbidden", anchor: "preferences" },
    ],
    [
      "Why do you want to work here?",
      "textarea",
      {},
      { key: null, zone: "write" },
    ],
    ["Resume/CV", "file", {}, { key: "resume.file", zone: "resume-file" }],
    ["Cover Letter", "file", {}, { key: null, zone: "other-file" }],
    [
      "LinkedIn (preferred), personal site, or GitHub",
      "text",
      {},
      normal("links.combined"),
    ],
    ["How did you find us?", "text", {}, normal("source.how-heard")],
    ["Years of experience", "number", {}, normal("resume.years")],
    [
      "How many years of experience do you have with Kubernetes?",
      "text",
      {},
      normal(null),
    ],
    [
      "Gender",
      "combobox",
      { vendor: "greenhouse", id: "gender" },
      normal(null),
    ],
    [
      "Name",
      "text",
      { vendor: "ashby", id: "_systemfield_name" },
      normal("name.full"),
    ],
  ])(
    "classifies the label table: %s (%s)",
    (label, control, extra, expected) => {
      expect(classify(label, control, extra)).toEqual(expected)
    }
  )

  it("reads vendor ids before the label", () => {
    expect([
      classify("Phone", "tel", { id: "phone" }),
      classify("Country", "combobox", { id: "country" }),
      classify("Location (City)", "combobox", { id: "candidate-location" }),
      classify("Attach", "file", { id: "resume" }),
      classify("Field", "text", { vendor: "ashby", id: "first_name" }),
    ]).toEqual([
      normal("contact.phone.national"),
      normal("contact.phone.country"),
      normal("address.city"),
      { key: "resume.file", zone: "resume-file" },
      normal(null),
    ])
  })

  it("checks forbidden words before autocomplete tokens", () => {
    expect(classify("Signature", "text", { autocomplete: "name" })).toEqual(
      forbidden
    )
  })

  it("classifies file inputs by the resume words alone", () => {
    expect([
      classify("Valid driver's license (front and back)", "file"),
      classify("Résumé", "file"),
    ]).toEqual([
      { key: null, zone: "other-file" },
      { key: "resume.file", zone: "resume-file" },
    ])
  })

  it("keeps open textareas out of the label dictionary", () => {
    expect(
      classify("Are you open to relocation? Tell us where.", "textarea")
    ).toEqual({ key: null, zone: "write" })
  })

  it("reads a sponsorship question with no time as any time", () => {
    expect(classify("Will you require visa sponsorship?", "combobox")).toEqual(
      normal("workAuth.sponsorship.any")
    )
  })

  it("leaves reversed and non-US work questions to AI", () => {
    const labels = [
      "Are you legally authorized to work in the United States without sponsorship?",
      "Will you require visa sponsorship to work in the UK?",
      "Are you eligible to work in Canada?",
      "Have you ever failed a background check?",
      "Are you under 18 years of age?",
    ]
    expect(labels.map((label) => classify(label, "combobox"))).toEqual(
      labels.map(() => normal(null))
    )
  })

  it("reads how-heard phrases but not open source", () => {
    expect([
      classify("Where did you first hear about this role?", "combobox"),
      classify("Source", "select"),
      classify("Have you contributed to open source?", "combobox"),
    ]).toEqual([
      normal("source.how-heard"),
      normal("source.how-heard"),
      normal(null),
    ])
  })

  it.each([
    "Voluntary Self-Identification",
    "Equal Employment Opportunity",
    "EEO",
    "Demographics",
    "Veteran status",
  ])("uses ordinary field classification inside %s", (section) => {
    expect([
      classify("Please select", "select", { section }),
      classify("Languages", "checkboxes", { section }),
      classify("I consent to data processing", "checkbox", { section }),
    ]).toEqual([normal(null), normal("other.languages"), forbidden])
  })

  it.each([
    "Race",
    "Ethnicity",
    "Hispanic or Latino",
    "Sexual orientation",
    "Gender",
    "Transgender",
    "Veteran status",
    "Disability status",
  ])("leaves %s to ordinary choice inference", (label) => {
    expect(classify(label, "select")).toEqual(normal(null))
  })

  it.each<[AutofillVendor, string]>([
    ["greenhouse", "gender"],
    ["greenhouse", "hispanic_ethnicity"],
    ["greenhouse", "race"],
    ["greenhouse", "veteran_status"],
    ["greenhouse", "disability_status"],
    ["ashby", "_systemfield_eeoc_gender"],
    ["ashby", "_systemfield_eeoc_race"],
    ["ashby", "_systemfield_eeoc_veteran_status"],
    ["ashby", "_systemfield_eeoc_disability_status"],
  ])("treats %s %s as an ordinary field", (vendor, id) => {
    expect(classify("Please select one", "select", { vendor, id })).toEqual(
      normal(null)
    )
  })

  it("matches plural and past forms of forbidden words", () => {
    expect([
      classify("What are your pay expectations?", "text"),
      classify("Have you ever been arrested?", "combobox"),
      classify("Do you have any family members working here?", "combobox"),
    ]).toEqual([
      { key: "pref.salary", zone: "forbidden", anchor: "preferences" },
      forbidden,
      forbidden,
    ])
  })

  it("reads single links, other answers and plain labels", () => {
    const cases: [string, Control, Classification["key"]][] = [
      ["LinkedIn Profile", "text", "links.linkedin"],
      ["Twitter", "text", "links.twitter"],
      ["Github", "text", "links.github"],
      ["Website", "text", "links.website"],
      ["Are you 18 years of age or older?", "checkbox", "other.adult"],
      ["Open to relocation?", "select", "pref.relocation"],
      ["Work mode", "radio", "pref.workMode"],
      ["Languages", "checkboxes", "other.languages"],
      ["What is your email address?", "email", "contact.email"],
      ["Current company", "text", "resume.company"],
      ["Earliest start date", "date", "pref.start"],
      ["Nickname", "text", "name.preferred"],
      ["Start date", "text", null],
    ]
    expect(cases.map(([label, control]) => classify(label, control))).toEqual(
      cases.map(([, , key]) => normal(key))
    )
  })

  it("ignores ids and tokens that name object properties", () => {
    expect(
      classify("Field", "text", { id: "constructor", autocomplete: "toString" })
    ).toEqual(normal(null))
  })
})
