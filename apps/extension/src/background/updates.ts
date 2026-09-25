import { z } from "zod"
import { account, realtimeClient } from "../lib/auth"
import { activePage } from "./navigation"
import { trustedPanel } from "./messages"

const WatchSchema = z.object({
  type: z.literal("watch"),
  jobId: z.string().regex(/^[0-9]{6,}$/),
  operationId: z.uuid().nullable(),
})

export function registerUpdates() {
  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.name !== "job-updates" ||
      !port.sender ||
      !trustedPanel(port.sender)
    )
      return
    const tabId = port.sender.tab?.id

    let dispose: (() => void) | null = null
    let closed = false
    let generation = 0
    const notify = (type: "ready" | "changed" | "unavailable") => {
      if (closed) return
      try {
        port.postMessage({ type })
      } catch {
        closed = true
      }
    }
    port.onDisconnect.addListener(() => {
      closed = true
      generation += 1
      dispose?.()
    })
    port.onMessage.addListener((raw: unknown) => {
      const parsed = WatchSchema.safeParse(raw)
      if (!parsed.success) return
      const current = ++generation
      dispose?.()
      dispose = null
      void (async () => {
        try {
          const [{ page }, user] = await Promise.all([
            activePage(tabId),
            account(),
          ])
          if (
            !user ||
            page.kind !== "job" ||
            page.identity.externalJobId !== parsed.data.jobId
          ) {
            notify("unavailable")
            return
          }
          const client = await realtimeClient()
          if (closed || current !== generation) return
          const changed = () => {
            if (current === generation) notify("changed")
          }
          const next = client
            .channel(`extension-job-${crypto.randomUUID()}`)
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "job_resume_bindings",
                filter: `external_job_id=eq.${parsed.data.jobId}`,
              },
              changed
            )
            .on(
              "postgres_changes",
              {
                event: "UPDATE",
                schema: "public",
                table: "job_resume_bindings",
                filter: `external_job_id=eq.${parsed.data.jobId}`,
              },
              changed
            )
          if (parsed.data.operationId)
            next.on(
              "postgres_changes",
              {
                event: "UPDATE",
                schema: "public",
                table: "tailor_operations",
                filter: `id=eq.${parsed.data.operationId}`,
              },
              changed
            )
          dispose = () => {
            void client.removeChannel(next)
          }
          next.subscribe((status) => {
            if (current !== generation) return
            if (status === "SUBSCRIBED") notify("ready")
            else notify("unavailable")
          })
        } catch {
          if (current === generation) notify("unavailable")
        }
      })()
    })
  })
}
