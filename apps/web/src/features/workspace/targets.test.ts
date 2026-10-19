import { describe, expect, it } from "vitest"

import { routeTarget, TabTargetSchema, tabKey, tabRoute } from "./targets"

describe("tab targets", () => {
  it("routes /autofill to the autofill tab", () => {
    expect(TabTargetSchema.parse({ kind: "autofill" })).toEqual({
      kind: "autofill",
    })
    expect(tabKey({ kind: "autofill" })).toBe("autofill")
    expect(routeTarget("/autofill")).toEqual({ kind: "autofill" })
    expect(routeTarget("/autofill/")).toEqual({ kind: "autofill" })
    expect(tabRoute({ kind: "autofill" })).toEqual({ to: "/autofill" })
    expect(routeTarget("/autofill/x")).toBeNull()
  })
})
