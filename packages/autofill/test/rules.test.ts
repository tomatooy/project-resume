import type { Item, Resume } from "@workspace/resume-schema"
import { fid, minimal, onePage } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import { eeoFill } from "../src/eeo"
import type {
  CanonicalKey,
  Control,
  FieldClass,
  FieldDescriptor,
  Fill,
  Option,
  Route,
} from "../src/fields"
import {
  ashbyFields,
  greenhouseNewFields,
  sampleProfile,
} from "../src/fixtures"
import type { Profile } from "../src/profile"
import { type RuleContext, ruleFills } from "../src/rules"
import { field } from "./helpers"

const today = new Date(2026, 9, 18)

function context(over: Partial<RuleContext> = {}): RuleContext {
  return {
    vendor: "greenhouse",
    profile: sampleProfile,
    resume: onePage,
    linkedin: false,
    today,
    ...over,
  }
}

type ProfilePatch = { [S in keyof Profile]?: Partial<Profile[S]> }

/** The sample Profile with some answers changed. */
function withProfile(patch: ProfilePatch): Profile {
  return {
    personal: { ...sampleProfile.personal, ...patch.personal },
    contact: { ...sampleProfile.contact, ...patch.contact },
    links: { ...sampleProfile.links, ...patch.links },
    workAuth: { ...sampleProfile.workAuth, ...patch.workAuth },
    preferences: { ...sampleProfile.preferences, ...patch.preferences },
    eeo: { ...sampleProfile.eeo, ...patch.eeo },
    other: { ...sampleProfile.other, ...patch.other },
  }
}

const withAnswers = (patch: ProfilePatch): RuleContext =>
  context({ profile: withProfile(patch) })

/** Text fill values by field id. */
function textOf(fills: Fill[]): Record<string, string> {
  return Object.fromEntries(
    fills.flatMap((fill) =>
      fill.kind === "text" ? [[fill.fieldId, fill.value]] : []
    )
  )
}

function routeOf(classes: FieldClass[], id: string): Route | undefined {
  return classes.find((entry) => entry.fieldId === id)?.route
}

function fixture(fields: FieldDescriptor[], id: string): FieldDescriptor {
  const found = fields.find((entry) => entry.id === id)
  if (!found) throw new Error(`No fixture field ${id}`)
  return found
}

/** Options with positional ids, as the scan sends them. */
function options(...labels: string[]): Option[] {
  return labels.map((label, i) => ({ id: `#${i + 1}`, label }))
}

/** The rule fill and route of a single field. */
function one(
  input: FieldDescriptor,
  ctx: RuleContext = context()
): { fill: Fill | null; route: Route | undefined } {
  const { fills, classes } = ruleFills([input], ctx)
  return { fill: fills[0] ?? null, route: routeOf(classes, input.id) }
}

const text = (fieldId: string, value: string): Fill => ({
  kind: "text",
  fieldId,
  source: "rule",
  value,
})

const picked = (
  fieldId: string,
  optionIds: string[],
  labels: string[]
): Fill => ({ kind: "options", fieldId, source: "rule", optionIds, labels })

const search = (fieldId: string, query: string, target: string): Fill => ({
  kind: "search",
  fieldId,
  source: "rule",
  query,
  target,
})

const check = (fieldId: string, checked: boolean): Fill => ({
  kind: "check",
  fieldId,
  source: "rule",
  checked,
})

const RACES = [
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Native Hawaiian or Other Pacific Islander",
  "White",
  "Two or More Races",
  "Decline To Self Identify",
]

describe("ruleFills", () => {
  it("fills the Greenhouse standard fields and links (GH 10.10)", () => {
    const { fills, classes } = ruleFills(greenhouseNewFields, context())
    expect(textOf(fills)).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone: "(415) 555-0100",
      question_12521592004: "https://www.linkedin.com/in/ada",
      question_12521594004: "https://github.com/ada",
      question_12521595004: "https://ada.dev",
    })
    expect(routeOf(classes, "question_12521593004")).toBe("skip")
  })

  it("routes every Greenhouse field", () => {
    const { classes } = ruleFills(greenhouseNewFields, context())
    expect(classes.map((entry) => [entry.fieldId, entry.route])).toEqual([
      ["first_name", "rule"],
      ["last_name", "rule"],
      ["email", "rule"],
      ["country", "pending"],
      ["phone", "rule"],
      ["candidate-location", "rule"],
      ["resume", "rule"],
      ["question_12521589004", "ai"],
      ["question_12521590004", "pending"],
      ["question_14151266004", "ai"],
      ["question_12550683004", "ai"],
      ["question_12521592004", "rule"],
      ["question_12521593004", "skip"],
      ["question_12521594004", "rule"],
      ["question_12521595004", "rule"],
      ["question_12521596004", "page"],
      ["question_12521597004", "page"],
      ["question_17702872004", "ai"],
    ])
  })

  it("sends the two attestations to the page (GH 10.6)", () => {
    const { classes } = ruleFills(greenhouseNewFields, context())
    const ids = ["question_12521596004", "question_12521597004"]
    expect(classes.filter((entry) => ids.includes(entry.fieldId))).toEqual(
      ids.map((fieldId) => ({
        fieldId,
        key: null,
        zone: "forbidden",
        route: "page",
      }))
    )
  })

  it("picks the phone country once options are known", () => {
    const country = fixture(greenhouseNewFields, "country")
    expect(one(country)).toEqual({ fill: null, route: "pending" })
    expect(
      one({ ...country, options: options("United States", "United Kingdom") })
    ).toEqual({
      fill: picked("country", ["#1"], ["United States"]),
      route: "rule",
    })
  })

  it("leaves the phone country open for numbers outside +1", () => {
    const country = {
      ...fixture(greenhouseNewFields, "country"),
      options: options("United States", "United Kingdom"),
    }
    expect(
      one(country, withAnswers({ contact: { phone: "+447911123456" } }))
    ).toEqual({ fill: null, route: "ai" })
  })

  it("searches the location", () => {
    const { fills } = ruleFills(greenhouseNewFields, context())
    expect(fills).toContainEqual(
      search("candidate-location", "San Francisco", "San Francisco, CA")
    )
  })

  type Answer = Profile["workAuth"]["sponsorshipNow"]
  it.each<[Answer, Answer, string | null]>([
    ["no", "no", "No"],
    ["yes", "no", "Yes"],
    ["no", "yes", "Yes"],
    [null, "no", null],
    ["yes", null, "Yes"],
    [null, "yes", "Yes"],
    [null, null, null],
  ])(
    "answers the combined sponsorship question (now %s, future %s)",
    (now, future, answer) => {
      const question = {
        ...fixture(greenhouseNewFields, "question_12521590004"),
        options: options("Yes", "No"),
      }
      const ctx = withAnswers({
        workAuth: { sponsorshipNow: now, sponsorshipFuture: future },
      })
      expect(one(question, ctx)).toEqual(
        answer === null
          ? { fill: null, route: "ai" }
          : {
              fill: picked(
                question.id,
                [answer === "Yes" ? "#1" : "#2"],
                [answer]
              ),
              route: "rule",
            }
      )
    }
  )

  it("attaches the resume, with or without resume facts", () => {
    for (const resume of [onePage, null]) {
      const { fills, classes } = ruleFills(
        greenhouseNewFields,
        context({ resume })
      )
      expect(fills).toContainEqual({
        kind: "resume-file",
        fieldId: "resume",
        source: "rule",
      })
      expect(routeOf(classes, "resume")).toBe("rule")
    }
  })

  it("sends other files to the page", () => {
    const letter = field({
      id: "cover_letter",
      label: "Cover Letter",
      control: "file",
    })
    expect(one(letter)).toEqual({ fill: null, route: "page" })
  })

  it("leaves written answers to Write with AI", () => {
    const why = field({
      id: "q",
      label: "Why do you want to work here?",
      control: "textarea",
    })
    expect(one(why)).toEqual({ fill: null, route: "write" })
  })

  it("fills the Ashby fields (Ashby 11.4, 11.5)", () => {
    const { fills, classes } = ruleFills(
      ashbyFields,
      context({ vendor: "ashby" })
    )
    expect(textOf(fills)).toEqual({
      _systemfield_name: "Ada Lovelace",
      _systemfield_email: "ada@example.com",
      question_11916356008: "https://www.linkedin.com/in/ada",
    })
    expect(fills).toContainEqual({
      kind: "resume-file",
      fieldId: "_systemfield_resume",
      source: "rule",
    })
    expect(routeOf(classes, "question_11916361008")).toBe("ai")

    const fromLinkedIn = ruleFills(
      ashbyFields,
      context({ vendor: "ashby", linkedin: true })
    )
    expect(textOf(fromLinkedIn.fills).question_11916361008).toBe("LinkedIn")
    expect(routeOf(fromLinkedIn.classes, "question_11916361008")).toBe("rule")
  })

  it("routes every Ashby field", () => {
    const { classes } = ruleFills(ashbyFields, context({ vendor: "ashby" }))
    expect(classes.map((entry) => [entry.fieldId, entry.route])).toEqual([
      ["_systemfield_name", "rule"],
      ["_systemfield_email", "rule"],
      ["_systemfield_resume", "rule"],
      ["question_11916356008", "rule"],
      ["question_11916357008", "ai"],
      ["question_11916358008", "ai"],
      ["question_11916361008", "ai"],
    ])
  })

  it("fills the Ashby location", () => {
    const ashby = context({ vendor: "ashby" })
    const location = field({ id: "_systemfield_location", label: "Location" })
    expect(one(location, ashby).fill).toEqual(
      text("_systemfield_location", "San Francisco, CA")
    )
    const place = search(
      "_systemfield_location",
      "San Francisco, CA",
      "San Francisco, CA"
    )
    expect(
      one({ ...location, control: "combobox", searchable: true }, ashby).fill
    ).toEqual(place)
    expect(one({ ...location, control: "combobox" }, ashby).fill).toEqual(place)
  })

  it("writes the city alone without a state, and no location without a city", () => {
    const location = field({ id: "_systemfield_location", label: "Location" })
    const noState = context({
      vendor: "ashby",
      profile: withProfile({ contact: { state: "" } }),
    })
    expect(one(location, noState).fill).toEqual(
      text("_systemfield_location", "San Francisco")
    )
    const noCity = context({
      vendor: "ashby",
      profile: withProfile({ contact: { city: "" } }),
      resume: null,
    })
    expect(one(location, noCity)).toEqual({ fill: null, route: "ai" })
  })

  it("leaves the single-line open question to AI (Ashby 9.1)", () => {
    const { classes } = ruleFills(ashbyFields, context({ vendor: "ashby" }))
    expect(routeOf(classes, "question_11916358008")).toBe("ai")
  })

  it("never truncates to fit maxLength", () => {
    const phone = fixture(greenhouseNewFields, "phone")
    expect(one({ ...phone, maxLength: 10 })).toEqual({
      fill: text("phone", "4155550100"),
      route: "rule",
    })
    expect(one({ ...phone, maxLength: 8 })).toEqual({ fill: null, route: "ai" })
    const email = fixture(greenhouseNewFields, "email")
    expect(one({ ...email, maxLength: 10 })).toEqual({
      fill: null,
      route: "ai",
    })
  })

  it("never writes a value the fill schema would reject", () => {
    const location = field({
      id: "q",
      label: "Location",
      control: "combobox",
      searchable: true,
    })
    const longCity = withAnswers({ contact: { city: "S".repeat(200) } })
    expect(one(location, longCity)).toEqual({ fill: null, route: "ai" })

    // Two full groups of 50 skills join to more than 4,000 characters.
    const manySkills: Resume = {
      ...minimal,
      sections: [
        {
          id: fid("sec", "skl"),
          type: "skills",
          title: "Skills",
          items: [0, 1].map(
            (group): Item => ({
              id: fid("skl", `group${group}`),
              kind: "skills",
              label: `Group ${group}`,
              skills: Array.from(
                { length: 50 },
                (_, i) => `skill ${group}-${i} ${"x".repeat(40)}`
              ),
            })
          ),
        },
      ],
    }
    expect(
      one(field({ id: "q", label: "Skills" }), context({ resume: manySkills }))
    ).toEqual({ fill: null, route: "ai" })
  })

  it("lists fields that already had a value as overwrites", () => {
    const first = {
      ...fixture(greenhouseNewFields, "first_name"),
      hasValue: true,
    }
    const oauth = {
      ...fixture(greenhouseNewFields, "question_12550683004"),
      hasValue: true,
    }
    expect(ruleFills([first, oauth], context())).toEqual({
      fills: [],
      overwrites: [text("first_name", "Ada")],
      classes: [
        {
          fieldId: "first_name",
          key: "name.first",
          zone: "normal",
          route: "filled",
        },
        {
          fieldId: "question_12550683004",
          key: null,
          zone: "normal",
          route: "filled",
        },
      ],
    })
  })

  it("checks a checkbox from a yes answer", () => {
    const adult = field({
      id: "q_adult",
      label: "Are you 18 years of age or older?",
      control: "checkbox",
    })
    expect(one(adult, withAnswers({ other: { adult: "yes" } }))).toEqual({
      fill: check("q_adult", true),
      route: "rule",
    })
  })

  it("maps EEO answers through the synonym tables", () => {
    const gender = field({
      id: "gender",
      label: "Gender",
      control: "select",
      options: options("Male", "Female", "Decline To Self Identify"),
    })
    expect(one(gender)).toEqual({
      fill: picked("gender", ["#3"], ["Decline To Self Identify"]),
      route: "rule",
    })

    const race = field({
      id: "race",
      label: "Race",
      control: "select",
      options: options(...RACES),
    })
    const races = withAnswers({ eeo: { race: ["asian", "white"] } })
    expect(one(race, races)).toEqual({
      fill: picked("race", ["#6"], ["Two or More Races"]),
      route: "rule",
    })
    const noTwo = {
      ...race,
      options: options(
        ...RACES.filter((label) => label !== "Two or More Races")
      ),
    }
    expect(one(noTwo, races)).toEqual({ fill: null, route: "page" })
  })

  it("keeps the Profile section of EEO and salary fields", () => {
    const race = field({
      id: "race",
      label: "Race",
      control: "select",
      options: options(...RACES),
    })
    const salary = field({ id: "q_salary", label: "Desired salary" })
    expect(ruleFills([race, salary], context()).classes).toEqual([
      {
        fieldId: "race",
        key: "eeo.race",
        zone: "forbidden",
        anchor: "eeo",
        route: "rule",
      },
      {
        fieldId: "q_salary",
        key: "pref.salary",
        zone: "forbidden",
        anchor: "preferences",
        route: "page",
      },
    ])
  })

  it("waits for the options of an EEO question", () => {
    const veteran = field({
      id: "veteran_status",
      label: "Veteran status",
      control: "combobox",
      optionsPending: true,
    })
    expect(one(veteran)).toEqual({ fill: null, route: "pending" })
  })

  it("fills salary from the Profile only", () => {
    const salary = field({ id: "q_salary", label: "Desired salary" })
    const ctx = withAnswers({
      preferences: { salaryMin: 150000, salaryMax: 180000 },
    })
    expect(one(salary, ctx).fill).toEqual(
      text("q_salary", "$150,000 - $180,000 per year")
    )
    expect(one({ ...salary, control: "number" }, ctx).fill).toEqual(
      text("q_salary", "150000")
    )
    const ranges: FieldDescriptor = {
      ...salary,
      control: "select",
      options: options(
        "Less than $100,000",
        "$100,000 - $160,000",
        "$160,000+"
      ),
    }
    expect(one(ranges, ctx).fill).toEqual(
      picked("q_salary", ["#2"], ["$100,000 - $160,000"])
    )
  })

  const f = (
    label: string,
    control: Control = "text",
    extra: Partial<FieldDescriptor> = {}
  ): FieldDescriptor => field({ id: "q", label, control, ...extra })
  const choose = (labels: string[], ...ids: number[]): Fill =>
    picked(
      "q",
      ids.map((i) => `#${i}`),
      ids.map((i) => labels[i - 1] ?? "")
    )
  const states = ["California", "Oregon"]
  const countries = ["Canada", "United States of America"]
  const statuses = ["U.S. Citizen", "Green Card Holder", "H-1B"]
  const modes = ["On-site", "Hybrid", "Remote"]
  const languages = ["English", "French", "Spanish"]
  const yesNo = ["Yes", "No"]
  const yearRanges = ["0-2 years", "3-5 years", "6+ years"]
  const sources = ["Indeed", "LinkedIn", "Referral"]
  const offices = [
    "New York, New York, United States",
    "San Francisco, California, United States",
  ]
  it.each<[string, FieldDescriptor, RuleContext, Fill | null, Route]>([
    [
      "a full name",
      f("Full name"),
      context(),
      text("q", "Ada Lovelace"),
      "rule",
    ],
    [
      "pronouns",
      f("Pronouns"),
      withAnswers({ personal: { pronouns: "they/them" } }),
      text("q", "they/them"),
      "rule",
    ],
    [
      "custom pronouns",
      f("Pronouns"),
      withAnswers({
        personal: { pronouns: "custom", pronounsCustom: "xe/xem" },
      }),
      text("q", "xe/xem"),
      "rule",
    ],
    [
      "an international phone as given",
      f("Phone", "tel"),
      withAnswers({ contact: { phone: "+447911123456" } }),
      text("q", "+447911123456"),
      "rule",
    ],
    [
      "a phone on a number control as digits",
      f("Phone number", "number"),
      context(),
      text("q", "4155550100"),
      "rule",
    ],
    ["a state code as text", f("State"), context(), text("q", "CA"), "rule"],
    [
      "a state by name",
      f("State", "select", { options: options(...states) }),
      context(),
      choose(states, 1),
      "rule",
    ],
    [
      "a state option that starts with the name",
      f("State", "select", {
        options: options("California (Pacific Time)", "Oregon (Pacific Time)"),
      }),
      context(),
      choose(["California (Pacific Time)", "Oregon (Pacific Time)"], 1),
      "rule",
    ],
    [
      "a state search by name",
      f("State", "combobox", { searchable: true }),
      context(),
      search("q", "California", "California"),
      "rule",
    ],
    [
      "the country",
      f("Country", "select", { options: options(...countries) }),
      context(),
      choose(countries, 2),
      "rule",
    ],
    [
      "the country by another name",
      f("Country", "select", { options: options("Canada", "USA") }),
      context(),
      choose(["Canada", "USA"], 2),
      "rule",
    ],
    ["the zip code", f("Zip code"), context(), text("q", "94103"), "rule"],
    [
      "the city as text",
      f("City"),
      context(),
      text("q", "San Francisco"),
      "rule",
    ],
    [
      "a city search",
      f("City", "combobox", { searchable: true }),
      context(),
      search("q", "San Francisco", "San Francisco, CA"),
      "rule",
    ],
    [
      "a location option written another way",
      f("Location", "select", { options: options(...offices) }),
      context(),
      choose(offices, 2),
      "rule",
    ],
    [
      "the portfolio when there is no website",
      f("Website"),
      withAnswers({ links: { website: "", portfolio: "https://ada.design" } }),
      text("q", "https://ada.design"),
      "rule",
    ],
    [
      "a Twitter link labeled X",
      f("Twitter"),
      withAnswers({
        links: { other: [{ label: "X", url: "https://x.com/ada" }] },
      }),
      text("q", "https://x.com/ada"),
      "rule",
    ],
    [
      "the preferred link first",
      f("GitHub or LinkedIn (preferred)"),
      context(),
      text("q", "https://www.linkedin.com/in/ada"),
      "rule",
    ],
    [
      "links in the order the label names them",
      f("GitHub or LinkedIn"),
      context(),
      text("q", "https://github.com/ada"),
      "rule",
    ],
    [
      "the next named link when the preferred one is empty",
      f("LinkedIn (preferred), personal site, or GitHub"),
      withAnswers({ links: { linkedin: "" } }),
      text("q", "https://ada.dev"),
      "rule",
    ],
    [
      "a link the label prefers before naming it",
      f("LinkedIn, or preferably GitHub"),
      context(),
      text("q", "https://github.com/ada"),
      "rule",
    ],
    [
      "the label's order after the preferred link",
      f("Website, LinkedIn (preferred), GitHub"),
      withAnswers({ links: { linkedin: "" } }),
      text("q", "https://ada.dev"),
      "rule",
    ],
    [
      "a yes on a select",
      f("Are you legally authorized to work in the United States?", "select", {
        options: options(...yesNo),
      }),
      context(),
      choose(yesNo, 1),
      "rule",
    ],
    [
      "a yes as text",
      f("Are you legally authorized to work in the United States?"),
      context(),
      text("q", "Yes"),
      "rule",
    ],
    [
      "a work status through its synonyms",
      f("Work authorization status", "select", {
        options: options(...statuses),
      }),
      withAnswers({ workAuth: { status: "permanent-resident" } }),
      choose(statuses, 2),
      "rule",
    ],
    [
      "a work status as text",
      f("Work authorization status"),
      withAnswers({ workAuth: { status: "citizen" } }),
      text("q", "U.S. citizen"),
      "rule",
    ],
    [
      "an expiry on a date control",
      f("Visa expiration date", "date"),
      withAnswers({ workAuth: { expiry: "2028-05-31" } }),
      text("q", "2028-05-31"),
      "rule",
    ],
    [
      "an expiry as text",
      f("Visa expiration date"),
      withAnswers({ workAuth: { expiry: "2028-05-31" } }),
      text("q", "May 31, 2028"),
      "rule",
    ],
    [
      "a start date as text",
      f("Earliest start date"),
      withAnswers({
        preferences: { startKind: "date", startDate: "2027-03-01" },
      }),
      text("q", "March 1, 2027"),
      "rule",
    ],
    [
      "a notice period on a date control",
      f("Earliest start date", "date"),
      withAnswers({ preferences: { startKind: "notice", noticeWeeks: 2 } }),
      text("q", "2026-11-01"),
      "rule",
    ],
    [
      "work modes as text",
      f("Work mode"),
      withAnswers({ preferences: { workModes: ["remote", "hybrid"] } }),
      text("q", "Remote, Hybrid"),
      "rule",
    ],
    [
      "the first work mode on a single choice",
      f("Work mode", "radio", { options: options(...modes) }),
      withAnswers({ preferences: { workModes: ["hybrid", "remote"] } }),
      choose(modes, 2),
      "rule",
    ],
    [
      "each work mode on checkboxes",
      f("Work mode", "checkboxes", { options: options(...modes) }),
      withAnswers({ preferences: { workModes: ["remote", "onsite"] } }),
      choose(modes, 3, 1),
      "rule",
    ],
    [
      "relocation",
      f("Are you open to relocation?", "select", {
        options: options(...yesNo),
      }),
      withAnswers({ preferences: { relocation: "no" } }),
      choose(yesNo, 2),
      "rule",
    ],
    [
      "preferred cities",
      f("Preferred locations"),
      withAnswers({ preferences: { cities: ["New York", "Austin"] } }),
      text("q", "New York, Austin"),
      "rule",
    ],
    [
      "each city once on checkboxes",
      f("Preferred locations", "checkboxes", {
        options: options("New York City", "Austin"),
      }),
      withAnswers({ preferences: { cities: ["New York", "New York City"] } }),
      choose(["New York City", "Austin"], 1),
      "rule",
    ],
    [
      "languages as text",
      f("Languages"),
      withAnswers({
        other: {
          languages: [
            { language: "English", level: "native" },
            { language: "Spanish", level: "professional" },
          ],
        },
      }),
      text("q", "English (native), Spanish (professional)"),
      "rule",
    ],
    [
      "each language on checkboxes",
      f("Languages", "checkboxes", { options: options(...languages) }),
      withAnswers({
        other: {
          languages: [
            { language: "English", level: "native" },
            { language: "Spanish", level: "basic" },
          ],
        },
      }),
      choose(languages, 1, 3),
      "rule",
    ],
    [
      "a no on a checkbox",
      f("Do you have a valid driver's license?", "checkbox"),
      withAnswers({ other: { driversLicense: "no" } }),
      check("q", false),
      "rule",
    ],
    [
      "the current company",
      f("Current company"),
      context(),
      text("q", "Vipps MobilePay"),
      "rule",
    ],
    [
      "the current title",
      f("Current job title"),
      context(),
      text("q", "Senior Backend Engineer"),
      "rule",
    ],
    [
      "a school search",
      f("School", "combobox", { searchable: true }),
      context(),
      search("q", "NTNU", "NTNU"),
      "rule",
    ],
    ["the degree", f("Degree"), context(), text("q", "MSc"), "rule"],
    [
      "the major",
      f("Field of study"),
      context(),
      text("q", "Computer Science"),
      "rule",
    ],
    [
      "a graduation month",
      f("Graduation date"),
      context(),
      text("q", "June 2019"),
      "rule",
    ],
    [
      "a graduation year",
      f("Graduation year"),
      context(),
      text("q", "2019"),
      "rule",
    ],
    [
      "no graduation day on a date control",
      f("Graduation date", "date"),
      context(),
      null,
      "ai",
    ],
    [
      "years as a number",
      f("Years of experience", "number"),
      context(),
      text("q", "7"),
      "rule",
    ],
    [
      "years by range",
      f("Years of experience", "select", { options: options(...yearRanges) }),
      context(),
      choose(yearRanges, 3),
      "rule",
    ],
    [
      "the skills",
      f("Skills"),
      context(),
      text(
        "q",
        "Go, TypeScript, SQL, Kotlin, Postgres, Kafka, Kubernetes, Terraform, OpenTelemetry"
      ),
      "rule",
    ],
    [
      "LinkedIn on a closed field",
      f("How did you hear about us?", "select", {
        options: options(...sources),
      }),
      context({ linkedin: true }),
      choose(sources, 2),
      "rule",
    ],
    [
      "how-heard waiting for options",
      fixture(greenhouseNewFields, "question_17702872004"),
      context({ linkedin: true }),
      null,
      "pending",
    ],
  ])("fills %s", (_, input, ctx, fill, route) => {
    expect(one(input, ctx)).toEqual({ fill, route })
  })

  it.each<[string, FieldDescriptor, RuleContext, Route]>([
    [
      "an empty optional Profile field",
      f("Twitter", "text", { required: false }),
      context(),
      "skip",
    ],
    [
      "an empty optional preferred name",
      f("Preferred name", "text", { required: false }),
      context(),
      "skip",
    ],
    ["an empty required Profile field", f("Twitter"), context(), "ai"],
    [
      "an optional resume field without a resume",
      f("Current company", "text", { required: false }),
      context({ resume: null }),
      "ai",
    ],
    [
      "an optional how-heard question",
      f("How did you hear about us?", "text", { required: false }),
      context(),
      "ai",
    ],
    [
      "an optional Profile answer that no option matches",
      f("Are you legally authorized to work in the United States?", "select", {
        required: false,
        options: options("Citizen", "Visa holder"),
      }),
      context(),
      "ai",
    ],
    ["a free-text EEO question", f("Gender"), context(), "page"],
    [
      "a search query over maxLength",
      f("City", "combobox", { searchable: true, maxLength: 5 }),
      context(),
      "ai",
    ],
    [
      "a known option list without the answer",
      {
        ...fixture(greenhouseNewFields, "country"),
        options: options("Canada", "Mexico"),
      },
      context(),
      "ai",
    ],
  ])("routes %s", (_, input, ctx, route) => {
    expect(one(input, ctx)).toEqual({ fill: null, route })
  })
})

describe("eeoFill", () => {
  const veterans = [
    "I am not a protected veteran",
    "I identify as one or more of the classifications of protected veteran",
    "I don't wish to answer",
  ]
  const disabilities = [
    "Yes, I have a disability (or previously had a disability)",
    "No, I do not have a disability and have not had one in the past",
    "I do not want to answer",
  ]
  const eeo = (patch: Partial<Profile["eeo"]>): Profile["eeo"] => ({
    ...sampleProfile.eeo,
    ...patch,
  })

  it.each<
    [
      string,
      CanonicalKey,
      Control,
      Partial<Profile["eeo"]>,
      string[],
      string[] | null,
    ]
  >([
    [
      "a gender",
      "eeo.gender",
      "select",
      { gender: "female" },
      ["Male", "Female", "Decline To Self Identify"],
      ["Female"],
    ],
    [
      "non-binary",
      "eeo.gender",
      "radio",
      { gender: "non-binary" },
      ["Man", "Woman", "Non-binary", "Prefer not to say"],
      ["Non-binary"],
    ],
    [
      "a decline worded another way",
      "eeo.gender",
      "select",
      {},
      ["Male", "Female", "I don't wish to answer"],
      ["I don't wish to answer"],
    ],
    [
      "prefer not to say",
      "eeo.gender",
      "select",
      {},
      ["Man", "Woman", "Prefer not to say"],
      ["Prefer not to say"],
    ],
    [
      "a Hispanic answer",
      "eeo.hispanic",
      "select",
      { hispanic: "yes" },
      ["Yes", "No", "Decline To Self Identify"],
      ["Yes"],
    ],
    [
      "one race",
      "eeo.race",
      "select",
      { race: ["black"] },
      RACES,
      ["Black or African American"],
    ],
    [
      "one race with a qualifier",
      "eeo.race",
      "select",
      { race: ["asian"] },
      ["White (Not Hispanic or Latino)", "Asian (Not Hispanic or Latino)"],
      ["Asian (Not Hispanic or Latino)"],
    ],
    [
      "each race on a multi-select",
      "eeo.race",
      "checkboxes",
      { race: ["asian", "white"] },
      RACES,
      ["Asian", "White"],
    ],
    [
      "no race answer that leaves one out",
      "eeo.race",
      "checkboxes",
      { race: ["asian", "pacific-islander"] },
      ["Asian", "White"],
      null,
    ],
    [
      "a race decline",
      "eeo.race",
      "select",
      {},
      RACES,
      ["Decline To Self Identify"],
    ],
    [
      "a protected veteran",
      "eeo.veteran",
      "select",
      { veteran: "protected" },
      veterans,
      [veterans[1] ?? ""],
    ],
    [
      "a protected veteran, short form",
      "eeo.veteran",
      "select",
      { veteran: "protected" },
      ["I am a protected veteran", "I am not a protected veteran"],
      ["I am a protected veteran"],
    ],
    [
      "not a protected veteran",
      "eeo.veteran",
      "select",
      { veteran: "not-protected" },
      veterans,
      [veterans[0] ?? ""],
    ],
    [
      "no veteran answer from a bare yes",
      "eeo.veteran",
      "select",
      { veteran: "protected" },
      ["Yes", "No"],
      null,
    ],
    [
      "a disability",
      "eeo.disability",
      "select",
      { disability: "yes" },
      disabilities,
      [disabilities[0] ?? ""],
    ],
    [
      "no disability",
      "eeo.disability",
      "select",
      { disability: "no" },
      disabilities,
      [disabilities[1] ?? ""],
    ],
    [
      "a disability decline",
      "eeo.disability",
      "select",
      {},
      disabilities,
      ["I do not want to answer"],
    ],
    [
      "nothing the options lack",
      "eeo.gender",
      "select",
      { gender: "non-binary" },
      ["Male", "Female"],
      null,
    ],
    [
      "nothing for a key outside EEO",
      "contact.email",
      "select",
      {},
      ["Male"],
      null,
    ],
  ])("picks %s", (_, key, control, patch, labels, expected) => {
    const question = field({
      id: "q",
      label: "Question",
      control,
      options: options(...labels),
    })
    expect(eeoFill(question, key, eeo(patch))).toEqual(
      expected === null
        ? null
        : {
            optionIds: expected.map((label) => `#${labels.indexOf(label) + 1}`),
            labels: expected,
          }
    )
  })

  it("needs the options", () => {
    const question = field({ id: "q", label: "Gender", control: "select" })
    expect(eeoFill(question, "eeo.gender", sampleProfile.eeo)).toBeNull()
  })
})
