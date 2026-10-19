import { type Profile, ProfileSchema } from "@workspace/autofill"

/** The country codes the phone field offers, US first. */
export const CALLING_CODES: readonly { code: string; country: string }[] = [
  { code: "+1", country: "United States, Canada" },
  { code: "+44", country: "United Kingdom" },
  { code: "+91", country: "India" },
  { code: "+86", country: "China" },
  { code: "+52", country: "Mexico" },
  { code: "+49", country: "Germany" },
  { code: "+33", country: "France" },
  { code: "+81", country: "Japan" },
  { code: "+82", country: "South Korea" },
  { code: "+61", country: "Australia" },
  { code: "+55", country: "Brazil" },
  { code: "+65", country: "Singapore" },
  { code: "+852", country: "Hong Kong" },
  { code: "+886", country: "Taiwan" },
  { code: "+353", country: "Ireland" },
  { code: "+31", country: "Netherlands" },
  { code: "+34", country: "Spain" },
  { code: "+39", country: "Italy" },
  { code: "+972", country: "Israel" },
  { code: "+971", country: "United Arab Emirates" },
  { code: "+63", country: "Philippines" },
  { code: "+84", country: "Vietnam" },
  { code: "+234", country: "Nigeria" },
  { code: "+92", country: "Pakistan" },
  { code: "+880", country: "Bangladesh" },
  { code: "+48", country: "Poland" },
  { code: "+380", country: "Ukraine" },
  { code: "+7", country: "Russia, Kazakhstan" },
  { code: "+90", country: "Türkiye" },
  { code: "+57", country: "Colombia" },
  { code: "+54", country: "Argentina" },
]

/** "Other": the number box then holds the country code as well. */
export const OTHER_CODE = "+"

/** Longest first, so a code is never read off the front of a longer one. */
const BY_LENGTH = CALLING_CODES.map(({ code }) => code).sort(
  (a, b) => b.length - a.length
)

/** A stored E.164 number as the code select and the number box show it. */
export function splitPhone(e164: string): { code: string; national: string } {
  if (e164 === "") return { code: "+1", national: "" }
  const code = BY_LENGTH.find((candidate) => e164.startsWith(candidate))
  return code
    ? { code, national: e164.slice(code.length) }
    : { code: OTHER_CODE, national: e164.slice(1) }
}

/** The number to store: E.164, or "" while the box has no digits. */
export function joinPhone(code: string, national: string): string {
  const digits = national.replace(/\D/g, "")
  return digits === "" ? "" : `${code}${digits}`
}

export type RaceAnswer = Profile["eeo"]["race"][number]

/**
 * The race answers after one box changes. Decline stands alone: choosing it
 * clears the categories, choosing a category clears it, and clearing the last
 * box falls back to it, since the answer is never empty.
 */
export function chooseRace(
  race: readonly RaceAnswer[],
  choice: RaceAnswer,
  checked: boolean
): RaceAnswer[] {
  if (checked && choice === "decline") return ["decline"]
  const next = checked
    ? [...race.filter((answer) => answer !== "decline"), choice]
    : race.filter((answer) => answer !== choice)
  return next.length > 0 ? next : ["decline"]
}

/** The dotted path of every field the schema rejects, like "contact.email". */
export function profileIssues(profile: Profile): ReadonlySet<string> {
  const result = ProfileSchema.safeParse(profile)
  return new Set(
    result.success ? [] : result.error.issues.map(({ path }) => path.join("."))
  )
}
