import type { Workflow } from "@cloudflare/workers-types"
import type { CredentialEnvelope } from "./credential"

export type TailoringEnv = {
  TAILOR_WORKFLOW: Workflow<CredentialEnvelope>
  TAILOR_ENCRYPTION_KEY_V1: string
  EXTENSION_ORIGINS?: string
}
export async function tailoringEnv(): Promise<TailoringEnv> {
  const { env } = await import("cloudflare:workers")
  return env
}
