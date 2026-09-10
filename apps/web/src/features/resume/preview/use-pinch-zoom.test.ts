import { describe, expect, it } from "vitest"

import { ZOOM_MAX, ZOOM_MIN } from "./preview-store"
import { pinchedZoom } from "./use-pinch-zoom"

describe("pinchedZoom", () => {
  it("follows the direction of the pinch", () => {
    expect(pinchedZoom(100, -8)).toBeGreaterThan(100)
    expect(pinchedZoom(100, 8)).toBeLessThan(100)
  })

  it("takes the same step at any zoom", () => {
    // Two levels the range does not clamp, to show the step is a ratio.
    const fromLow = pinchedZoom(50, -8) / 50
    const fromMid = pinchedZoom(100, -8) / 100

    expect(fromLow).toBeCloseTo(fromMid, 6)
  })

  it("caps one event at a step, however big the delta", () => {
    // A mouse wheel notch arrives under the same Ctrl a pinch uses, as one
    // delta large enough to otherwise triple the zoom.
    expect(pinchedZoom(100, -300)).toBeCloseTo(118, 5)
    expect(pinchedZoom(100, 300)).toBeCloseTo(85, 5)
  })

  it("stops at the ends of the range", () => {
    expect(pinchedZoom(ZOOM_MAX, -300)).toBe(ZOOM_MAX)
    expect(pinchedZoom(ZOOM_MIN, 300)).toBe(ZOOM_MIN)
  })

  it("reads a line-mode delta as lines", () => {
    // Firefox sends 3 lines where a Mac trackpad sends 3 pixels.
    expect(pinchedZoom(100, 3, WheelEvent.DOM_DELTA_LINE)).toBeCloseTo(85, 5)
    expect(pinchedZoom(100, 3)).toBeGreaterThan(95)
  })
})
