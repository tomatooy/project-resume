/** Every TanStack Query key in the app, in one place. */
export const qk = {
  resumes: () => ["resumes"] as const,
  resume: (id: string) => ["resume", id] as const,
  versions: (resumeId: string) => ["versions", resumeId] as const,
  version: (versionId: string) => ["version", versionId] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  session: () => ["session"] as const,
}
