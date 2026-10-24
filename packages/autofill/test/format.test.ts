import { describe, expect, it } from "vitest"

import {
  formatDate,
  formatLocation,
  formatPhoneInternational,
  formatPhoneNational,
  formatSalary,
  formatStart,
  fullName,
  phoneDigits,
} from "../src/format"
import { emptyProfile, type Profile } from "../src/profile"

function prefs(over: Partial<Profile["preferences"]>): Profile["preferences"] {
  return { ...emptyProfile.preferences, ...over }
}

describe("phones", () => {
  it("formats phones", () => {
    expect(formatPhoneNational("+14155550100")).toBe("(415) 555-0100")
    expect(formatPhoneNational("+4740012345")).toBeNull()
    expect(phoneDigits("+14155550100")).toBe("4155550100")
    expect(phoneDigits("+4740012345")).toBe("4740012345")
    expect(formatPhoneInternational("+14155550100")).toBe("+1 415 555 0100")
    expect(formatPhoneInternational("+4740012345")).toBe("+4740012345")
  })
})

describe("formatSalary", () => {
  it("formats salary", () => {
    const range = prefs({ salaryMin: 150000, salaryMax: 180000 })
    expect(formatSalary(range, "text")).toBe("$150,000 - $180,000 per year")
    expect(formatSalary(prefs({ salaryMin: 150000 }), "text")).toBe(
      "$150,000 per year"
    )
    expect(
      formatSalary(
        prefs({ salaryMin: 75, salaryMax: 90, salaryPeriod: "hour" }),
        "text"
      )
    ).toBe("$75 - $90 per hour")
    expect(formatSalary(range, "number")).toBe("150000")
    expect(formatSalary(prefs({ salaryMax: 180000 }), "text")).toBeNull()
  })

  it("writes other currencies with their own symbol or code", () => {
    expect(
      formatSalary(prefs({ salaryMin: 50000, currency: "EUR" }), "text")
    ).toBe("€50,000 per year")
    expect(
      formatSalary(prefs({ salaryMin: 50000, currency: "dollars" }), "text")
    ).toBe("50,000 dollars per year")
  })
})

describe("formatStart", () => {
  it("formats start dates", () => {
    const today = new Date(2026, 9, 18)
    const date = prefs({ startKind: "date", startDate: "2027-03-01" })
    expect(formatStart(date, "text", today)).toBe("March 1, 2027")
    expect(formatStart(date, "date", today)).toBe("2027-03-01")
    const twoWeeks = prefs({ startKind: "notice", noticeWeeks: 2 })
    expect(formatStart(twoWeeks, "text", today)).toBe("2 weeks' notice")
    expect(
      formatStart(prefs({ startKind: "notice", noticeWeeks: 1 }), "text", today)
    ).toBe("1 week's notice")
    expect(formatStart(twoWeeks, "date", today)).toBe("2026-11-01")
    expect(formatStart(prefs({}), "text", today)).toBeNull()
  })

  it("writes a date the long way, on the day it names", () => {
    expect(formatDate("2028-05-31")).toBe("May 31, 2028")
    expect(formatDate("2027-01-01")).toBe("January 1, 2027")
  })
})

describe("names and places", () => {
  it("formats names and locations", () => {
    expect(fullName("Ada", "Lovelace")).toBe("Ada Lovelace")
    expect(formatLocation("San Francisco", "CA")).toBe("San Francisco, CA")
  })
})
