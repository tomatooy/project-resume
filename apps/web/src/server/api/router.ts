import { implement, ORPCError, ValidationError } from "@orpc/server"
import { contract } from "@workspace/api/contract"
import {
  ATTEMPT_MS,
  canonicalJobUrl,
  ResumePreviewSchema,
} from "@workspace/resume-core/contracts"
import { AppError } from "@workspace/resume-core"
import { traceAutofillRequest } from "../autofill-trace"
import { toAppError } from "../errors"
import { withLogContext } from "../log"
import { dispatch } from "../tailoring/dispatch"
import {
  assertCredentialLifetime,
  assertWorkflowKey,
} from "../tailoring/credential"
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
const shared = root.use(async ({ next, context, path }) => {
  try {
    return await withLogContext({ procedure: path.join(".") }, () => next())
  } catch (error) {
    const safe = apiError(error)
    const fields = { procedure: path.join("."), status: safe.status }
    if (safe.status >= 500) context.log.error("api_failed", fields, error)
    else context.log.warn("api_rejected", fields)
    throw safe
  }
})
function requireLifetime(context: ApiContext) {
  try {
    assertCredentialLifetime(context.expiresAt, Date.now() + ATTEMPT_MS)
  } catch {
    throw new AppError("UNAUTHENTICATED", "Refresh sign-in before tailoring")
  }
}
async function configuredTailoring(context: ApiContext) {
  const env = await tailoringEnv()
  try {
    assertWorkflowKey(env.TAILOR_ENCRYPTION_KEY_V1)
  } catch {
    context.log.error("tailoring.configuration", {
      errorClass: "invalid_workflow_key",
    })
    throw new AppError(
      "INTERNAL",
      "Tailoring is unavailable. Check the server configuration."
    )
  }
  if (!env.TAILOR_WORKFLOW) {
    context.log.error("tailoring.configuration", {
      errorClass: "missing_workflow_binding",
    })
    throw new AppError(
      "INTERNAL",
      "Tailoring is unavailable. Check the server configuration."
    )
  }
  return env
}
export const router = shared.router({
  resumes: {
    preview: shared.resumes.preview.handler(async ({ input, context }) =>
      ResumePreviewSchema.parse(await context.services.resumes.get(input.id))
    ),
    page: shared.resumes.page.handler(({ input, context }) =>
      context.services.resumes.page(input)
    ),
    summary: shared.resumes.summary.handler(({ input, context }) =>
      context.services.resumes.summary(input.id)
    ),
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
        found.operation.status === "queued" &&
        !found.operation.legacy
      )
        return dispatch(found, context, await tailoringEnv(), context.services)
      return found
    }),
    tailor: shared.jobs.tailor.handler(async ({ input, context }) => {
      requireLifetime(context)
      const env = await configuredTailoring(context)
      const found = await context.services.operations.admit(input)
      return dispatch(found, context, env, context.services)
    }),
    retry: shared.jobs.retry.handler(async ({ input, context }) => {
      requireLifetime(context)
      const env = await configuredTailoring(context)
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
  autofill: {
    plan: shared.autofill.plan.handler(({ input, context }) =>
      traceAutofillRequest("api.plan", input, () =>
        context.services.autofill.plan(input)
      )
    ),
    start: shared.autofill.start.handler(({ input, context }) =>
      traceAutofillRequest("api.start", input, () =>
        context.services.autofill.start(input)
      )
    ),
    infer: shared.autofill.infer.handler(({ input, context }) =>
      traceAutofillRequest("api.infer", input, () =>
        context.services.autofill.infer(input)
      )
    ),
    resolveLocation: shared.autofill.resolveLocation.handler(
      ({ input, context }) =>
        traceAutofillRequest("api.resolveLocation", input, () =>
          context.services.autofill.resolveLocation(input)
        )
    ),
    resolveSearch: shared.autofill.resolveSearch.handler(({ input, context }) =>
      traceAutofillRequest("api.resolveSearch", input, () =>
        context.services.autofill.resolveSearch(input)
      )
    ),
    answer: shared.autofill.answer.handler(({ input, context }) =>
      traceAutofillRequest("api.answer", input, () =>
        context.services.autofill.answer(input)
      )
    ),
    generate: shared.autofill.generate.handler(({ input, context }) =>
      traceAutofillRequest("api.generate", input, () =>
        context.services.autofill.generate(input)
      )
    ),
    notes: {
      merge: shared.autofill.notes.merge.handler(({ input, context }) =>
        traceAutofillRequest("api.notes.merge", input, () =>
          context.services.autofill.notesMerge(input)
        )
      ),
      undo: shared.autofill.notes.undo.handler(({ input, context }) =>
        traceAutofillRequest("api.notes.undo", input, () =>
          context.services.autofill.notesUndo(input)
        )
      ),
    },
  },
})
