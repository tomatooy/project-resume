import { useCallback, useRef, useState } from "react"

import { fetchJobPosting, tailorFromJob } from "@/lib/api"
import { ApiError, type TailorFromJobResult } from "@/lib/types"

export type TailorStage = "reading" | "writing"

export type TailorInput = {
  sourceResumeId: string
  jobText: string
  sourceUrl?: string
}

/**
 * One generation, start to finish, inside the dialog.
 *
 * Same shape as `useImport` and for the same reason: there is no queue behind
 * this, so the work lives exactly as long as the request. Cancelling abandons
 * it, and the dialog stays open until it is done.
 */
export function useTailor(onDone: (result: TailorFromJobResult) => void) {
  const [stage, setStage] = useState<TailorStage | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStage(null)
  }, [])

  const reset = useCallback(() => setFailure(null), [])

  const fetchPosting = useCallback(async (url: string) => {
    setFailure(null)
    setFetching(true)
    try {
      return await fetchJobPosting({ url })
    } catch (error) {
      setFailure(messageFor(error))
      return null
    } finally {
      setFetching(false)
    }
  }, [])

  const run = useCallback(
    async (input: TailorInput) => {
      const controller = new AbortController()
      abort.current = controller
      setFailure(null)

      try {
        // Two stages, both indeterminate. Neither the posting nor the document
        // gives a number to count towards, so nothing pretends otherwise.
        setStage("reading")
        const started = tailorFromJob(input, controller.signal)
        setStage("writing")
        const result = await started
        if (controller.signal.aborted) return

        setStage(null)
        onDone(result)
      } catch (error) {
        setStage(null)
        if (isAbort(error)) return
        setFailure(messageFor(error))
      } finally {
        abort.current = null
      }
    },
    [onDone]
  )

  return {
    progress: stage,
    failure,
    fetching,
    busy: stage !== null,
    fetchPosting,
    run,
    cancel,
    reset,
  }
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === "INTERNAL"
      ? "Something went wrong building that resume. Try again."
      : error.message
  }
  return "Something went wrong. Try again."
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
