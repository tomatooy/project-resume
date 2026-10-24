import { expect, it } from "vitest"
import { HOSTS } from "../src/autofill/vendors"
import {
  AUTOFILL_MATCHES,
  autofillVendor,
  classifyPage,
} from "../src/lib/pages"

const hostOf = (pattern: string) =>
  pattern.slice("https://".length, -"/*".length)

it("runs autofill on exactly the hosts the manifest lists", () => {
  expect([...HOSTS.keys()].sort()).toEqual(AUTOFILL_MATCHES.map(hostOf).sort())
})

it("gives each host the adapter of the vendor its pages belong to", () => {
  for (const [host, adapter] of HOSTS)
    expect(autofillVendor(classifyPage(`https://${host}/acme/jobs/1`))).toBe(
      adapter.vendor
    )
})
