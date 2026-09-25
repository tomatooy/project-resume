import {
  AppError,
  boundJob,
  isActive,
  type JobLookup,
  type Services,
} from "@workspace/resume-core"
import {
  assertCredentialLifetime,
  sealCredential,
  type CredentialEnvelope,
} from "./credential"
import type { TailoringEnv } from "./runtime"

export async function dispatch(
  found: JobLookup,
  auth: { userId: string; accessToken: string; expiresAt: number },
  env: TailoringEnv,
  services: Services
): Promise<JobLookup> {
  if (
    found.kind !== "bound" ||
    !isActive(found.operation) ||
    found.operation.legacy
  )
    return found
  const op = found.operation
  try {
    const instance = await env.TAILOR_WORKFLOW.get(op.id)
    const state = await instance.status()
    if (["errored", "terminated", "complete"].includes(state.status)) {
      return boundJob(
        found.identity,
        await services.operations.fail(op.id, "generation_failed")
      )
    }
    return found
  } catch {
    /* Missing and unavailable instances are resolved by the same ID. */
  }
  assertCredentialLifetime(auth.expiresAt, Date.parse(op.deadline))
  let params: CredentialEnvelope
  try {
    params = await sealCredential(
      {
        version: 1,
        operationId: op.id,
        userId: auth.userId,
        accessToken: auth.accessToken,
        deadline: Date.parse(op.deadline),
      },
      env.TAILOR_ENCRYPTION_KEY_V1
    )
  } catch {
    return boundJob(
      found.identity,
      await services.operations.fail(op.id, "dispatch_failed")
    )
  }
  try {
    await env.TAILOR_WORKFLOW.create({ id: op.id, params })
    return found
  } catch {
    try {
      await (await env.TAILOR_WORKFLOW.get(op.id)).status()
      return found
    } catch {
      // A timeout cannot prove create failed. Preserve the admission and replay ID.
      throw new AppError("INTERNAL", "Could not confirm submission. Try again.")
    }
  }
}
