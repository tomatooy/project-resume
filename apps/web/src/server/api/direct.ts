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
