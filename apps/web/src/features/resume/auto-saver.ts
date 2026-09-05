/** What one attempted write says about what should happen next. */
export type SaveResult = "ok" | "conflict" | "retry"

export type TimerHandle = ReturnType<typeof setTimeout>

/** The waiting, behind a seam, so tests do not have to spend real time. */
export type Clock = {
  setTimeout(fn: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export const systemClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
}

const DEFAULT_DELAY_MS = 800
const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000]

export type AutoSaverOptions = {
  /**
   * Performs one write, reporting what to do next rather than throwing. Never
   * called while a previous call is still pending.
   */
  write: () => Promise<SaveResult>
  /**
   * Whether there is anything to write that can be written. False when the
   * document is already on the server, or when it would be rejected.
   */
  shouldWrite: () => boolean
  clock?: Clock
  delayMs?: number
  backoffMs?: readonly number[]
}

/**
 * When to write, separated from what a write is.
 *
 * Owns the debounce, the rule that two writes never overlap, the re-arm when
 * the document moves during a write, and the backoff after a failure. The
 * caller supplies `write`, which is the only place that knows about the
 * document or the network, and a `clock`, which is the only place that waits.
 *
 * That second seam is what makes the timing testable: every rule above used to
 * be tangled into one `save` method that could only be exercised through real
 * timers and a real transport, so none of it was.
 */
export class AutoSaver {
  private readonly clock: Clock
  private readonly delayMs: number
  private readonly backoffMs: readonly number[]

  private timer: TimerHandle | null = null
  /** The write in flight, wrapped so it never rejects. */
  private inFlight: Promise<SaveResult> | null = null
  /** Set when a change arrives mid-write, so the saver re-arms afterwards. */
  private again = false
  private retries = 0
  private stopped = false

  constructor(private readonly opts: AutoSaverOptions) {
    this.clock = opts.clock ?? systemClock
    this.delayMs = opts.delayMs ?? DEFAULT_DELAY_MS
    this.backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS
  }

  /** The document moved. Writes after the debounce, or after the current write. */
  schedule(delay: number = this.delayMs): void {
    if (this.stopped) return
    if (this.inFlight) {
      this.again = true
      return
    }
    this.arm(delay)
  }

  /**
   * Writes now and resolves once the document is on the server.
   *
   * Deliberately not gated by `dispose`. The caller flushes precisely when it
   * is tearing down, and the two used to race: `flush` suspended on the write
   * in flight, `dispose` latched the saver off underneath it, and the write
   * that was the whole point of flushing returned without doing anything.
   */
  async flush(): Promise<void> {
    this.disarm()
    await this.inFlight
    this.again = false
    await this.run()
  }

  /** Stops the clock. Anything already in flight, and any `flush`, still runs. */
  dispose(): void {
    this.stopped = true
    this.disarm()
  }

  /**
   * Re-arms a saver whose owner was torn down and mounted again. React can
   * disconnect and reconnect passive effects around a value that survives.
   */
  activate(): void {
    this.stopped = false
  }

  private disarm(): void {
    if (this.timer === null) return
    this.clock.clearTimeout(this.timer)
    this.timer = null
  }

  private arm(delay: number): void {
    this.disarm()
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      void this.run()
    }, delay)
  }

  private async run(): Promise<void> {
    if (this.inFlight) return
    if (!this.opts.shouldWrite()) return

    this.inFlight = this.opts.write().then(
      (result) => result,
      () => "retry" as const
    )
    let result: SaveResult
    try {
      result = await this.inFlight
    } finally {
      this.inFlight = null
    }

    if (result === "ok") {
      this.retries = 0
      if (!this.again) return
      this.again = false
      this.schedule()
      return
    }

    this.again = false
    // A conflict is the user's to resolve; retrying would only conflict again.
    if (result === "conflict") return

    const delay =
      this.backoffMs[Math.min(this.retries, this.backoffMs.length - 1)] ??
      DEFAULT_BACKOFF_MS[DEFAULT_BACKOFF_MS.length - 1]
    this.retries += 1
    this.schedule(delay)
  }
}
