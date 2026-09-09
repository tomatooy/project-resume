/**
 * Fetches a job posting as plain text. Implemented on the Worker, where the
 * request has no browser fingerprint and no session, which is why this often
 * comes back as a sign-in wall rather than a posting.
 */
export interface JobFetcher {
  fetch(url: string, signal?: AbortSignal): Promise<string>
}
