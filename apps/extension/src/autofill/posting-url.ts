const GREENHOUSE_POSTING_PATH = /^\/([^/]+)\/jobs\/(\d+)\/?$/
const GREENHOUSE_EMBED_PATH = /^\/embed\/job_app\/?$/

type GreenhousePosting = {
  board: string
  jobId: string
  embedded: boolean
}

export function greenhousePosting(url: URL): GreenhousePosting | null {
  const match = GREENHOUSE_POSTING_PATH.exec(url.pathname)
  const board = match?.[1]
  const jobId = match?.[2]
  if (board && jobId) return { board, jobId, embedded: false }
  if (!GREENHOUSE_EMBED_PATH.test(url.pathname)) return null

  const boards = url.searchParams.getAll("for")
  const jobs = url.searchParams.getAll("token")
  const [embeddedBoard] = boards
  const [embeddedJob] = jobs
  if (
    boards.length !== 1 ||
    jobs.length !== 1 ||
    !embeddedBoard ||
    !embeddedJob ||
    !/^[a-z0-9_-]+$/i.test(embeddedBoard) ||
    !/^\d+$/.test(embeddedJob)
  )
    return null
  return { board: embeddedBoard, jobId: embeddedJob, embedded: true }
}

/** Embed identity survives query-only navigation; tracking parameters do not. */
export function scanUrl(input: string): string {
  const url = new URL(input)
  const base = url.origin + url.pathname
  const posting = greenhousePosting(url)
  if (!posting?.embedded) return base
  const query = new URLSearchParams({
    for: posting.board,
    token: posting.jobId,
  })
  return `${base}?${query}`
}
