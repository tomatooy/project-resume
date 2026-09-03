import type { Background } from "../ports/background"

/** Starts tasks immediately and lets a test await them all with `flush`. */
export class InMemoryBackground implements Background {
  readonly tasks: Promise<void>[] = []

  run(task: () => Promise<void>): void {
    this.tasks.push(task())
  }

  async flush(): Promise<PromiseSettledResult<void>[]> {
    return Promise.allSettled(this.tasks)
  }
}
