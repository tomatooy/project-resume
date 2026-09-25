import { implement, ORPCError, ValidationError } from "@orpc/server"
import { contract } from "@workspace/api/contract"
import {
  ATTEMPT_MS,
  isActive,
  canonicalJobUrl,
} from "@workspace/resume-core/contracts"
import { AppError } from "@workspace/resume-core"
import { toAppError } from "../errors"
import { dispatch } from "../tailoring/dispatch"
import { assertCredentialLifetime } from "../tailoring/credential"
import { tailoringEnv } from "../tailoring/runtime"
import type { ApiContext } from "./context"

export function apiError(error: unknown) {
  if (error instanceof ORPCError && error.cause instanceof ValidationError)
    return new ORPCError(
      error.code === "BAD_REQUEST" ? "VALIDATION" : "INTERNAL",
      {
        status: error.status,
        message:
          error.code === "BAD_REQUEST" ? "Invalid request" : "Invalid response",
      }
    )
  if (error instanceof ORPCError) return error
  const safe = toAppError(error)
  return new ORPCError(safe.code, {
    status: safe.status,
    message: safe.message,
    data: safe.retryAfterSeconds
      ? { retryAfterSeconds: safe.retryAfterSeconds }
      : undefined,
  })
}
const root = implement(contract).$context<ApiContext>()
const shared = root.use(async ({ next, context }) => {
  const start = Date.now()
  try {
    return await next()
  } catch (error) {
    throw apiError(error)
  } finally {
    context.log.info("shared_api", { latencyMs: Date.now() - start })
  }
})
function requireLifetime(context: ApiContext) {
  try {
    assertCredentialLifetime(context.expiresAt, Date.now() + ATTEMPT_MS)
  } catch {
    throw new AppError("UNAUTHENTICATED", "Refresh sign-in before tailoring")
  }
}
export const router = shared.router({
  resumes: {
    list: shared.resumes.list.handler(({ context }) =>
      context.services.resumes.list()
    ),
  },
  jobs: {
    fetchPosting: shared.jobs.fetchPosting.handler(({ input, context }) =>
      context.services.tailor.fetchPosting(canonicalJobUrl(input))
    ),
    lookup: shared.jobs.lookup.handler(async ({ input, context }) => {
      const found = await context.services.operations.lookup(input)
      // Legacy synchronous runs are reconciled by their saved status, never dispatched.
      if (
        found.kind === "bound" &&
        isActive(found.operation) &&
        !found.operation.legacy
      )
        return dispatch(found, context, await tailoringEnv(), context.services)
      return found
    }),
    tailor: shared.jobs.tailor.handler(async ({ input, context }) => {
      requireLifetime(context)
      const env = await tailoringEnv()
      if (!env.TAILOR_ENCRYPTION_KEY_V1 || !env.TAILOR_WORKFLOW)
        throw new AppError("INTERNAL", "Tailoring is not configured")
      const found = await context.services.operations.admit(input)
      return dispatch(found, context, env, context.services)
    }),
    retry: shared.jobs.retry.handler(async ({ input, context }) => {
      requireLifetime(context)
      const env = await tailoringEnv()
      if (!env.TAILOR_ENCRYPTION_KEY_V1 || !env.TAILOR_WORKFLOW)
        throw new AppError("INTERNAL", "Tailoring is not configured")
      return dispatch(
        await context.services.operations.retry(input),
        context,
        env,
        context.services
      )
    }),
  },
  operations: {
    cancel: shared.operations.cancel.handler(async ({ input, context }) => {
      const found = await context.services.operations.cancel(input.operationId)
      if (found.kind === "bound" && found.operation.status === "cancelled") {
        try {
          await (
            await (await tailoringEnv()).TAILOR_WORKFLOW.get(input.operationId)
          ).terminate()
        } catch {
          /* Database cancellation is authoritative. */
        }
      }
      return found
    }),
  },
})
