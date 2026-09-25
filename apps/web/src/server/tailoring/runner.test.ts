// @vitest-environment node
import { expect, it } from "vitest"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import { runTailoring, type Checkpoint } from "./runner"
import { dispatch } from "./dispatch"
import { vi } from "vitest"

it("executes after admission returns and replays checkpoints without another generation", async () => {
  const ports = inMemoryPorts()
  const services = createServices(ports)
  const base = await services.resumes.create()
  const found = await services.operations.admit({
    platform: "linkedin",
    externalJobId: "123456",
    sourceResumeId: base.id,
    sourceUrl: "https://www.linkedin.com/jobs/view/123456",
    jobText: "An engineering posting with enough detail to tailor. ".repeat(8),
    idempotencyKey: crypto.randomUUID(),
  })
  if (found.kind !== "bound") throw new Error()
  expect(ports.resumeTailor.calls).toHaveLength(0)
  const completed = new Map<string, { id: string }>()
  const checkpoint: Checkpoint = async (name, work) => {
    if (!completed.has(name)) completed.set(name, await work())
  }
  // A fresh composition after the submission is gone shares only persistence.
  const later = () => Promise.resolve(createServices(ports))
  await runTailoring(found.operation.id, checkpoint, later)
  await runTailoring(found.operation.id, checkpoint, later)
  expect(ports.resumeTailor.calls).toHaveLength(1)
  expect(await services.operations.get(found.operation.id)).toMatchObject({
    status: "succeeded",
  })
  expect([...completed.values()]).toEqual(
    Array(4).fill({ id: found.operation.id })
  )
})
it("retains the same queued admission after an ambiguous dispatch failure", async () => {
  const ports = inMemoryPorts()
  const services = createServices(ports)
  const base = await services.resumes.create()
  const found = await services.operations.admit({
    platform: "linkedin",
    externalJobId: "123456",
    sourceResumeId: base.id,
    sourceUrl: "https://www.linkedin.com/jobs/view/123456",
    jobText: "An engineering posting with enough detail to tailor. ".repeat(8),
    idempotencyKey: crypto.randomUUID(),
  })
  if (found.kind !== "bound") throw new Error()
  // Use a current wall-clock deadline for the credential boundary.
  const operation = {
    ...found.operation,
    deadline: new Date(Date.now() + 290_000).toISOString(),
  }
  const env = {
    TAILOR_ENCRYPTION_KEY_V1: btoa("k".repeat(32)),
    TAILOR_WORKFLOW: {
      create: vi.fn().mockRejectedValue(new Error("timeout")),
      get: vi.fn().mockRejectedValue(new Error("unavailable")),
      createBatch: vi.fn(),
      deleteBatch: vi.fn(),
    },
  }
  const auth = {
    userId: crypto.randomUUID(),
    accessToken: "test",
    expiresAt: Date.now() / 1000 + 3600,
  }
  await expect(
    dispatch({ ...found, operation }, auth, env, services)
  ).rejects.toMatchObject({ code: "INTERNAL" })
  expect((await services.operations.get(operation.id)).status).toBe("queued")
  expect(env.TAILOR_WORKFLOW.create.mock.calls[0]?.[0].id).toBe(operation.id)
})

it("leases queued dispatch once across concurrent polling and never polls running workflows", async () => {
  const services = createServices(inMemoryPorts())
  const base = await services.resumes.create()
  const found = await services.operations.admit({
    platform: "linkedin",
    externalJobId: "123456",
    sourceResumeId: base.id,
    sourceUrl: "https://www.linkedin.com/jobs/view/123456",
    jobText: "An engineering posting with enough detail to tailor. ".repeat(8),
    idempotencyKey: crypto.randomUUID(),
  })
  if (found.kind !== "bound") throw new Error()
  const status = vi.fn().mockResolvedValue({ status: "queued" })
  const env = {
    TAILOR_ENCRYPTION_KEY_V1: btoa("k".repeat(32)),
    TAILOR_WORKFLOW: {
      get: vi.fn().mockResolvedValue({ status }),
      create: vi.fn(),
      createBatch: vi.fn(),
      deleteBatch: vi.fn(),
    },
  }
  const auth = {
    userId: crypto.randomUUID(),
    accessToken: "test",
    expiresAt: Date.now() / 1000 + 3600,
  }
  await Promise.all(
    Array.from({ length: 50 }, () => dispatch(found, auth, env, services))
  )
  expect(env.TAILOR_WORKFLOW.get).toHaveBeenCalledOnce()
  expect(status).toHaveBeenCalledOnce()
  for (const operationStatus of [
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ] as const)
    await dispatch(
      { ...found, operation: { ...found.operation, status: operationStatus } },
      auth,
      env,
      services
    )
  expect(env.TAILOR_WORKFLOW.get).toHaveBeenCalledOnce()
  expect(env.TAILOR_WORKFLOW.create).not.toHaveBeenCalled()
})
