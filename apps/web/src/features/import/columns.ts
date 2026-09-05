/**
 * A crude two-column detector.
 *
 * It reorders nothing. pdf.js hands back text in content-stream order, which
 * for a sidebar template interleaves the two columns into something that reads
 * like nonsense. Fixing that properly means reconstructing reading order, which
 * is a much larger job than this feature. So instead of quietly producing a
 * confident wrong answer, this notices the layout and lets the user pick the
 * paste path, where reading order is already correct.
 *
 * The signal: bucket the x position of every text run across the page and look
 * for a quiet gutter in the middle with real weight on both sides of it.
 */
const BUCKETS = 20
const MIN_RUNS = 40
const MIN_SPAN = 120
const MIN_GUTTER = 3
const MIN_SIDE_SHARE = 0.2

export function looksMultiColumn(xs: number[]): boolean {
  if (xs.length < MIN_RUNS) return false

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const x of xs) {
    if (x < min) min = x
    if (x > max) max = x
  }
  const span = max - min
  if (span < MIN_SPAN) return false

  const counts = new Array<number>(BUCKETS).fill(0)
  for (const x of xs) {
    const index = Math.min(
      BUCKETS - 1,
      Math.floor(((x - min) / span) * BUCKETS)
    )
    counts[index] = (counts[index] ?? 0) + 1
  }

  // "Quiet" rather than empty: a header spanning both columns puts a few runs
  // in the gutter without making it a column.
  const quiet = Math.max(1, Math.floor(xs.length * 0.01))
  let longest = 0
  let run = 0
  for (let i = 1; i < BUCKETS - 1; i++) {
    if ((counts[i] ?? 0) <= quiet) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  if (longest < MIN_GUTTER) return false

  const half = Math.floor(BUCKETS / 2)
  const sum = (from: number, to: number) =>
    counts.slice(from, to).reduce((total, count) => total + count, 0)

  return (
    sum(0, half) >= xs.length * MIN_SIDE_SHARE &&
    sum(half, BUCKETS) >= xs.length * MIN_SIDE_SHARE
  )
}
