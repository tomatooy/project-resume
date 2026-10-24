import type { Resume } from "@workspace/resume-schema"

import { classifyField } from "./classify"
import { effectiveFacts, type ResumeFacts } from "./facts"
import {
  type AutofillVendor,
  type CanonicalKey,
  type Control,
  type FieldClass,
  type FieldDescriptor,
  type Fill,
  LIMITS,
  type Option,
  type Route,
  type Zone,
} from "./fields"
import {
  formatDate,
  formatLocation,
  formatPhoneInternational,
  formatPhoneNational,
  formatSalary,
  formatStart,
  fullName,
  phoneDigits,
} from "./format"
import {
  matchNumberRange,
  normalizeText,
  pickOption,
  pickYesNo,
  searchMatch,
  US_STATES,
} from "./match"
import { effectiveIdentity, type Identity, type Profile } from "./profile"
import { optionState } from "./options"

export type RuleContext = {
  vendor: AutofillVendor
  profile: Profile
  resume: Resume | null
  /** The posting was opened from LinkedIn, so how-heard questions answer "LinkedIn". */
  linkedin: boolean
  today: Date
}

export type RuleResult = {
  fills: Fill[]
  /** Rule values for fields that already had a value, offered as Overwrite. */
  overwrites: Fill[]
  classes: FieldClass[]
}

type YesNo = "yes" | "no"

/** A rule value in each form a control may take; a missing form fills nothing. */
type Answer = {
  /** Text controls, and the option or search candidate when nothing else is set. */
  text?: string
  /** A shorter text for when `text` is over the field's maxLength. */
  short?: string
  /** Number controls: digits only. */
  number?: string
  /** Date controls: YYYY-MM-DD. */
  date?: string
  /** Checkboxes, and Yes or No options. */
  yesNo?: YesNo
  /** Option labels to look for, best first. */
  choices?: readonly string[]
  /** One candidate list per value, each selected on a multi-select. */
  many?: readonly (readonly string[])[]
  /** A number to find among range options such as "3-5 years". */
  range?: number
  rangeUnit?: "weeks"
  /** What to type into a search box, and the result to pick. */
  search?: { query: string; target: string }
}

type Data = {
  profile: Profile
  identity: Identity
  facts: ResumeFacts | null
  linkedin: boolean
  today: Date
}

/** A key's value, given the normalized field label. */
type Rule = (data: Data, label: string) => Answer | null

const plain = (value: string | null | undefined): Answer | null =>
  value ? { text: value } : null

const yesNo = (value: YesNo | null): Answer | null =>
  value === null ? null : { yesNo: value, text: value === "yes" ? "Yes" : "No" }

/** Where normalized `text` holds `phrase` as whole words, or -1. */
function wordAt(text: string, phrase: string): number {
  return ` ${text} `.indexOf(` ${phrase} `)
}

function pronouns({
  pronouns,
  pronounsCustom,
}: Profile["personal"]): Answer | null {
  if (pronouns === "custom") return plain(pronounsCustom)
  return plain(pronouns)
}

/** National for +1, else international; the bare digits when that is too long. */
function phone(e164: string): Answer | null {
  if (e164 === "") return null
  const digits = phoneDigits(e164)
  return {
    text: formatPhoneNational(e164) ?? formatPhoneInternational(e164),
    short: digits,
    number: digits,
  }
}

/** Only a +1 number says its country without a guess. */
function phoneCountry(e164: string): Answer | null {
  if (!e164.startsWith("+1")) return null
  return {
    text: "United States",
    choices: ["United States", "United States +1", "+1"],
  }
}

function city({ city, state }: Identity): Answer | null {
  if (city === "") return null
  return {
    text: city,
    search: { query: city, target: formatLocation(city, state) },
  }
}

/** The code as text; the name on lists and in search boxes. */
function state(code: string): Answer | null {
  if (code === "") return null
  const name = US_STATES[code]
  if (!name) return { text: code }
  return {
    text: code,
    choices: [name, code],
    search: { query: name, target: name },
  }
}

const UNITED_STATES = [
  "United States",
  "United States of America",
  "USA",
  "US",
  "U.S.",
  "U.S.A.",
]

function country(value: string): Answer | null {
  if (value === "") return null
  const wanted = normalizeText(value)
  const us = UNITED_STATES.some((name) => normalizeText(name) === wanted)
  return { text: value, choices: us ? UNITED_STATES : [value] }
}

/** "City, ST", or the city alone; nothing without a city. */
function location({ city, state }: Identity): Answer | null {
  if (city === "") return null
  const place = formatLocation(city, state)
  return { text: place, search: { query: place, target: place } }
}

type Links = Profile["links"]

const website = (links: Links): string => links.website || links.portfolio

/** A link the user labeled Twitter, or X. */
function twitter(links: Links): string {
  const link = links.other.find(({ label }) => {
    const words = normalizeText(label).split(" ")
    return words[0] === "x" || words.includes("twitter")
  })
  return link?.url ?? ""
}

/** What a combined label may name, longer wording first, and the link each reads. */
const LINK_NAMES: readonly {
  phrases: readonly string[]
  url: (links: Links) => string
}[] = [
  { phrases: ["linkedin", "linked in"], url: (links) => links.linkedin },
  { phrases: ["github", "git hub"], url: (links) => links.github },
  {
    phrases: [
      "personal website",
      "personal web site",
      "personal site",
      "website",
      "web site",
      "homepage",
      "home page",
    ],
    url: website,
  },
  { phrases: ["portfolio"], url: (links) => links.portfolio },
]

const PREFERRED = new Set(["preferred", "preferably"])

/**
 * The first link the label names that the Profile has, in the label's order,
 * with the one marked "preferred" moved first. "LinkedIn (preferred)" marks
 * the link it follows; "preferably GitHub" the one it leads.
 */
function combinedLink(links: Links, label: string): string {
  const padded = ` ${label} `
  const named = LINK_NAMES.flatMap(({ phrases, url }) => {
    for (const phrase of phrases) {
      const at = wordAt(label, phrase)
      if (at === -1) continue
      const before = padded.slice(0, at).trim().split(" ").at(-1) ?? ""
      const after =
        padded
          .slice(at + phrase.length + 2)
          .trim()
          .split(" ")[0] ?? ""
      return [{ at, before, after, url: url(links) }]
    }
    return []
  }).sort((a, b) => a.at - b.at)
  const preferred =
    named.find(({ after }) => PREFERRED.has(after)) ??
    named.find(({ before }) => PREFERRED.has(before))
  const ordered = preferred
    ? [preferred, ...named.filter((link) => link !== preferred)]
    : named
  return ordered.find(({ url }) => url !== "")?.url ?? ""
}

/** Yes when either answer is yes; no when both are no (GH 9.5). */
function anySponsorship({
  sponsorshipNow: now,
  sponsorshipFuture: future,
}: Profile["workAuth"]): YesNo | null {
  if (now === "yes" || future === "yes") return "yes"
  if (now === "no" && future === "no") return "no"
  return null
}

type Status = Exclude<Profile["workAuth"]["status"], "other" | null>

/**
 * How lists word each status. No bare "Citizen": it would also start
 * "Citizen of another country".
 */
const STATUSES: Record<Status, Answer> = {
  citizen: {
    text: "U.S. citizen",
    choices: ["U.S. Citizen", "US Citizen", "United States Citizen"],
  },
  "permanent-resident": {
    text: "U.S. permanent resident",
    choices: [
      "U.S. Permanent Resident",
      "US Permanent Resident",
      "Permanent Resident",
      "Lawful Permanent Resident",
      "Green Card Holder",
      "Green Card",
    ],
  },
  h1b: { text: "H-1B visa", choices: ["H-1B", "H1B", "H-1B Visa"] },
  "f1-opt": { text: "F-1 OPT", choices: ["F-1 OPT", "F1 OPT", "OPT"] },
  "f1-stem-opt": {
    text: "F-1 STEM OPT",
    choices: ["F-1 STEM OPT", "F1 STEM OPT", "STEM OPT"],
  },
}

function status({ status, statusOther }: Profile["workAuth"]): Answer | null {
  if (status === null) return null
  if (status === "other") return plain(statusOther)
  return STATUSES[status]
}

const expiry = (iso: string): Answer | null =>
  iso === "" ? null : { text: formatDate(iso), date: iso }

function salary(prefs: Profile["preferences"]): Answer | null {
  const text = formatSalary(prefs, "text")
  const number = formatSalary(prefs, "number")
  if (text === null || number === null || prefs.salaryMin === null) return null
  return { text, number, range: prefs.salaryMin }
}

function start(prefs: Profile["preferences"], today: Date): Answer | null {
  const text = formatStart(prefs, "text", today)
  const date = formatStart(prefs, "date", today)
  return text === null || date === null
    ? null
    : {
        text,
        date,
        ...(prefs.startKind === "notice" && prefs.noticeWeeks !== null
          ? { range: prefs.noticeWeeks, rangeUnit: "weeks" }
          : {}),
      }
}

type WorkMode = Profile["preferences"]["workModes"][number]

const WORK_MODES: Record<WorkMode, readonly [string, ...string[]]> = {
  remote: ["Remote", "Fully remote"],
  hybrid: ["Hybrid"],
  onsite: ["On-site", "Onsite", "In office", "In person"],
}

/** Every mode as text and on a multi-select; the first one found on a single choice. */
function workModes(modes: readonly WorkMode[]): Answer | null {
  if (modes.length === 0) return null
  const lists = modes.map((mode) => WORK_MODES[mode])
  return {
    text: lists.map(([name]) => name).join(", "),
    choices: lists.flat(),
    many: lists,
  }
}

function cities(names: readonly string[]): Answer | null {
  const [first] = names
  if (first === undefined) return null
  return {
    text: names.join(", "),
    choices: names,
    many: names.map((name) => [name]),
    search: { query: first, target: first },
  }
}

function languages(list: Profile["other"]["languages"]): Answer | null {
  if (list.length === 0) return null
  const names = list.map(({ language }) => language)
  return {
    text: list
      .map(({ language, level }) => `${language} (${level})`)
      .join(", "),
    choices: names,
    many: names.map((name) => [name]),
  }
}

/** "June 2019", or "2019" when the label asks for the year. No day to give a date control. */
function graduation(
  month: string | null | undefined,
  label: string
): Answer | null {
  if (!month) return null
  const year = month.slice(0, 4)
  const text =
    wordAt(label, "year") === -1
      ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
          timeZone: "UTC",
          month: "long",
          year: "numeric",
        })
      : year
  return { text, number: year, choices: [text, year] }
}

function years(value: number | null | undefined): Answer | null {
  if (value === null || value === undefined) return null
  return { text: String(value), number: String(value), range: value }
}

const ANSWERS: Record<CanonicalKey, Rule> = {
  "name.full": ({ identity }) => plain(fullName(identity.first, identity.last)),
  "name.first": ({ identity }) => plain(identity.first),
  "name.middle": ({ identity }) => plain(identity.middle),
  "name.last": ({ identity }) => plain(identity.last),
  "name.preferred": ({ identity }) => plain(identity.preferred),
  "name.pronouns": ({ profile }) => pronouns(profile.personal),
  "contact.email": ({ identity }) => plain(identity.email),
  "contact.phone": ({ identity }) => phone(identity.phone),
  "contact.phone.country": ({ identity }) => phoneCountry(identity.phone),
  "contact.phone.national": ({ identity }) => phone(identity.phone),
  "address.street": ({ profile }) => plain(profile.contact.street),
  "address.apartment": ({ profile }) => plain(profile.contact.apartment),
  "address.city": ({ identity }) => city(identity),
  "address.state": ({ identity }) => state(identity.state),
  "address.zip": ({ profile }) => plain(profile.contact.zip),
  "address.country": ({ profile }) => country(profile.contact.country),
  "address.location": ({ identity }) => location(identity),
  "links.linkedin": ({ profile }) => plain(profile.links.linkedin),
  "links.github": ({ profile }) => plain(profile.links.github),
  "links.portfolio": ({ profile }) => plain(profile.links.portfolio),
  "links.website": ({ profile }) => plain(website(profile.links)),
  "links.twitter": ({ profile }) => plain(twitter(profile.links)),
  "links.combined": ({ profile }, label) =>
    plain(combinedLink(profile.links, label)),
  "workAuth.authorized": ({ profile }) => yesNo(profile.workAuth.authorized),
  "workAuth.sponsorship.now": ({ profile }) =>
    yesNo(profile.workAuth.sponsorshipNow),
  "workAuth.sponsorship.future": ({ profile }) =>
    yesNo(profile.workAuth.sponsorshipFuture),
  "workAuth.sponsorship.any": ({ profile }) =>
    yesNo(anySponsorship(profile.workAuth)),
  "workAuth.status": ({ profile }) => status(profile.workAuth),
  "workAuth.expiry": ({ profile }) => expiry(profile.workAuth.expiry),
  "pref.salary": ({ profile }) => salary(profile.preferences),
  "pref.start": ({ profile, today }) => start(profile.preferences, today),
  "pref.relocation": ({ profile }) => yesNo(profile.preferences.relocation),
  "pref.workMode": ({ profile }) => workModes(profile.preferences.workModes),
  "pref.cities": ({ profile }) => cities(profile.preferences.cities),
  "other.adult": ({ profile }) => yesNo(profile.other.adult),
  "other.backgroundCheck": ({ profile }) =>
    yesNo(profile.other.backgroundCheck),
  "other.driversLicense": ({ profile }) => yesNo(profile.other.driversLicense),
  "other.languages": ({ profile }) => languages(profile.other.languages),
  "resume.company": ({ facts }) => plain(facts?.company),
  "resume.title": ({ facts }) => plain(facts?.title),
  "resume.school": ({ facts }) => plain(facts?.school),
  "resume.degree": ({ facts }) => plain(facts?.degree),
  "resume.major": ({ facts }) => plain(facts?.major),
  "resume.graduation": ({ facts }, label) =>
    graduation(facts?.graduation, label),
  "resume.years": ({ facts }) => years(facts?.years),
  "resume.skills": ({ facts }) => plain(facts?.skills),
  "resume.file": () => null,
  "source.how-heard": ({ linkedin }) =>
    linkedin ? { text: "LinkedIn" } : null,
}

type Base = Pick<Fill, "fieldId" | "source">

/** The Fill schema's limit on a search query and target. */
const SEARCH_MAX = 200

const CLOSED: ReadonlySet<Control> = new Set([
  "select",
  "combobox",
  "radio",
  "checkboxes",
])

const isMultiple = (field: FieldDescriptor): boolean =>
  field.control === "checkboxes" || field.multiple === true

/** A search box: marked searchable, or a combobox that lists nothing until typed into. */
const isSearch = (field: FieldDescriptor): boolean =>
  optionState(field) === "search"

/** A closed field whose options are read only once it is opened. */
const waitsForOptions = (field: FieldDescriptor): boolean =>
  CLOSED.has(field.control) &&
  optionState(field) === "pending" &&
  (field.options ?? []).length === 0

/** The first value that fits whole: values are never truncated. */
function textFill(
  base: Base,
  field: FieldDescriptor,
  ...values: (string | undefined)[]
): Fill | null {
  const limit = Math.min(field.maxLength ?? LIMITS.answer, LIMITS.answer)
  const value = values.find(
    (candidate) =>
      candidate !== undefined && candidate !== "" && candidate.length <= limit
  )
  return value === undefined ? null : { ...base, kind: "text", value }
}

function searchFill(
  base: Base,
  field: FieldDescriptor,
  answer: Answer
): Fill | null {
  const text = answer.text ?? ""
  const { query, target } = answer.search ?? { query: text, target: text }
  const limit = Math.min(field.maxLength ?? SEARCH_MAX, SEARCH_MAX)
  if (query === "" || target === "") return null
  if (query.length > limit || target.length > SEARCH_MAX) return null
  return { ...base, kind: "search", query, target }
}

function optionsAt(
  options: readonly Option[],
  indexes: readonly (number | null)[]
): Option[] {
  const chosen: Option[] = []
  for (const index of indexes) {
    const option = index === null ? undefined : options[index]
    if (option && !chosen.includes(option)) chosen.push(option)
  }
  return chosen
}

/** Each value found on a multi-select; else the one best option. */
function pickOptions(
  field: FieldDescriptor,
  options: readonly Option[],
  answer: Answer
): Option[] {
  if (answer.many && isMultiple(field)) {
    const found = answer.many.map((candidates) =>
      pickOption(options, candidates)
    )
    return optionsAt(options, found)
  }
  if (answer.yesNo) {
    return optionsAt(options, [pickYesNo(options, answer.yesNo)])
  }
  const labels = options.map(({ label }) => label)
  let index = pickOption(options, answer.choices ?? [answer.text ?? ""])
  if (index === null && answer.range !== undefined) {
    if (answer.rangeUnit === "weeks") {
      const weeks = answer.range
      const matches = labels.flatMap((label, i) =>
        /\bweeks?\b/i.test(label) && matchNumberRange(weeks, [label]) === 0
          ? [i]
          : []
      )
      index = matches.length === 1 ? (matches[0] ?? null) : null
    } else index = matchNumberRange(answer.range, labels)
  }
  if (index === null && answer.search) {
    index = searchMatch(answer.search.target, labels)
  }
  return optionsAt(options, [index])
}

/** The rule fill a control takes from an answer, or null when none fits. */
function valueFill(field: FieldDescriptor, answer: Answer): Fill | null {
  if (optionState(field) === "unavailable") return null
  const base: Base = { fieldId: field.id, source: "rule" }
  switch (field.control) {
    case "checkbox":
      return answer.yesNo
        ? { ...base, kind: "check", checked: answer.yesNo === "yes" }
        : null
    case "file":
      return null
    case "number":
      return textFill(base, field, answer.number)
    case "date":
      return textFill(base, field, answer.date)
    case "select":
    case "combobox":
    case "radio":
    case "checkboxes": {
      const chosen = pickOptions(field, field.options ?? [], answer)
      if (chosen.length > 0) {
        return {
          ...base,
          kind: "options",
          optionIds: chosen.map(({ id }) => id),
          labels: chosen.map(({ label }) => label),
        }
      }
      return isSearch(field) ? searchFill(base, field, answer) : null
    }
    default:
      return textFill(base, field, answer.text, answer.short)
  }
}

function ruleFill(
  field: FieldDescriptor,
  zone: Zone,
  answer: Answer | null
): Fill | null {
  if (zone === "resume-file") {
    return { kind: "resume-file", fieldId: field.id, source: "rule" }
  }
  return answer ? valueFill(field, answer) : null
}

/** Keys the Profile answers; resume facts and how-heard come from elsewhere. */
const profileBacked = (key: CanonicalKey | null): boolean =>
  key !== null && !key.startsWith("resume.") && key !== "source.how-heard"

function routeOf(
  field: FieldDescriptor,
  key: CanonicalKey | null,
  zone: Zone,
  answer: Answer | null,
  fill: Fill | null
): Route {
  if (field.hasValue) return "filled"
  if (optionState(field) === "unavailable") return "page"
  if (fill) return "rule"
  if (zone === "other-file") return "page"
  if (zone === "write") return "write"
  if (answer && waitsForOptions(field)) return "pending"
  if (zone === "forbidden") return "page"
  if (!field.required && !answer && profileBacked(key)) return "skip"
  return "ai"
}

/**
 * The fills rules settle from the Profile and the resume, and where every
 * other field goes. A field that already has a value keeps it; its rule
 * value is offered in `overwrites`.
 */
export function ruleFills(
  fields: FieldDescriptor[],
  ctx: RuleContext
): RuleResult {
  const data: Data = {
    profile: ctx.profile,
    identity: effectiveIdentity(ctx.profile, ctx.resume?.basics ?? null),
    facts: effectiveFacts(ctx.profile, ctx.resume, ctx.today),
    linkedin: ctx.linkedin,
    today: ctx.today,
  }
  const result: RuleResult = { fills: [], overwrites: [], classes: [] }
  for (const field of fields) {
    const { key, zone, anchor } = classifyField(ctx.vendor, field)
    const answer = key ? ANSWERS[key](data, normalizeText(field.label)) : null
    const fill = ruleFill(field, zone, answer)
    const route = routeOf(field, key, zone, answer, fill)
    if (fill && route === "filled") result.overwrites.push(fill)
    else if (fill) result.fills.push(fill)
    result.classes.push({
      fieldId: field.id,
      key,
      zone,
      ...(anchor ? { anchor } : {}),
      route,
    })
  }
  return result
}
