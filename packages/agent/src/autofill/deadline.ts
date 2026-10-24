import type { ModelCall } from "@workspace/resume-core"

/** A late source must not discard answers from sources that already finished. */
export async function beforeDeadline<T>(
  call: ModelCall,
  work: (call: ModelCall) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(call.signal.reason)
  call.signal.addEventListener("abort", abort, { once: true })
  let rejectDeadline: (reason: Error) => void = () => {}
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  const stop = () => rejectDeadline(new Error("Autofill deadline reached"))
  controller.signal.addEventListener("abort", stop, { once: true })
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(0, call.deadline - Date.now())
  )
  if (call.signal.aborted || call.deadline <= Date.now()) controller.abort()
  try {
    return await Promise.race([
      stopped,
      controller.signal.aborted
        ? stopped
        : work({ signal: controller.signal, deadline: call.deadline }),
    ])
  } finally {
    clearTimeout(timer)
    call.signal.removeEventListener("abort", abort)
    controller.signal.removeEventListener("abort", stop)
  }
}
