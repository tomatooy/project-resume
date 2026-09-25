import { createIsomorphicFn } from "@tanstack/react-start"
import { createApiClient } from "@workspace/api/client"

export const listSharedResumes = createIsomorphicFn()
  .server(async () => {
    const { listResumesDirect } = await import("../server/api/direct")
    return listResumesDirect()
  })
  .client(() =>
    createApiClient({
      baseUrl: `${window.location.origin}/api/v1`,
    }).resumes.list({})
  )
