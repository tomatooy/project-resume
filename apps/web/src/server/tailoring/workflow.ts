import { runTailoring } from "./runner"
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { createServices, supabasePorts } from "../container"
import { verifyBearer } from "../auth/bearer"
import { openCredential, type CredentialEnvelope } from "./credential"
import type { TailoringEnv } from "./runtime"

export class TailorWorkflow extends WorkflowEntrypoint<
  TailoringEnv,
  CredentialEnvelope
> {
  async run(event: WorkflowEvent<CredentialEnvelope>, step: WorkflowStep) {
    // Never return model content or a token from a durable step.
    const services = async () => {
      const credential = await openCredential(
        event.payload,
        this.env.TAILOR_ENCRYPTION_KEY_V1
      )
      const auth = await verifyBearer(credential.accessToken)
      if (auth.userId !== credential.userId)
        throw new Error("Workflow authorization failed")
      const result = createServices(supabasePorts(auth.db, auth.userId))
      const operation = await result.operations.get(credential.operationId)
      if (Date.parse(operation.deadline) > credential.deadline + 1000)
        throw new Error("Workflow deadline mismatch")
      return result
    }
    return runTailoring(
      event.payload.operationId,
      async (name, work) => {
        await step.do(
          name,
          {
            retries: {
              limit: name === "commit" ? 2 : 1,
              delay: "3 seconds",
              backoff: "exponential",
            },
            timeout:
              name === "parse" || name === "generate"
                ? "130 seconds"
                : "15 seconds",
          },
          work
        )
      },
      services
    )
  }
}
