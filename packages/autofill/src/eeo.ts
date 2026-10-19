import type { CanonicalKey, FieldDescriptor, Option } from "./fields"
import { pickOption } from "./match"
import type { Profile } from "./profile"

type Eeo = Profile["eeo"]
type Candidates = readonly string[]

/*
 * Option wording per Profile answer, most specific first. Unverified until
 * real EEO fixtures arrive: the phrases follow the OFCCP forms and the
 * Greenhouse defaults. `pickOption` also takes the one option that starts
 * with a candidate, so "Asian" finds "Asian (Not Hispanic or Latino)".
 */

const DECLINE: Candidates = [
  "Decline To Self Identify",
  "I don't wish to answer",
  "I do not wish to answer",
  "I don't want to answer",
  "I do not want to answer",
  "Prefer not to say",
  "Prefer not to answer",
  "Prefer not to disclose",
  "I prefer not to say",
  "I prefer not to answer",
  "I prefer not to disclose",
  "Decline to answer",
  "Decline to state",
  "I choose not to disclose",
  "Decline",
]

const GENDER: Record<Eeo["gender"], Candidates> = {
  male: ["Male", "Man"],
  female: ["Female", "Woman"],
  "non-binary": ["Non-binary", "Nonbinary"],
  decline: DECLINE,
}

const HISPANIC: Record<Eeo["hispanic"], Candidates> = {
  yes: ["Yes", "Hispanic or Latino"],
  no: ["No", "Not Hispanic or Latino"],
  decline: DECLINE,
}

const RACE: Record<Eeo["race"][number], Candidates> = {
  "american-indian": [
    "American Indian or Alaska Native",
    "American Indian",
    "Native American",
  ],
  asian: ["Asian"],
  black: ["Black or African American", "Black", "African American"],
  "pacific-islander": [
    "Native Hawaiian or Other Pacific Islander",
    "Native Hawaiian or Pacific Islander",
    "Pacific Islander",
    "Native Hawaiian",
  ],
  white: ["White"],
  decline: DECLINE,
}

const TWO_OR_MORE: Candidates = [
  "Two or More Races",
  "Two or more",
  "Multiracial",
  "Multi-racial",
  "Mixed race",
]

/** No bare Yes or No: a veteran is not always a protected veteran. */
const VETERAN: Record<Eeo["veteran"], Candidates> = {
  protected: [
    "I identify as one or more of the classifications of protected veteran",
    "I am a protected veteran",
    "I identify as a protected veteran",
    "Protected veteran",
  ],
  "not-protected": [
    "I am not a protected veteran",
    "I do not identify as a protected veteran",
    "Not a protected veteran",
  ],
  decline: DECLINE,
}

const DISABILITY: Record<Eeo["disability"], Candidates> = {
  yes: [
    "Yes, I have a disability (or previously had a disability)",
    "Yes, I have a disability, or have had one in the past",
    "Yes",
  ],
  no: [
    "No, I do not have a disability and have not had one in the past",
    "No, I don't have a disability",
    "No",
  ],
  decline: DECLINE,
}

/** One candidate list per option to select; each must find its option. */
function wanted(
  key: CanonicalKey,
  eeo: Eeo,
  multiple: boolean
): readonly Candidates[] | null {
  switch (key) {
    case "eeo.gender":
      return [GENDER[eeo.gender]]
    case "eeo.hispanic":
      return [HISPANIC[eeo.hispanic]]
    case "eeo.race":
      if (eeo.race.length > 1 && !multiple) return [TWO_OR_MORE]
      return eeo.race.map((race) => RACE[race])
    case "eeo.veteran":
      return [VETERAN[eeo.veteran]]
    case "eeo.disability":
      return [DISABILITY[eeo.disability]]
    default:
      return null
  }
}

/**
 * The page options for an EEO answer, or null when any wanted option is
 * missing: the field then goes to "Fill these on the page" (spec 5.4).
 */
export function eeoFill(
  field: FieldDescriptor,
  key: CanonicalKey,
  eeo: Eeo
): { optionIds: string[]; labels: string[] } | null {
  const options = field.options ?? []
  const multiple = field.control === "checkboxes" || field.multiple === true
  const lists = wanted(key, eeo, multiple)
  if (!lists || options.length === 0) return null
  const chosen: Option[] = []
  for (const candidates of lists) {
    const index = pickOption(options, candidates)
    const option = index === null ? undefined : options[index]
    if (!option) return null
    if (!chosen.includes(option)) chosen.push(option)
  }
  return {
    optionIds: chosen.map((option) => option.id),
    labels: chosen.map((option) => option.label),
  }
}
