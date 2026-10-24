// No imports: the content script bundles this module on its own.

/** NFKD, no diacritics, lowercase, runs of anything else as one space. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** The 50 states plus DC, code to name. */
export const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
}

/**
 * The index of the option the first matching candidate picks: an exact
 * match, else the one option that starts with the candidate as whole words.
 */
export function pickOption(
  options: readonly { label: string }[],
  candidates: readonly string[]
): number | null {
  const labels = options.map((option) => normalizeText(option.label))
  for (const candidate of candidates) {
    const wanted = normalizeText(candidate)
    if (wanted === "") continue
    const exact = labels.indexOf(wanted)
    if (exact !== -1) return exact
    const starts = labels.flatMap((label, i) =>
      label.startsWith(`${wanted} `) ? [i] : []
    )
    if (starts.length === 1) return starts[0] ?? null
  }
  return null
}

export function pickYesNo(
  options: readonly { label: string }[],
  answer: "yes" | "no"
): number | null {
  return pickOption(options, [answer === "yes" ? "Yes" : "No"])
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2)
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  return counts
}

/** Dice coefficient over the character pairs of the normalized text. */
export function similarity(a: string, b: string): number {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const pairs = bigrams(left)
  let shared = 0
  for (const [pair, count] of bigrams(right)) {
    shared += Math.min(count, pairs.get(pair) ?? 0)
  }
  return (2 * shared) / (left.length - 1 + right.length - 1)
}

const COUNTRY_SUFFIXES = new Set([
  "united states",
  "united states of america",
  "usa",
  "us",
])

/** "San Francisco, CA" and "San Francisco, California, United States" agree. */
function placeKey(value: string): string {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
  const last = parts.at(-1)
  if (parts.length > 1 && last && COUNTRY_SUFFIXES.has(normalizeText(last))) {
    parts.pop()
  }
  const expanded = parts.map((part, i) =>
    i > 0 && /^[A-Za-z]{2}$/.test(part)
      ? (US_STATES[part.toUpperCase()] ?? part)
      : part
  )
  return normalizeText(expanded.join(" "))
}

/**
 * The search result to pick for a target: an exact match, else the same
 * place written another way, else the one label that is close.
 */
export function searchMatch(
  target: string,
  labels: readonly string[]
): number | null {
  const wanted = normalizeText(target)
  const exact = labels.findIndex((label) => normalizeText(label) === wanted)
  if (exact !== -1) return exact
  const place = placeKey(target)
  const samePlace = labels.findIndex((label) => placeKey(label) === place)
  if (samePlace !== -1) return samePlace
  const close = labels.flatMap((label, i) =>
    similarity(target, label) >= 0.8 ? [i] : []
  )
  return close.length === 1 ? (close[0] ?? null) : null
}

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`
const LESS_THAN = new RegExp(String.raw`less than\s*\$?${NUMBER}`)
const BETWEEN = new RegExp(String.raw`${NUMBER}\s*[-\u2013]\s*\$?${NUMBER}`)
const AT_LEAST = new RegExp(
  String.raw`${NUMBER}\s*(?:\+|(?:[a-z]+\s+)?or more)`
)

function toNumber(text: string | undefined): number {
  return Number((text ?? "").replaceAll(",", ""))
}

function inRange(label: string, value: number): boolean {
  const text = label.toLowerCase()
  const less = LESS_THAN.exec(text)
  if (less) return value < toNumber(less[1])
  const between = BETWEEN.exec(text)
  if (between) {
    return value >= toNumber(between[1]) && value <= toNumber(between[2])
  }
  const atLeast = AT_LEAST.exec(text)
  if (atLeast) return value >= toNumber(atLeast[1])
  return false
}

/**
 * The first label whose range holds the value. Reads "Less than N",
 * "N-M", "N+" and "N or more".
 */
export function matchNumberRange(
  value: number,
  labels: readonly string[]
): number | null {
  const index = labels.findIndex((label) => inRange(label, value))
  return index === -1 ? null : index
}
