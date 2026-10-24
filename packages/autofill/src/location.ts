import type { LocationTarget } from "./fields"
import { normalizeText, US_STATES } from "./match"

const US = new Set([
  "us",
  "u s",
  "usa",
  "u s a",
  "united states",
  "united states of america",
])
const UK = new Set(["uk", "u k", "gb", "united kingdom", "great britain"])

function countryKey(value: string): string {
  const key = normalizeText(value)
  if (US.has(key)) return "united states"
  if (UK.has(key)) return "united kingdom"
  return key
}

function usRegion(value: string): string | null {
  const key = normalizeText(value)
  const name = US_STATES[value.toUpperCase()]
  if (name) return normalizeText(name)
  return Object.values(US_STATES).some((state) => normalizeText(state) === key)
    ? key
    : null
}

/** Older fills and AI answers carry a comma-separated location. */
export function locationTarget(value: string): LocationTarget | null {
  const parts = value.split(",").map((part) => part.trim())
  const [city, second, third] = parts
  if (!city || parts.length > 3 || parts.some((part) => !part)) return null
  if (!second) return { city }
  if (third) return { city, region: second, country: third }
  if (US.has(normalizeText(second)) || UK.has(normalizeText(second)))
    return { city, country: second }
  return { city, region: second }
}

function countryOf(target: LocationTarget): string | null {
  if (target.country) return countryKey(target.country)
  return target.region && usRegion(target.region) ? "united states" : null
}

function regionOf(target: LocationTarget): string | null {
  if (!target.region) return null
  return countryOf(target) === "united states"
    ? (usRegion(target.region) ?? normalizeText(target.region))
    : normalizeText(target.region)
}

/** Known geography must be present and agree, even for a semantic city match. */
export function compatibleLocation(
  target: LocationTarget,
  label: string
): boolean {
  const candidate = locationTarget(label)
  if (!candidate) return false
  const region = regionOf(target)
  const country = countryOf(target)
  return (
    (!region || region === regionOf(candidate)) &&
    (!country || country === countryOf(candidate))
  )
}

/** City names must agree; nearby places and ambiguous results stay unresolved. */
export function matchLocation(
  target: LocationTarget,
  labels: readonly string[]
): number | null {
  if (!target.region && !target.country) return null
  const city = normalizeText(target.city)
  const matches = labels.flatMap((label, index) => {
    const candidate = locationTarget(label)
    return candidate &&
      normalizeText(candidate.city) === city &&
      compatibleLocation(target, label)
      ? [index]
      : []
  })
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** City first; add expanded geography when the first results do not fit. */
export function locationQueries(target: LocationTarget): string[] {
  const region =
    countryOf(target) === "united states" && target.region
      ? (US_STATES[target.region.toUpperCase()] ?? target.region)
      : target.region
  const qualified = [target.city, region, target.country]
    .filter(Boolean)
    .join(", ")
  return [...new Set([target.city, qualified])].filter(
    (query) => query.length <= 200
  )
}
