import { z } from "zod"
import {
  ATTEMPT_MS,
  CREDENTIAL_MARGIN_MS,
} from "@workspace/resume-core/contracts"

const PayloadSchema = z.object({
  version: z.literal(1),
  operationId: z.uuid(),
  userId: z.uuid(),
  deadline: z.number(),
  accessToken: z.string().min(1),
})
export type CredentialPayload = z.infer<typeof PayloadSchema>
export type CredentialEnvelope = {
  version: 1
  operationId: string
  nonce: string
  ciphertext: string
}
const encoder = new TextEncoder()
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}
function workflowKeyBytes(secret: string | undefined): Uint8Array<ArrayBuffer> {
  try {
    if (!secret) throw new Error()
    const raw = decode(secret)
    if (raw.byteLength !== 32) throw new Error()
    return raw
  } catch {
    throw new Error("TAILOR_ENCRYPTION_KEY_V1 must encode exactly 32 bytes")
  }
}
export function assertWorkflowKey(secret: string | undefined): void {
  workflowKeyBytes(secret)
}
async function key(secret: string) {
  const raw = workflowKeyBytes(secret)
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}
export async function sealCredential(
  payload: CredentialPayload,
  secret: string
): Promise<CredentialEnvelope> {
  PayloadSchema.parse(payload)
  if (
    payload.deadline <= Date.now() ||
    payload.deadline > Date.now() + ATTEMPT_MS + 5000
  )
    throw new Error("Invalid attempt deadline")
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encoder.encode(`tailor:1:${payload.operationId}`),
    },
    await key(secret),
    encoder.encode(JSON.stringify(payload))
  )
  return {
    version: 1,
    operationId: payload.operationId,
    nonce: encode(nonce),
    ciphertext: encode(new Uint8Array(ciphertext)),
  }
}
export async function openCredential(
  envelope: CredentialEnvelope,
  secret: string
): Promise<CredentialPayload> {
  try {
    if (envelope.version !== 1) throw new Error()
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(envelope.nonce),
        additionalData: encoder.encode(`tailor:1:${envelope.operationId}`),
      },
      await key(secret),
      decode(envelope.ciphertext)
    )
    const payload = PayloadSchema.parse(
      JSON.parse(new TextDecoder().decode(plain))
    )
    if (
      payload.operationId !== envelope.operationId ||
      payload.deadline <= Date.now()
    )
      throw new Error()
    return payload
  } catch {
    throw new Error("Workflow credential unavailable")
  }
}
export function assertCredentialLifetime(expiresAt: number, deadline: number) {
  if (expiresAt * 1000 < deadline + CREDENTIAL_MARGIN_MS)
    throw new Error("Refresh sign-in before tailoring")
}
