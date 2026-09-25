import { useQueryClient } from "@tanstack/react-query"
import { useRouter, useRouterState } from "@tanstack/react-router"
import { useStore } from "@tanstack/react-store"
import { createContext, use, useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"

import {
  cacheWorkspaceResume,
  cacheWorkspaceMessages,
  releaseWorkspaceResume,
  saveWorkspaceSkill,
  workspaceAssistantApi,
} from "@/lib/queries"
import { ApiError } from "@/lib/types"
import { routeTarget, tabKey, tabRoute } from "./targets"
import { Workspace, type CloseAnswer, type ClosePrompt } from "./store"

const Context = createContext<Workspace | null>(null)
type Prompt = ClosePrompt & { resolve: (answer: CloseAnswer) => void }

export function WorkspaceProvider({
  userId,
  children,
}: {
  userId: string
  children: ReactNode
}) {
  const client = useQueryClient()
  const router = useRouter()
  const pathname = useRouterState({
    select: (s) => (s.resolvedLocation ?? s.location).pathname,
  })
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [workspace] = useState(
    () =>
      new Workspace(userId, {
        active: () =>
          routeTarget(
            (router.state.resolvedLocation ?? router.state.location).pathname
          ),
        navigate: async (target, replace) => {
          await router.navigate({ ...tabRoute(target), replace })
          const active = routeTarget(
            (router.state.resolvedLocation ?? router.state.location).pathname
          )
          if (
            (active ? tabKey(active) : null) !==
            (target ? tabKey(target) : null)
          )
            throw new Error("Navigation was cancelled. The tab remains open.")
        },
        confirm: (input) =>
          new Promise((resolve) => setPrompt({ ...input, resolve })),
        onError: (error, target) => {
          if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
            void router.navigate({
              to: "/login",
              search: { next: router.state.location.href },
            })
          } else
            toast.error(error.message, {
              action: target
                ? {
                    label:
                      target.kind === "resume" ? "Open Editor" : "Open skill",
                    onClick: () => {
                      void router.navigate(tabRoute(target))
                    },
                  }
                : undefined,
            })
        },
        saveSkill: (fields, id) => saveWorkspaceSkill(client, fields, id),
        assistantApi: (resumeId) => workspaceAssistantApi(client, resumeId),
        resumeChanged: (runtime) => {
          cacheWorkspaceResume(client, runtime.session.state)
          if (runtime.assistant) {
            cacheWorkspaceMessages(client, runtime.assistant.chat.id, {
              messages: runtime.assistant.chat.messages,
              suggestions: runtime.assistant.store.state.statuses,
            })
          }
        },
        releaseResume: (runtime) =>
          releaseWorkspaceResume(
            client,
            runtime.session.state.resumeId,
            runtime.session.state.conversationId
          ),
      })
  )

  useEffect(() => {
    if (!workspace.store.state.hydrated) {
      let storage: Storage | null = null
      try {
        storage = window.localStorage
      } catch {
        /* Optional storage. */
      }
      workspace.hydrate(storage, pathname === "/dashboard")
    } else workspace.ensureRouteTab(routeTarget(pathname))
  }, [pathname, workspace])

  useEffect(() => {
    workspace.activate()
    const onLeave = (event: BeforeUnloadEvent) => {
      if (workspace.hasUnsaved()) event.preventDefault()
    }
    window.addEventListener("beforeunload", onLeave)
    return () => {
      window.removeEventListener("beforeunload", onLeave)
      workspace.disposeLater()
    }
  }, [workspace])

  function answer(value: CloseAnswer) {
    prompt?.resolve(value)
    setPrompt(null)
  }

  return (
    <Context value={workspace}>
      {children}
      <Dialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open) answer("cancel")
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{prompt?.title}</DialogTitle>
            <DialogDescription>
              {prompt?.kind === "skill"
                ? "These changes are only in this workspace. Save them or discard them before closing."
                : "This message has not been sent. Closing the last tab discards the input."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => answer("cancel")}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => answer("discard")}>
              Discard
            </Button>
            {prompt?.kind === "skill" ? (
              <Button onClick={() => answer("save")}>Save and close</Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context>
  )
}

export function useOptionalWorkspace(): Workspace | null {
  return use(Context)
}
export function useWorkspace(): Workspace {
  const workspace = useOptionalWorkspace()
  if (!workspace) throw new Error("WorkspaceProvider is required")
  return workspace
}

export function WorkspaceContent({ children }: { children: ReactNode }) {
  const workspace = useWorkspace()
  const closing = useStore(workspace.store, (s) => s.closing)
  return (
    <div
      inert={closing}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </div>
  )
}
