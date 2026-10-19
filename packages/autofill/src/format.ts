import type { Profile } from "./profile"

/** "+14155550100" to "(415) 555-0100"; numbers outside +1 have no national form here. */
export function formatPhoneNational(e164: string): string | null {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : null
}

/** The 10 national digits for +1, else every digit. */
export function phoneDigits(e164: string): string {
  const digits = e164.replace(/\D/g, "")
  return e164.startsWith("+1") && digits.length === 11
    ? digits.slice(1)
    : digits
}

/** "+1 415 555 0100" for +1; any other number as given. */
export function formatPhoneInternational(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : e164
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // Not an ISO currency code: write the amount and whatever the user typed.
    return `${amount.toLocaleString("en-US")} ${currency}`
  }
}

/**
 * "$150,000 - $180,000 per year" for a text field; the minimum alone for a
 * number field. Null without a minimum.
 */
export function formatSalary(
  prefs: Profile["preferences"],
  control: "text" | "number"
): string | null {
  const { salaryMin: min, salaryMax: max, currency, salaryPeriod } = prefs
  if (min === null) return null
  if (control === "number") return String(min)
  const top = max !== null && max > min ? ` - ${money(max, currency)}` : ""
  return `${money(min, currency)}${top} per ${salaryPeriod}`
}

/** "2028-05-31" to "May 31, 2028". */
export function formatDate(iso: string): string {
  // In UTC, so a western time zone does not show the day before.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

/** The local calendar date as "2026-10-18". */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * "March 1, 2027" or "2 weeks' notice" for a text field; an ISO date for a
 * date field, counting notice from today. Null when no start is set.
 */
export function formatStart(
  prefs: Profile["preferences"],
  control: "text" | "date",
  today: Date
): string | null {
  if (prefs.startKind === "date") {
    if (prefs.startDate === "") return null
    return control === "date" ? prefs.startDate : formatDate(prefs.startDate)
  }
  if (prefs.startKind === "notice" && prefs.noticeWeeks !== null) {
    const weeks = prefs.noticeWeeks
    if (control === "text") {
      return weeks === 1 ? "1 week's notice" : `${weeks} weeks' notice`
    }
    const start = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 7 * weeks
    )
    return isoDate(start)
  }
  return null
}

export function formatLocation(city: string, state: string): string {
  return [city, state].filter((part) => part !== "").join(", ")
}

export function fullName(first: string, last: string): string {
  return [first, last].filter((part) => part !== "").join(" ")
}

/** Filename-safe slug for downloads. */
export function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "resume"
  )
}

export function resumeFileName(name: string): string {
  return `${slug(name)}-resume.pdf`
}
