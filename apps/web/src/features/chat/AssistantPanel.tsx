import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { IconButton } from "@/features/shell/IconButton"
import { PaneTitle } from "@/features/shell/PaneTitle"
import { conversationQuery, messagesQuery, skillsQuery } from "@/lib/queries"
import type { ChatHistory } from "@/lib/types"
import { breadcrumbOf } from "../resume/breadcrumb"
import { useResumeState, useSession } from "../resume/session-context"
import { useWorkspace } from "../workspace/context"
import { useResumeRuntime } from "../workspace/resume-runtime"
import { ClearConversationDialog } from "./ClearConversationDialog"
import { Composer } from "./Composer"
import { Transcript } from "./Transcript"
import { useAssistant } from "./use-assistant"

export type AssistantPanelProps = {
  maximized?: boolean
  onClose?: () => void
  onToggleMaximize?: () => void
}
export function AssistantPanel(props: AssistantPanelProps) {
  const session = useSession()
  const attachedId = useResumeState((s) => s.conversationId)
  const resumeId = useResumeState((s) => s.resumeId)
  const conversation = useQuery(conversationQuery(resumeId))
  const conversationId = conversation.data?.id
  const skills = useQuery(skillsQuery())
  const history = useQuery({
    ...messagesQuery(conversationId ?? ""),
    enabled: Boolean(conversationId),
  })
  useEffect(() => {
    if (conversationId) session.attachConversation(conversationId)
  }, [session, conversationId])
  if (
    conversationId &&
    attachedId === conversationId &&
    history.data &&
    skills.data
  )
    return (
      <Conversation
        key={conversationId}
        {...props}
        conversationId={conversationId}
        history={history.data}
      />
    )
  return (
    <aside className="flex min-h-0 flex-1 flex-col bg-card p-3.5 text-xs text-muted-foreground">
      {conversation.error || history.error || skills.error ? (
        <>
          <span>Could not load this conversation.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void conversation.refetch()
              void skills.refetch()
              if (conversationId) void history.refetch()
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <span className="flex items-center gap-2">
          <Spinner />
          Loading the conversation
        </span>
      )}
    </aside>
  )
}

function Conversation({
  history,
  conversationId,
  maximized = false,
  onClose,
  onToggleMaximize,
}: AssistantPanelProps & { history: ChatHistory; conversationId: string }) {
  const workspace = useWorkspace()
  const resume = useResumeRuntime()
  const runtime = workspace.ensureAssistant(resume, history, conversationId)
  const assistant = useAssistant(runtime)
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const { data: skills } = useQuery(skillsQuery())
  const hint = skills?.find(
    (skill) => skill.id === assistant.hintSkillId && !skill.deleted
  )
  const busy = assistant.running || assistant.deciding || assistant.clearing
  useEffect(() => {
    runtime.patch({ unread: false })
  }, [runtime])
  function useSkill(id: string) {
    runtime.patch({
      hintSkillId: id,
      draft: skills?.find((skill) => skill.id === id)?.starter ?? "",
    })
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-11 flex-none items-center gap-2.25 border-b border-border px-3.5">
        <PaneTitle>Assistant</PaneTitle>
        {selectedNodeId ? (
          <button
            type="button"
            onClick={() => session.select(null)}
            title="Clear the selection"
            className="flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
          >
            <span className="truncate">
              {breadcrumbOf(doc, selectedNodeId)}
            </span>
            <XIcon className="size-2.5 flex-none" weight="bold" />
          </button>
        ) : (
          <span className="truncate text-[11px] text-muted-foreground">
            {hint
              ? `${hint.name}. ${hint.description}`
              : "Select text or a field to focus the next turn."}
          </span>
        )}
        <div className="flex-1" />
        {assistant.messages.length ? (
          <IconButton
            label="Clear conversation"
            disabled={busy}
            onClick={() => setConfirmingClear(true)}
          >
            <TrashIcon />
          </IconButton>
        ) : null}
        {onToggleMaximize ? (
          <IconButton
            label={maximized ? "Restore assistant" : "Maximize assistant"}
            onClick={onToggleMaximize}
          >
            {maximized ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
          </IconButton>
        ) : null}
        {onClose ? (
          <IconButton label="Close assistant" onClick={onClose}>
            <XIcon />
          </IconButton>
        ) : null}
      </header>
      <Transcript
        messages={assistant.messages}
        status={assistant.status}
        statuses={assistant.statuses}
        deciding={assistant.deciding}
        hintSkillId={assistant.hintSkillId}
        onDecide={assistant.decide}
        onRetry={assistant.retry}
        onEnableStructural={() => {
          runtime.patch({ structural: true })
          assistant.retry({ structural: true })
        }}
        onUseSkill={useSkill}
      />
      <Composer
        draft={assistant.draft}
        onDraftChange={(draft) => runtime.patch({ draft })}
        hintSkillId={assistant.hintSkillId}
        onHintChange={(hintSkillId) => runtime.patch({ hintSkillId })}
        structural={assistant.structural}
        onStructuralChange={(structural) => runtime.patch({ structural })}
        busy={busy}
        onSend={assistant.send}
        onStop={() => {
          void runtime
            .stop()
            .catch((error: Error) => toast.error(error.message))
        }}
      />
      <ClearConversationDialog
        open={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false)
          void runtime
            .clear()
            .then(() => toast.success("Conversation cleared"))
            .catch((error: Error) => toast.error(error.message))
        }}
      />
    </aside>
  )
}
