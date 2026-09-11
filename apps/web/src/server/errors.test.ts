// @vitest-environment node
import { AppError } from "@workspace/resume-core"
import { describe, expect, it } from "vitest"

import { errorResponse, toAppError } from "./errors"
import { errorClassOf, type LogFields, type Logger } from "./log"

/**
 * The log line is the only thing an operator sees when a request dies before
 * its stream opens. These cases pin what it says, because a class of `object`
 * once turned a pending migration (`column agent_runs.hint_skill_id does not
 * exist`, SQLSTATE 42703) into an unexplained 500.
 */
function recording() {
  const lines: { event: string; fields: LogFields }[] = []
  const log: Logger = {
    info: (event, fields) => void lines.push({ event, fields: fields ?? {} }),
    warn: (event, fields) => void lines.push({ event, fields: fields ?? {} }),
    error: (event, fields) => void lines.push({ event, fields: fields ?? {} }),
  }
  return { log, lines }
}

/** The shape the Supabase client throws: a plain object, not an `Error`. */
function postgrest(error: { code: string; message: string }) {
  return { ...error, details: null, hint: null }
}

describe("errorClassOf", () => {
  it("reports the SQLSTATE of a plain object, not its type", () => {
    expect(
      errorClassOf(
        postgrest({
          code: "42703",
          message: "column agent_runs.hint_skill_id does not exist",
        })
      )
    ).toBe("42703")
  })

  it("reports a stale schema cache the same way", () => {
    expect(
      errorClassOf(postgrest({ code: "PGRST204", message: "no column" }))
    ).toBe("PGRST204")
  })

  it("prefers an AppError's code over its class name", () => {
    expect(errorClassOf(new AppError("CONFLICT", "taken"))).toBe("CONFLICT")
  })

  it("falls back to the class name of a real error", () => {
    expect(errorClassOf(new TypeError("boom"))).toBe("TypeError")
  })

  it("falls back to the type when there is neither", () => {
    expect(errorClassOf("nope")).toBe("string")
    expect(errorClassOf(undefined)).toBe("undefined")
    expect(errorClassOf(null)).toBe("object")
  })

  it("never carries the message, whatever the shape", () => {
    const classed = errorClassOf(
      postgrest({
        code: "42703",
        message: "column resumes.email does not exist",
      })
    )
    expect(classed).not.toContain("resumes.email")
  })
})

describe("errorResponse", () => {
  it("logs the SQLSTATE and answers an opaque 500", async () => {
    const { log, lines } = recording()
    const response = errorResponse(
      postgrest({
        code: "42703",
        message: "column agent_runs.hint_skill_id does not exist",
      }),
      log
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong" },
    })
    expect(lines).toEqual([
      { event: "request_failed", fields: { errorClass: "42703" } },
    ])
    // The row that failed is named in the PostgREST message, and must not
    // reach the log.
    expect(JSON.stringify(lines)).not.toContain("agent_runs")
  })

  it("logs a client fault as a rejection, with the code it maps to", async () => {
    const { log, lines } = recording()
    const response = errorResponse(new AppError("CONFLICT", "taken"), log)

    expect(response.status).toBe(409)
    expect(lines).toEqual([
      {
        event: "request_rejected",
        fields: { status: 409, errorClass: "CONFLICT" },
      },
    ])
  })

  it("keeps an unmapped database code a server fault", () => {
    expect(toAppError(postgrest({ code: "42703", message: "x" })).code).toBe(
      "INTERNAL"
    )
  })
})
