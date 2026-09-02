import { useStore } from "@tanstack/react-store"
import { createContext, use, useEffect, useMemo, type ReactNode } from "react"

import type { ResumeRecord } from "@/lib/types"
import type { ResumeSession, ResumeState } from "./store"
import { ResumeSession as Session } from "./store"

const SessionContext = createContext<ResumeSession | null>(null)

export function ResumeSessionProvider({
  record,
  conversationId,
  children,
}: {
  record: ResumeRecord
  conversationId: string
  children: ReactNode
}) {
  // Keyed on the resume id by the route, so switching resumes mounts a fresh
  // session rather than mutating the open one.
  const session = useMemo(
    () => new Session(record, conversationId),
    [record, conversationId]
  )

  useEffect(() => {
    // Paired with `dispose` below: the effect can be torn down and mounted
    // again on the same session, so re-arming here is what keeps autosave
    // alive across that.
    session.activate()

    const warnOnLeave = (event: BeforeUnloadEvent) => {
      if (session.state.saveStatus === "saved") return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warnOnLeave)
    return () => {
      window.removeEventListener("beforeunload", warnOnLeave)
      void session.flush()
      session.dispose()
    }
  }, [session])

  return <SessionContext value={session}>{children}</SessionContext>
}

export function useSession(): ResumeSession {
  const session = use(SessionContext)
  if (!session) {
    throw new Error("useSession must be used inside a ResumeSessionProvider")
  }
  return session
}

/** Subscribes to one slice of the live document state. */
export function useResumeState<T>(select: (state: ResumeState) => T): T {
  return useStore(useSession().store, select)
}
