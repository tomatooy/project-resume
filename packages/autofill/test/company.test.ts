import { describe, expect, it } from "vitest"

import { companiesMatch, normalizeCompany } from "../src/company"

describe("companiesMatch", () => {
  it("matches company names across suffixes and punctuation", () => {
    expect(normalizeCompany("Acme Widgets LLC")).toBe("acme widgets")
    expect(companiesMatch("Stripe, Inc.", "stripe")).toBe(true)
    expect(companiesMatch("Stripe", "Airbnb")).toBe(false)
    expect(companiesMatch("Inc.", "")).toBe(false)
  })
})
