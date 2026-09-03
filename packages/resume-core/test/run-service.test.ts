import { describe, expect, it } from "vitest"

import { AppError } from "../src/domain/errors"
import { harness } from "./harness"

async function seeded() {
  const h = harness()
  const { id: resumeId } = await h.resumeService.create({ title: "CV" })
  const { id: conversationId } = await h.conversations.getOrCreate(resumeId)
  const input = {
    conversationId,
    resumeId,
    skillId: "bullet_rewrite",
    model: "test-model",
    input: {},
  }
  return { ...h, resumeId, conversationId, input }
}

describe("RunService.start", () => {
  it("snapshots the head as a system version and points the run at it", async () => {
    const h = await seeded()

    const run = await h.runService.start(h.input)

    const versions = await h.versionService.list(h.resumeId)
    expect(versions).toHaveLength(1)
    expect(versions[0]?.label).toBe("Before AI run")
    expect(versions[0]?.createdBy).toBe("system")
    expect(run.resumeVersionId).toBe(versions[0]?.id)
    expect(run.status).toBe("running")
  })

  it("does not write a second snapshot when the head has not moved", async () => {
    const h = await seeded()
    const first = await h.runService.start(h.input)
    await h.runService.finish(first.id, { status: "completed" })

    const second = await h.runService.start(h.input)

    expect(await h.versionService.list(h.resumeId)).toHaveLength(1)
    expect(second.resumeVersionId).toBe(first.resumeVersionId)
  })

  it("keeps the job description on the run until it finishes", async () => {
    const h = await seeded()

    const run = await h.runService.start({
      ...h.input,
      input: { jobDescription: "Senior engineer", targetPages: 1 },
    })
    expect(run.input).toEqual({
      jobDescription: "Senior engineer",
      targetPages: 1,
    })

    await h.runService.finish(run.id, { status: "completed" })
    expect((await h.runs.findById(run.id))?.input).toEqual({})
  })

  it("refuses to start while another run is still in progress", async () => {
    const h = await seeded()
    await h.runService.start(h.input)

    await expect(h.runService.start(h.input)).rejects.toMatchObject({
      code: "CONFLICT",
    })
  })

  it("fails an abandoned run instead of blocking behind it", async () => {
    const h = await seeded()
    const stale = await h.runService.start(h.input)
    const row = h.db.runs.find((r) => r.id === stale.id)
    if (!row) throw new Error("run not stored")
    row.createdAt = new Date(
      h.db.now().getTime() - 11 * 60 * 1000
    ).toISOString()

    const fresh = await h.runService.start(h.input)

    expect(fresh.id).not.toBe(stale.id)
    const failed = await h.runs.findById(stale.id)
    expect(failed?.status).toBe("failed")
    expect(failed?.errorClass).toBe("abandoned")
  })
})

describe("RunService.finish", () => {
  it("records status, usage and latency", async () => {
    const h = await seeded()
    const run = await h.runService.start(h.input)

    await h.runService.finish(run.id, {
      status: "completed",
      inputTokens: 120,
      outputTokens: 40,
      latencyMs: 900,
    })

    const stored = await h.runs.findById(run.id)
    expect(stored?.status).toBe("completed")
    expect(stored?.inputTokens).toBe(120)
    expect(stored?.outputTokens).toBe(40)
    expect(stored?.latencyMs).toBe(900)
  })
})

describe("RunService.assertWithinHourlyLimit", () => {
  it("allows a request below the limit", async () => {
    const h = await seeded()
    for (let i = 0; i < 3; i += 1) {
      const run = await h.runService.start(h.input)
      await h.runService.finish(run.id, { status: "completed" })
    }

    await expect(
      h.runService.assertWithinHourlyLimit(4)
    ).resolves.toBeUndefined()
  })

  it("rejects with RATE_LIMITED and a reset time at the limit", async () => {
    const h = await seeded()
    for (let i = 0; i < 4; i += 1) {
      const run = await h.runService.start(h.input)
      await h.runService.finish(run.id, { status: "completed" })
    }

    const error = await h.runService.assertWithinHourlyLimit(4).catch((e) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe("RATE_LIMITED")
    expect(error.retryAfterSeconds).toBeGreaterThan(0)
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(3600)
  })

  it("ignores runs older than an hour", async () => {
    const h = await seeded()
    for (let i = 0; i < 4; i += 1) {
      const run = await h.runService.start(h.input)
      await h.runService.finish(run.id, { status: "completed" })
    }
    for (const row of h.db.runs) {
      row.createdAt = new Date(
        h.db.now().getTime() - 2 * 60 * 60 * 1000
      ).toISOString()
    }

    await expect(
      h.runService.assertWithinHourlyLimit(4)
    ).resolves.toBeUndefined()
  })
})
