/**
 * Work that outlives the response, such as memory consolidation after the
 * stream has closed. On Workers this is `waitUntil`; in tests it runs inline.
 */
export interface Background {
  run(task: () => Promise<void>): void
}
