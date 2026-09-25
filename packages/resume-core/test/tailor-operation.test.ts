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
    idempotencyKey: crypto.randomUUID(),
  }
  const found = await services.operations.admit(input)
  if (found.kind !== "bound") throw new Error("Missing admission")
  return { ports, services, base, input, op: found.operation }
}
describe("durable tailoring", () => {
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
