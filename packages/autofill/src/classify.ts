import type {
  AutofillVendor,
  CanonicalKey,
  FieldDescriptor,
  ProfileSection,
  Zone,
} from "./fields"
import { normalizeText } from "./match"

/** What a field asks for and how autofill may treat it. */
export type Classification = {
  key: CanonicalKey | null
  zone: Zone
  /** The Profile section behind a forbidden field, for "Set in Profile ›". */
  anchor?: ProfileSection
}

const normal = (key: CanonicalKey | null): Classification => ({
  key,
  zone: "normal",
})
const RESUME_FILE: Classification = { key: "resume.file", zone: "resume-file" }
const OTHER_FILE: Classification = { key: null, zone: "other-file" }
const FORBIDDEN: Classification = { key: null, zone: "forbidden" }

/** Standard fields each vendor renders with the same id on every posting. */
const VENDOR_IDS: Record<
  AutofillVendor,
  ReadonlyMap<string, Classification>
> = {
  greenhouse: new Map<string, Classification>([
    ["first_name", normal("name.first")],
    ["last_name", normal("name.last")],
    ["email", normal("contact.email")],
    ["phone", normal("contact.phone.national")],
    ["country", normal("contact.phone.country")],
    ["candidate-location", normal("address.city")],
    ["resume", RESUME_FILE],
    ["cover_letter", OTHER_FILE],
  ]),
  ashby: new Map<string, Classification>([
    ["_systemfield_name", normal("name.full")],
    ["_systemfield_email", normal("contact.email")],
    ["_systemfield_resume", RESUME_FILE],
    ["_systemfield_phone", normal("contact.phone")],
    ["_systemfield_location", normal("address.location")],
  ]),
}

/** HTML autocomplete field names. */
const AUTOCOMPLETE = new Map<string, CanonicalKey>([
  ["given-name", "name.first"],
  ["family-name", "name.last"],
  ["additional-name", "name.middle"],
  ["name", "name.full"],
  ["email", "contact.email"],
  ["tel", "contact.phone"],
  ["tel-national", "contact.phone.national"],
  ["address-line1", "address.street"],
  ["address-line2", "address.apartment"],
  ["address-level2", "address.city"],
  ["address-level1", "address.state"],
  ["postal-code", "address.zip"],
  ["country-name", "address.country"],
  ["url", "links.website"],
])

/** Phrases in the form labels are compared in: normalized text. */
const words = (...phrases: string[]): readonly string[] =>
  phrases.map(normalizeText)

/** Whether normalized `text` holds `phrase` as whole words. */
function has(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `)
}

function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => has(text, phrase))
}

/** Topics only the applicant answers, with no Profile value (spec 5.3). */
const APPLICANT_ONLY = words(
  // Consent and legal attestations.
  "consent",
  "certify",
  "attest",
  "attestation",
  "agree",
  "acknowledge",
  "acknowledgment",
  "acknowledgement",
  "privacy notice",
  "privacy policy",
  "double-check",
  "accuracy",
  "accurate",
  "terms",
  // Criminal history.
  "criminal",
  "convicted",
  "conviction",
  "convictions",
  "felony",
  "felonies",
  "misdemeanor",
  "arrest",
  "arrested",
  // Relatives at the company.
  "relative",
  "relatives",
  "related to anyone",
  "family member",
  "family members",
  // Signature.
  "signature",
  "sign your name",
  "e-signature",
  // ID numbers.
  "social security",
  "ssn",
  "license number",
  "passport number",
  "id number",
  "identification number",
  "national id",
  "tax id",
  "social insurance"
)

const SALARY = words(
  "salary",
  "salaries",
  "compensation",
  "pay expectation",
  "pay expectations",
  "desired pay",
  "expected pay",
  "pay range",
  "pay rate",
  "wage",
  "wages",
  "hourly rate",
  "remuneration"
)

/**
 * Salary keeps its key and Profile section for rule fills; applicant-only
 * topics always go to the page.
 */
function forbiddenZone(label: string): Classification | null {
  if (hasAny(label, APPLICANT_ONLY)) return FORBIDDEN
  if (hasAny(label, SALARY)) {
    return { key: "pref.salary", zone: "forbidden", anchor: "preferences" }
  }
  return null
}

const RESUME = words("resume", "cv", "curriculum vitae")

/** Textarea labels that settle an open question needing a written answer. */
const WRITE = words("why", "cover letter", "tell us", "describe")

const HOW_HEARD = words(
  "how did you hear",
  "how did you first hear",
  "how did you find",
  "where did you hear",
  "where did you first hear",
  "where did you find",
  "referral source"
)
/** "Source" only as the whole label: "open source" is not how-heard. */
const SOURCE = /^(referral |lead |application |candidate )?source$/

/** Any label naming pronouns, such as "What pronouns would you like us to use?" */
const PRONOUNS = words("pronoun", "pronouns")

/** Words that reverse or narrow a yes/no question past the Profile's answer. */
const REVERSING = words(
  "without",
  "not",
  "never",
  "fail",
  "failed",
  "under",
  "younger",
  "unable",
  "cannot",
  "can't",
  "don't",
  "won't"
)

/** Places outside the US; the Profile's work answers are about the US. */
const ABROAD = words(
  "canada",
  "uk",
  "united kingdom",
  "britain",
  "england",
  "ireland",
  "europe",
  "european",
  "eu",
  "eea",
  "germany",
  "france",
  "netherlands",
  "spain",
  "portugal",
  "italy",
  "switzerland",
  "sweden",
  "poland",
  "india",
  "australia",
  "new zealand",
  "singapore",
  "japan",
  "israel",
  "mexico",
  "brazil"
)

const SPONSORSHIP = words("sponsor", "sponsorship", "sponsored")
const NOW = words("now", "currently", "presently", "at this time")
const EXPIRY = words("expire", "expires", "expiration", "expiry")
const WORK_PAPERS = words(
  "visa",
  "authorization",
  "authorisation",
  "permit",
  "status",
  "opt",
  "ead"
)
const AUTHORIZED =
  /\bauthori[sz]ed\b.*\b(work|employment|employed)\b|\b(eligible|permitted|entitled|legally able) to (legally )?work\b|\beligible for employment\b|\bright to work\b/
const STATUS = words(
  "authorization",
  "authorisation",
  "work status",
  "visa status",
  "immigration status",
  "citizenship status"
)

function workKey(label: string): CanonicalKey | null {
  if (hasAny(label, REVERSING) || hasAny(label, ABROAD)) return null
  if (hasAny(label, SPONSORSHIP)) {
    const now = hasAny(label, NOW)
    const future = has(label, "future")
    if (now === future) return "workAuth.sponsorship.any"
    return now ? "workAuth.sponsorship.now" : "workAuth.sponsorship.future"
  }
  if (hasAny(label, EXPIRY) && hasAny(label, WORK_PAPERS)) {
    return "workAuth.expiry"
  }
  if (AUTHORIZED.test(label)) return "workAuth.authorized"
  if (hasAny(label, STATUS)) return "workAuth.status"
  return null
}

const LINKS = words(
  "linkedin",
  "github",
  "website",
  "portfolio",
  "personal site"
)

/** Yes/no questions the Profile answers, unless a reversing word is present. */
const QUESTIONS: readonly (readonly [RegExp, CanonicalKey])[] = [
  [
    /\b(18 (years of age|years old|years or older|or older|or over|and over)|(over|at least|older than) (the age of )?18|age of 18|legal (working )?age)\b/,
    "other.adult",
  ],
  [
    /^(?=.*\b(willing|undergo|submit|pass|complete)\b).*\bbackground (check|checks|screening|investigation)\b/,
    "other.backgroundCheck",
  ],
  [
    /^(?=.*\b(have|hold|possess|valid)\b).*\b(drivers|driver s|driving) licen[cs]e\b/,
    "other.driversLicense",
  ],
  [
    /\b(willing|open|able|prepared) to (relocate|relocation|relocating)\b|\bconsider (relocating|relocation)\b/,
    "pref.relocation",
  ],
]

/** Asks and qualifiers around a short label, such as "What is your" or "(optional)". */
const NOUN_LEAD =
  /^(please (enter|provide|share|list|add|include) |enter |provide |what is |what s |what are )?(your )?/
const NOUN_TAIL = /( (optional|required|if applicable|if any|if different))+$/

const link = (names: string): RegExp =>
  new RegExp(
    `^(link to )?(your )?(${names})( profile| account| page)?( url| link| address)?$`
  )

/** Short labels that name a Profile or resume value, matched whole. */
const NOUNS: readonly (readonly [RegExp, CanonicalKey])[] = [
  [/^(full |legal |full legal |legal full )?name$/, "name.full"],
  [/^(legal )?(first|given) name( legal)?$/, "name.first"],
  [/^(legal )?middle name( legal)?$/, "name.middle"],
  [/^(legal )?(last|family) name( legal)?$|^surname$/, "name.last"],
  [/^(preferred|chosen) (first )?name$|^nickname$/, "name.preferred"],
  [/^(confirm )?e ?mail( address)?$/, "contact.email"],
  [
    /^(mobile |cell |home |primary )?(phone|telephone|mobile|cell)( phone)?( number)?$/,
    "contact.phone",
  ],
  [/^(street address|street|address line 1|address 1)$/, "address.street"],
  [
    /^(address line 2|address 2|apartment|apt|suite|unit)( suite| unit| number| etc)*$/,
    "address.apartment",
  ],
  [/^(current )?city( of residence)?$/, "address.city"],
  [
    /^(state|province|state province|state or province|state region|state of residence)$/,
    "address.state",
  ],
  [
    /^(zip|zip code|zipcode|postal code|postcode|zip postal code|postal zip code)$/,
    "address.zip",
  ],
  [/^(current )?country( of residence)?$/, "address.country"],
  [
    /^(current )?location( city)?$|^city (and |or )?state$|^where are you (currently )?(located|based)$/,
    "address.location",
  ],
  [link("linkedin|linked in"), "links.linkedin"],
  [link("github|git hub"), "links.github"],
  [link("twitter|x twitter|twitter x"), "links.twitter"],
  [link("portfolio|online portfolio"), "links.portfolio"],
  [
    link(
      "website|web site|personal website|personal web site|personal site|homepage|home page|personal homepage"
    ),
    "links.website",
  ],
  [
    /^(total )?years of (professional |relevant |work )?experience$/,
    "resume.years",
  ],
  [
    /^(earliest|desired|expected|available|anticipated|preferred|potential) start date$|^when (can|could|would) you start$|^when are you available to start$|^(earliest )?availability to start$|^(required )?noticed? period$/,
    "pref.start",
  ],
  [
    /^(preferred |desired )?(work (mode|arrangement|setting|model|location type)|workplace type)$/,
    "pref.workMode",
  ],
  [
    /^(preferred|desired) (cities|city|locations|location|offices|office)$/,
    "pref.cities",
  ],
  [
    /^(spoken )?languages( spoken)?$|^language proficiency$|^(what|which) languages do you speak( fluently)?$/,
    "other.languages",
  ],
  [
    /^(current |most recent |current or most recent |present )?(company|employer)( name)?$/,
    "resume.company",
  ],
  [
    /^(current |most recent |current or most recent |present )(job )?(title|role|position)$|^job title$/,
    "resume.title",
  ],
  [
    /^(most recent |highest )?(school|university|college|institution|educational institution)( name| attended)?$/,
    "resume.school",
  ],
  [
    /^(highest |most recent )?degree( obtained| earned| type)?$|^(highest )?(level of education|education level)$/,
    "resume.degree",
  ],
  [
    /^(major|field of study|area of study|discipline|concentration)$/,
    "resume.major",
  ],
  [
    /^(expected )?(graduation|grad)( date| year)?$|^(expected )?(date|year) of graduation$/,
    "resume.graduation",
  ],
  [/^(key |technical |relevant |top )?skills$/, "resume.skills"],
]

/** The label dictionary, over the normalized label. */
function labelKey(label: string): CanonicalKey | null {
  if (SOURCE.test(label) || hasAny(label, HOW_HEARD)) return "source.how-heard"
  if (hasAny(label, PRONOUNS)) return "name.pronouns"
  const work = workKey(label)
  if (work) return work
  if (LINKS.filter((phrase) => has(label, phrase)).length >= 2) {
    return "links.combined"
  }
  if (!hasAny(label, REVERSING)) {
    const question = QUESTIONS.find(([pattern]) => pattern.test(label))
    if (question) return question[1]
  }
  const noun = label.replace(NOUN_LEAD, "").replace(NOUN_TAIL, "")
  return NOUNS.find(([pattern]) => pattern.test(noun))?.[1] ?? null
}

/** The last autocomplete token that names a field we know. */
function autocompleteKey(value: string): CanonicalKey | null {
  let key: CanonicalKey | null = null
  for (const token of value.toLowerCase().split(/\s+/)) {
    key = AUTOCOMPLETE.get(token) ?? key
  }
  return key
}

/**
 * The canonical key and zone of a field. In order: vendor ids, forbidden
 * words, file inputs, open textareas, autocomplete tokens, then the label
 * dictionary. Help text is never searched.
 */
export function classifyField(
  vendor: AutofillVendor,
  field: FieldDescriptor
): Classification {
  const known = VENDOR_IDS[vendor].get(field.id)
  if (known) return { ...known }
  const label = normalizeText(field.label)
  const forbidden = forbiddenZone(label)
  if (forbidden) return { ...forbidden }
  if (field.control === "file") {
    return { ...(hasAny(label, RESUME) ? RESUME_FILE : OTHER_FILE) }
  }
  if (field.control === "textarea" && hasAny(label, WRITE)) {
    return { key: null, zone: "write" }
  }
  return normal(autocompleteKey(field.autocomplete ?? "") ?? labelKey(label))
}
