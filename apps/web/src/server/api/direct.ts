import { setResponseHeader } from "@tanstack/react-start/server"
import { createRouterClient } from "@orpc/server"
import { createApiContext } from "./context"
import { router } from "./router"

export async function listResumesDirect() {
  setResponseHeader("Cache-Control", "no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).resumes.list({})
}

export async function resumePageDirect(
  input: import("@workspace/resume-core").ResumePageInput
) {
  setResponseHeader("Cache-Control", "no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).resumes.page(input)
}
export async function resumeSummaryDirect(input: { id: string }) {
  setResponseHeader("Cache-Control", "no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).resumes.summary(input)
}

export async function getAutofillProfileDirect() {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).autofillProfile.get({})
}
export async function updateAutofillProfileDirect(
  input: import("@workspace/resume-core/contracts").ProfileUpdate
) {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).autofillProfile.update(input)
}

export async function listAutofillAnswersDirect() {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).autofillAnswers.list({})
}

export async function saveAutofillAnswerDirect(
  input: import("@workspace/resume-core/contracts").SaveScopedAnswer
) {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).autofillAnswers.save(input)
}

export async function removeAutofillAnswerDirect(
  input: import("@workspace/resume-core/contracts").DeleteScopedAnswer
) {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).autofillAnswers.remove(input)
}

export async function listSavedAnswersDirect() {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).savedAnswers.list({})
}

export async function saveSavedAnswerDirect(
  input: import("@workspace/resume-core").SaveSavedAnswer
) {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).savedAnswers.save(input)
}

export async function removeSavedAnswerDirect(
  input: import("@workspace/resume-core").RemoveSavedAnswer
) {
  setResponseHeader("Cache-Control", "private, no-store")
  return createRouterClient(router, {
    context: await createApiContext(),
  }).savedAnswers.remove(input)
}
