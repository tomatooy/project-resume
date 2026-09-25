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

export const listSharedResumePage = createIsomorphicFn()
  .server(async (input: import("@workspace/resume-core").ResumePageInput) => {
    const { resumePageDirect } = await import("../server/api/direct")
    return resumePageDirect(input)
  })
  .client((input: import("@workspace/resume-core").ResumePageInput) =>
    createApiClient({
      baseUrl: `${window.location.origin}/api/v1`,
    }).resumes.page(input)
  )
export const sharedResumeSummary = createIsomorphicFn()
  .server(async (input: { id: string }) => {
    const { resumeSummaryDirect } = await import("../server/api/direct")
    return resumeSummaryDirect(input)
  })
  .client((input: { id: string }) =>
    createApiClient({
      baseUrl: `${window.location.origin}/api/v1`,
    }).resumes.summary(input)
  )
