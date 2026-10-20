import { useEffect } from "react"
import {
  queryOptions,
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type { AutofillAction } from "../lib/autofill-view"
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

/**
 * Autofill actions, apart from `useAction` so a running pass, which can take
 * 25 s, does not hold up focus and draft actions.
 */
export function useAutofillAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: AutofillAction) => send({ type: "autofill", action }),
    onSuccess: async (snapshot) => {
      await client.cancelQueries({ queryKey: key })
      client.setQueryData(key, snapshot)
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
}

/** Refreshes the panel when its tab's autofill session changes. */
export function useAutofillUpdates(tabId: number | null | undefined) {
  const client = useQueryClient()
  useEffect(() => {
    if (tabId === null || tabId === undefined) return
    const watched = `autofill:${tabId}`
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (!(watched in changes) || timer) return
      timer = setTimeout(() => {
        timer = undefined
        void client.invalidateQueries({ queryKey: key })
      }, 100)
    }
    chrome.storage.session.onChanged.addListener(changed)
    return () => {
      clearTimeout(timer)
      chrome.storage.session.onChanged.removeListener(changed)
    }
  }, [client, tabId])
}

/** Reloads the panel when its own tab moves to another URL. */
export function useRoutingRefresh(tabId: number | null | undefined) {
  const client = useQueryClient()
  useEffect(() => {
    if (tabId === null || tabId === undefined) return
    const changed = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && change.url)
        void client.resetQueries({ queryKey: key })
    }
    chrome.tabs.onUpdated.addListener(changed)
    return () => chrome.tabs.onUpdated.removeListener(changed)
  }, [client, tabId])
}

export function useServerUpdates(
  jobId: string | undefined,
  accountId: string | undefined,
  operationId: string | undefined
) {
  const client = useQueryClient()
  useEffect(() => {
    if (!jobId || !accountId) return
    let connected = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        void client.invalidateQueries({ queryKey: key })
      }, 150)
    }
    const open = () => {
      const next = chrome.runtime.connect({ name: "job-updates" })
      next.onMessage.addListener((message: { type?: string }) => {
        if (port !== next) return
        if (message.type === "ready") {
          connected = true
          refresh()
        } else if (message.type === "changed") refresh()
        else if (message.type === "unavailable") connected = false
      })
      next.onDisconnect.addListener(() => {
        if (port === next) connected = false
      })
      next.postMessage({
        type: "watch",
        jobId,
        operationId: operationId ?? null,
      })
      return next
    }
    let port = open()
    // Chrome closes ports when the page enters the back/forward cache.
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      port.disconnect()
      connected = false
      port = open()
      refresh()
    }
    const fallback = setInterval(() => {
      if (!connected) refresh()
    }, 10_000)
    window.addEventListener("pageshow", restore)
    return () => {
      clearTimeout(refreshTimer)
      clearInterval(fallback)
      window.removeEventListener("pageshow", restore)
      port.disconnect()
    }
  }, [client, jobId, accountId, operationId])
}

/** The snapshot carries the first resume page for tailoring and for autofill. */
const seeded = (snapshot: Snapshot) =>
  snapshot.lookup?.kind === "none" || snapshot.autofill !== null

export function useBaseResumes(snapshot: Snapshot | undefined) {
  const client = useQueryClient()
  const queryKey = ["extension", "resumes", snapshot?.account?.id]
  const first =
    snapshot && seeded(snapshot)
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
    if (!snapshot || !seeded(snapshot)) return
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
