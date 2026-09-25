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
