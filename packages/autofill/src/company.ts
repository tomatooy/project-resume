import { normalizeText } from "./match"

const LEGAL_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "plc",
  "limited",
  "incorporated",
])

/** Normalized text without trailing legal suffixes: "Stripe, Inc." is "stripe". */
export function normalizeCompany(name: string): string {
  const words = normalizeText(name).split(" ")
  while (words.length > 0 && LEGAL_SUFFIXES.has(words.at(-1) ?? "")) {
    words.pop()
  }
  return words.join(" ")
}

export function companiesMatch(a: string, b: string): boolean {
  const left = normalizeCompany(a)
  return left !== "" && left === normalizeCompany(b)
}
