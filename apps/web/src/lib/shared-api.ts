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

export const sharedAutofillProfile = createIsomorphicFn()
  .server(async () => {
    const { getAutofillProfileDirect } = await import("../server/api/direct")
    return getAutofillProfileDirect()
  })
  .client(() =>
    createApiClient({
      baseUrl: `${window.location.origin}/api/v1`,
    }).autofillProfile.get({})
  )
export const sharedUpdateAutofillProfile = createIsomorphicFn()
  .server(
    async (input: import("@workspace/resume-core/contracts").ProfileUpdate) => {
      const { updateAutofillProfileDirect } = await import(
        "../server/api/direct"
      )
      return updateAutofillProfileDirect(input)
    }
  )
  .client((input: import("@workspace/resume-core/contracts").ProfileUpdate) =>
    createApiClient({
      baseUrl: `${window.location.origin}/api/v1`,
    }).autofillProfile.update(input)
  )

export const sharedAutofillAnswers = createIsomorphicFn()
  .server(async () => {
    const { listAutofillAnswersDirect } = await import("../server/api/direct")
    return listAutofillAnswersDirect()
  })
  .client(() =>
    createApiClient({
      baseUrl: `${window.location.origin}/api/v1`,
    }).autofillAnswers.list({})
  )

export const sharedSaveAutofillAnswer = createIsomorphicFn()
  .server(
    async (
      input: import("@workspace/resume-core/contracts").SaveScopedAnswer
    ) => {
      const { saveAutofillAnswerDirect } = await import("../server/api/direct")
      return saveAutofillAnswerDirect(input)
    }
  )
  .client(
    (input: import("@workspace/resume-core/contracts").SaveScopedAnswer) =>
      createApiClient({
        baseUrl: `${window.location.origin}/api/v1`,
      }).autofillAnswers.save(input)
  )

export const sharedRemoveAutofillAnswer = createIsomorphicFn()
  .server(
    async (
      input: import("@workspace/resume-core/contracts").DeleteScopedAnswer
    ) => {
      const { removeAutofillAnswerDirect } = await import(
        "../server/api/direct"
      )
      return removeAutofillAnswerDirect(input)
    }
  )
  .client(
    (input: import("@workspace/resume-core/contracts").DeleteScopedAnswer) =>
      createApiClient({
        baseUrl: `${window.location.origin}/api/v1`,
      }).autofillAnswers.remove(input)
  )
