import { useEffect } from "react"
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { send, type Message } from "../lib/messages"

const key = ["extension", "current"]
export function currentQuery() {
  return queryOptions({
    queryKey: key,
    queryFn: () => send({ type: "state" }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
  })
}
export function useAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (message: Message) => send(message),
    onSuccess: (snapshot) => {
      client.setQueryData(key, snapshot)
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
}

export function useRoutingRefresh() {
  const client = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      void client.resetQueries({ queryKey: key })
    }
    const changed = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.url) refresh()
    }
    chrome.tabs.onUpdated.addListener(changed)
    chrome.tabs.onActivated.addListener(refresh)
    return () => {
      chrome.tabs.onUpdated.removeListener(changed)
      chrome.tabs.onActivated.removeListener(refresh)
    }
  }, [client])
}

export function useServerUpdates(
  jobId: string | undefined,
  accountId: string | undefined,
  operationId: string | undefined
) {
  const client = useQueryClient()
  useEffect(() => {
    if (!jobId || !accountId) return
    const port = chrome.runtime.connect({ name: "job-updates" })
    let connected = false
    const refresh = () => {
      void client.invalidateQueries({ queryKey: key })
    }
    const fallback = setInterval(() => {
      if (!connected) refresh()
    }, 10_000)
    port.onMessage.addListener((message: { type?: string }) => {
      if (message.type === "ready") {
        connected = true
        refresh()
      } else if (message.type === "changed") refresh()
      else if (message.type === "unavailable") connected = false
    })
    port.onDisconnect.addListener(() => {
      connected = false
    })
    port.postMessage({ type: "watch", jobId, operationId: operationId ?? null })
    return () => {
      clearInterval(fallback)
      port.disconnect()
    }
  }, [client, jobId, accountId, operationId])
}
