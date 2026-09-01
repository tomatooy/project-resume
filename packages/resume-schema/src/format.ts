const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** `2024-01` -> `Jan 2024`. Returns the input unchanged if it is not YYYY-MM. */
export function formatYearMonth(value: string, locale = "en-US"): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month] = match
  if (!year || !month) return value
  const index = Number(month) - 1

  if (locale === "en-US") {
    return `${MONTHS[index] ?? month} ${year}`
  }
  // Day 15 avoids timezone rollover shifting the month.
  const date = new Date(Date.UTC(Number(year), index, 15))
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

/**
 * `Jan 2024 - Present`. Either end may be missing; a range with neither end
 * renders as an empty string so templates can skip it entirely.
 */
export function formatRange(
  start?: string,
  end?: string,
  locale = "en-US"
): string {
  const from = start ? formatYearMonth(start, locale) : ""
  const to =
    end === "present" ? "Present" : end ? formatYearMonth(end, locale) : ""
  if (from && to) return `${from} - ${to}`
  return from || to
}
