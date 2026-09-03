import { AppError } from "@workspace/resume-core"
import { z } from "zod"

import { toAppError } from "../errors"
import type { Logger } from "../log"

/**
 * The JSON shape the browser's `toApiError` already understands, for a
 * request refused before any stream started. Once a stream is open, errors
 * travel inside it instead and the status is long gone.
 */
export function errorResponse(error: unknown, log: Logger): Response {
  const appError =
    error instanceof z.ZodError
      ? new AppError("VALIDATION", "Invalid request")
      : toAppError(error)

  if (appError.status >= 500) {
    log.error("chat_failed", { errorClass: errorClassOfApp(error) })
  } else {
    log.info("chat_rejected", {
      status: appError.status,
      errorClass: appError.code,
    })
  }

  const headers = new Headers({ "content-type": "application/json" })
  if (appError.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(appError.retryAfterSeconds))
  }
  return new Response(
    JSON.stringify({
      error: { code: appError.code, message: appError.message },
    }),
    { status: appError.status, headers }
  )
}

function errorClassOfApp(error: unknown): string {
  if (error instanceof AppError) return error.code
  if (error instanceof Error) return error.name
  return typeof error
}
