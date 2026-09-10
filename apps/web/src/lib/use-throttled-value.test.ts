import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useThrottledValue } from "./use-throttled-value"

describe("useThrottledValue", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("passes the first value of a burst straight through", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottledValue(value, 100),
      { initialProps: { value: 1 } }
    )

    expect(result.current).toBe(1)

    rerender({ value: 2 })

    expect(result.current).toBe(2)
  })

  it("holds the rest of the burst until the interval is up", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottledValue(value, 100),
      { initialProps: { value: 1 } }
    )

    rerender({ value: 2 })
    rerender({ value: 3 })
    rerender({ value: 4 })

    expect(result.current).toBe(2)

    act(() => {
      vi.advanceTimersByTime(100)
    })

    // The tail commit carries the value the burst ended at, not the one that
    // happened to be next in line.
    expect(result.current).toBe(4)
  })
})
