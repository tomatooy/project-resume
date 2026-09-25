import { useEffect } from "react"
import {
  queryOptions,
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import {
  send,
  sendResumePage,
  type Snapshot,
  type Message,
} from "../lib/messages"

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
    onSuccess: async (snapshot) => {
      await client.cancelQueries({ queryKey: key })
      client.setQueryData(key, snapshot)
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
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
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        void client.invalidateQueries({ queryKey: key })
      }, 150)
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
      clearTimeout(refreshTimer)
      clearInterval(fallback)
      port.disconnect()
    }
  }, [client, jobId, accountId, operationId])
}

export function useBaseResumes(snapshot: Snapshot | undefined) {
  const client = useQueryClient()
  const queryKey = ["extension", "resumes", snapshot?.account?.id]
  const first =
    snapshot?.lookup?.kind === "none"
      ? { items: snapshot.resumes, nextCursor: snapshot.nextResumeCursor }
      : undefined
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      sendResumePage(snapshot?.account?.id ?? "", pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  useEffect(() => {
    if (snapshot?.lookup?.kind !== "none") return
    const key = ["extension", "resumes", snapshot.account?.id]
    type Pages = InfiniteData<
      Awaited<ReturnType<typeof sendResumePage>>,
      string | undefined
    >
    const current = client.getQueryData<Pages>(key)?.pages[0]
    if (
      current?.nextCursor === snapshot.nextResumeCursor &&
      JSON.stringify(current.items) === JSON.stringify(snapshot.resumes)
    )
      return
    let disposed = false
    void client.cancelQueries({ queryKey: key }).then(() => {
      if (disposed) return
      client.setQueryData<Pages>(key, {
        pages: [
          { items: snapshot.resumes, nextCursor: snapshot.nextResumeCursor },
        ],
        pageParams: [undefined],
      })
    })
    return () => {
      disposed = true
    }
  }, [client, snapshot])
  const rows =
    query.data?.pages.flatMap((page) => page.items) ?? first?.items ?? []
  return {
    ...query,
    rows: [...new Map(rows.map((row) => [row.id, row])).values()],
  }
}

export function useOperationRecovery(snapshot: Snapshot | undefined) {
  const client = useQueryClient()
  const op =
    snapshot?.lookup?.kind === "bound" ? snapshot.lookup.operation : undefined
  useEffect(() => {
    if (!op || (op.status !== "queued" && op.status !== "running")) return
    const deadline = Date.parse(op.deadline)
    const due =
      op.status === "queued"
        ? Math.min(
            deadline,
            op.dispatchAfter
              ? Date.parse(op.dispatchAfter)
              : Date.now() + 30_000
          )
        : deadline
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      void client
        .invalidateQueries({ queryKey: key })
        .catch(() => undefined)
        .finally(() => {
          if (!disposed) timer = setTimeout(refresh, 30_000)
        })
    }
    timer = setTimeout(refresh, Math.max(1000, due - Date.now() + 100))
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [client, op])
}
