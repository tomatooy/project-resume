import type { JobFetcher } from "../ports/job-fetcher"

export class StubJobFetcher implements JobFetcher {
  text = ""
  failWith: Error | null = null
  readonly calls: string[] = []

  async fetch(url: string): Promise<string> {
    this.calls.push(url)
    if (this.failWith) throw this.failWith
    return this.text
  }
}
