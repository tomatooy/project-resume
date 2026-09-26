import { describe, expect, it } from "vitest"
import { createServices } from "../src"
import { inMemoryPorts } from "../src/testing"
const identity = {
  platform: "linkedin",
  externalJobId: "123456",
} satisfies import("../src").JobIdentity
async function setup() {
  const ports = inMemoryPorts()
  const services = createServices(ports)
  const base = await services.resumes.create({ title: "Base" })
  const input = {
    ...identity,
    sourceResumeId: base.id,
    sourceUrl: "https://www.linkedin.com/jobs/view/123456",
    jobText: "A detailed description for an engineering position. ".repeat(8),
    applyUrl: "https://jobs.example.test/123",
    additionalInstruction: "Emphasize backend work.",
    idempotencyKey: crypto.randomUUID(),
  }
  const found = await services.operations.admit(input)
  if (found.kind !== "bound") throw new Error("Missing admission")
  return { ports, services, base, input, op: found.operation }
}
describe("durable tailoring", () => {
  it("persists the application link and delivers saved instructions after restarting services", async () => {
    const { ports, op } = await setup()
    const resumed = createServices(ports)
    await resumed.operations.parse(op.id)
    await resumed.operations.generate(op.id)
    expect(ports.resumeTailor.calls[0]?.additionalInstruction).toBe(
      "Emphasize backend work."
    )
    expect(await ports.jobTargets.findById(op.jobTargetId)).toMatchObject({
      applyUrl: "https://jobs.example.test/123",
    })
    expect(await resumed.operations.lookup(identity)).toMatchObject({
      applyUrl: "https://jobs.example.test/123",
    })
    await resumed.operations.cancel(op.id)
    const retry = await resumed.operations.retry({
      ...identity,
      expectedOperationId: op.id,
      idempotencyKey: crypto.randomUUID(),
      additionalInstruction: "Keep every project.",
    })
    if (retry.kind !== "bound") throw new Error("Missing retry")
    expect(retry.applyUrl).toBe("https://jobs.example.test/123")
    await resumed.operations.generate(retry.operation.id)
    expect(ports.resumeTailor.calls[1]?.additionalInstruction).toBe(
      "Keep every project."
    )
    expect((await resumed.operations.get(op.id)).additionalInstruction).toBe(
      "Emphasize backend work."
    )
  })

  it("preserves instructions when a retry omits them and allows explicitly clearing them", async () => {
    const { services, op } = await setup()
    await services.operations.cancel(op.id)
    const retry = await services.operations.retry({
      ...identity,
      expectedOperationId: op.id,
      idempotencyKey: crypto.randomUUID(),
    })
    if (retry.kind !== "bound") throw new Error("Missing retry")
    expect(retry.operation.additionalInstruction).toBe(op.additionalInstruction)
    await services.operations.cancel(retry.operation.id)
    const cleared = await services.operations.retry({
      ...identity,
      expectedOperationId: retry.operation.id,
      idempotencyKey: crypto.randomUUID(),
      additionalInstruction: "",
    })
    expect(cleared).toMatchObject({ operation: { additionalInstruction: "" } })
  })
  it("leases one dispatch across simultaneous recovery requests", async () => {
    const { services, ports, op } = await setup()
    const claims = await Promise.all(
      Array.from({ length: 50 }, () => services.operations.claimDispatch(op.id))
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
    for (let i = 0; i < 31; i++) ports.db.advance()
    expect(await services.operations.claimDispatch(op.id)).not.toBeNull()
    await services.operations.claim(op.id)
    expect(await services.operations.claimDispatch(op.id)).toBeNull()
  })
  it("admits one copy across concurrent submissions before any model call", async () => {
    const { services, ports, input, op } = await setup()
    const results = await Promise.all([
      services.operations.admit(input),
      services.operations.admit({
        ...input,
        idempotencyKey: crypto.randomUUID(),
      }),
    ])
    expect(
      results.every((r) => r.kind === "bound" && r.resumeId === op.resumeId)
    ).toBe(true)
    expect(ports.db.resumes).toHaveLength(2)
    expect(ports.jobParser.calls).toHaveLength(0)
  })
  it("keeps the copy on parser failure and retries on the same current content", async () => {
    const { services, ports, op } = await setup()
    ports.jobParser.failWith = new Error("parser unavailable")
    await expect(services.operations.parse(op.id)).rejects.toThrow()
    await services.operations.fail(op.id, "generation_failed")
    const copy = await services.resumes.get(op.resumeId)
    copy.data.basics.name = "Edited"
    await services.resumes.update({ id: copy.id, data: copy.data })
    const retry = await services.operations.retry({
      ...identity,
      expectedOperationId: op.id,
      idempotencyKey: crypto.randomUUID(),
    })
    expect(retry).toMatchObject({
      kind: "bound",
      resumeId: copy.id,
      operation: { attempt: 2 },
    })
    if (retry.kind !== "bound") throw new Error()
    const snapshot = await ports.versions.findById(
      retry.operation.inputVersionId
    )
    expect(snapshot?.content.basics.name).toBe("Edited")
    expect(ports.db.resumes).toHaveLength(2)
  })
  it("fences late completion after cancellation, including after retry", async () => {
    const { services, ports, op } = await setup()
    await services.operations.parse(op.id)
    await services.operations.generate(op.id)
    const before = await services.resumes.get(op.resumeId)
    await services.operations.cancel(op.id)
    const retry = await services.operations.retry({
      ...identity,
      expectedOperationId: op.id,
      idempotencyKey: crypto.randomUUID(),
    })
    await services.operations.complete(op.id)
    expect((await services.resumes.get(op.resumeId)).data).toEqual(before.data)
    expect(ports.operations.artifacts.size).toBe(0)
    expect(retry).toMatchObject({
      kind: "bound",
      operation: { status: "queued" },
    })
  })
  it("preserves manual edits on conflict and leaves the base unchanged", async () => {
    const { services, op, base } = await setup()
    const original = await services.resumes.get(base.id)
    await services.operations.parse(op.id)
    await services.operations.generate(op.id)
    const copy = await services.resumes.get(op.resumeId)
    copy.data.basics.name = "Manual edit"
    await services.resumes.update({ id: copy.id, data: copy.data })
    await services.operations.complete(op.id)
    expect((await services.operations.get(op.id)).errorClass).toBe("conflict")
    expect((await services.resumes.get(copy.id)).data.basics.name).toBe(
      "Manual edit"
    )
    expect((await services.resumes.get(base.id)).data).toEqual(original.data)
  })
  it("keeps successful readiness after edits and creates a replacement after deletion", async () => {
    const { services, op, input } = await setup()
    await services.operations.parse(op.id)
    await services.operations.generate(op.id)
    await services.operations.complete(op.id)
    await services.resumes.rename(op.resumeId, "My edits")
    expect(await services.operations.lookup(identity)).toMatchObject({
      kind: "bound",
      operation: { status: "succeeded" },
    })
    await services.resumes.remove(op.resumeId)
    expect(await services.operations.lookup(identity)).toEqual({ kind: "none" })
    const replacement = await services.operations.admit({
      ...input,
      idempotencyKey: crypto.randomUUID(),
    })
    expect(replacement.kind === "bound" && replacement.resumeId).not.toBe(
      op.resumeId
    )
  })
  it("expires and purges staged output without writing it", async () => {
    const { services, ports, op } = await setup()
    await services.operations.parse(op.id)
    await services.operations.generate(op.id)
    for (let i = 0; i < 400; i++) ports.db.advance()
    expect(await services.operations.lookup(identity)).toMatchObject({
      kind: "bound",
      operation: { status: "failed", errorClass: "expired" },
    })
    expect(ports.operations.artifacts.size).toBe(0)
  })
})
