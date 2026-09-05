import { describe, expect, it } from "vitest"

import {
  AutoSaver,
  type Clock,
  type SaveResult,
  type TimerHandle,
} from "./auto-saver"

/**
 * A clock the test drives by hand. Timing is the whole of what `AutoSaver`
 * decides, so this is the seam that makes any of it observable.
 */
function fakeClock() {
  let next = 1
  const pending = new Map<number, { fn: () => void; delay: number }>()

  const clock: Clock = {
    setTimeout: (fn, delay) => {
      const id = next++
      pending.set(id, { fn, delay })
      return id as unknown as TimerHandle
    },
    clearTimeout: (handle) => {
      pending.delete(handle as unknown as number)
    },
  }

  return {
    clock,
    get armed(): boolean {
      return pending.size > 0
    },
    /** The delay the currently armed timer was set with. */
    get delay(): number | undefined {
      return [...pending.values()][0]?.delay
    },
    /** Fires every armed timer, as the real clock eventually would. */
    tick(): void {
      const due = [...pending.entries()]
      pending.clear()
      for (const [, entry] of due) entry.fn()
    },
  }
}

/** A transport whose every write is resolved by the test, one at a time. */
function fakeTransport() {
  const settle: ((result: SaveResult) => void)[] = []
  let calls = 0

  return {
    get calls(): number {
      return calls
    },
    get open(): number {
      return settle.length
    },
    write: (): Promise<SaveResult> => {
      calls += 1
      return new Promise<SaveResult>((resolve) => settle.push(resolve))
    },
    /** Resolves the oldest open write and lets the saver's `await` run. */
    async finish(result: SaveResult = "ok"): Promise<void> {
      const resolve = settle.shift()
      if (!resolve) throw new Error("no write in flight")
      resolve(result)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

function setup(shouldWrite: () => boolean = () => true) {
  const clock = fakeClock()
  const transport = fakeTransport()
  const saver = new AutoSaver({
    write: transport.write,
    shouldWrite,
    clock: clock.clock,
    delayMs: 800,
    backoffMs: [1000, 2000],
  })
  return { saver, clock, transport }
}

describe("scheduling", () => {
  it("waits for the debounce rather than writing per keystroke", () => {
    const { saver, clock, transport } = setup()
    saver.schedule()
    saver.schedule()
    saver.schedule()

    expect(transport.calls).toBe(0)
    clock.tick()
    expect(transport.calls).toBe(1)
  })

  it("does not start a second write on top of one in flight", async () => {
    const { saver, clock, transport } = setup()
    saver.schedule()
    clock.tick()
    expect(transport.calls).toBe(1)

    saver.schedule()
    clock.tick()
    expect(transport.calls).toBe(1)

    await transport.finish("ok")
    expect(clock.armed).toBe(true)
    clock.tick()
    expect(transport.calls).toBe(2)
  })

  it("writes nothing when there is nothing writable", () => {
    const { saver, clock, transport } = setup(() => false)
    saver.schedule()
    clock.tick()

    expect(transport.calls).toBe(0)
    expect(clock.armed).toBe(false)
  })
})

describe("failure", () => {
  it("retries with a growing delay", async () => {
    const { saver, clock, transport } = setup()
    saver.schedule()
    clock.tick()

    await transport.finish("retry")
    expect(clock.delay).toBe(1000)
    clock.tick()

    await transport.finish("retry")
    expect(clock.delay).toBe(2000)
  })

  it("leaves a conflict alone for the user to resolve", async () => {
    const { saver, clock, transport } = setup()
    saver.schedule()
    clock.tick()

    await transport.finish("conflict")
    expect(clock.armed).toBe(false)
  })
})

describe("flush", () => {
  it("writes immediately instead of waiting out the debounce", async () => {
    const { saver, clock, transport } = setup()
    saver.schedule()
    expect(transport.calls).toBe(0)

    const flushed = saver.flush()
    expect(clock.armed).toBe(false)
    await Promise.resolve()
    expect(transport.calls).toBe(1)

    await transport.finish("ok")
    await flushed
  })

  /**
   * The unmount path: the effect cleanup flushes and then disposes. `flush`
   * suspends on the write in flight, `dispose` runs while it is suspended, and
   * the write that was the point of flushing used to return without doing
   * anything, losing everything typed since the last autosave.
   */
  it("still writes when the owner disposes while it is waiting", async () => {
    const { saver, clock, transport } = setup()
    saver.schedule()
    clock.tick()
    expect(transport.calls).toBe(1)

    const flushed = saver.flush()
    saver.dispose()

    await transport.finish("ok")
    expect(transport.calls).toBe(2)

    await transport.finish("ok")
    await flushed
  })

  it("does nothing once the document is on the server", async () => {
    const { saver, transport } = setup(() => false)
    await saver.flush()
    expect(transport.calls).toBe(0)
  })
})

describe("disposal", () => {
  it("stops the clock", () => {
    const { saver, clock, transport } = setup()
    saver.schedule()
    saver.dispose()

    expect(clock.armed).toBe(false)
    saver.schedule()
    clock.tick()
    expect(transport.calls).toBe(0)
  })

  it("comes back when the owner is mounted again", () => {
    const { saver, clock, transport } = setup()
    saver.dispose()
    saver.activate()

    saver.schedule()
    clock.tick()
    expect(transport.calls).toBe(1)
  })
})
