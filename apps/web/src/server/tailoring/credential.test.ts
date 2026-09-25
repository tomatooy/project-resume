// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  sealCredential,
  openCredential,
  assertCredentialLifetime,
} from "./credential"
const key = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))
)
function payload() {
  return {
    version: 1,
    operationId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    deadline: Date.now() + 290_000,
    accessToken: "short-lived-test-token",
  } satisfies import("./credential").CredentialPayload
}
describe("bounded workflow credentials", () => {
  it("survives a separate invocation and never exposes the token in parameters", async () => {
    const source = payload()
    const first = await sealCredential(source, key)
    const serialized = JSON.stringify(first)
    expect(serialized).not.toContain(source.accessToken)
    expect(await openCredential(JSON.parse(serialized), key)).toEqual(source)
    expect((await sealCredential(source, key)).nonce).not.toBe(first.nonce)
  })
  it("rejects tampering, wrong operation, wrong keys and unsupported versions", async () => {
    const envelope = await sealCredential(payload(), key)
    await expect(
      openCredential({ ...envelope, operationId: crypto.randomUUID() }, key)
    ).rejects.toThrow("unavailable")
    await expect(
      openCredential(
        { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -5)}AAAAA` },
        key
      )
    ).rejects.toThrow("unavailable")
    await expect(
      openCredential(envelope, btoa("x".repeat(32)))
    ).rejects.toThrow("unavailable")
    await expect(
      openCredential(
        JSON.parse(JSON.stringify({ ...envelope, version: 2 })),
        key
      )
    ).rejects.toThrow("unavailable")
  })
  it("rejects insufficient lifetime and expired attempts", async () => {
    expect(() =>
      assertCredentialLifetime(
        (Date.now() + 300_000) / 1000,
        Date.now() + 300_000
      )
    ).toThrow()
    await expect(
      sealCredential({ ...payload(), deadline: Date.now() - 1 }, key)
    ).rejects.toThrow()
  })
})
