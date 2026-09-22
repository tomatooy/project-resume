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
import { messagesQuery, skillsQuery, useClearConversation } from "@/lib/queries"
import type { ChatHistory } from "@/lib/types"
import { breadcrumbOf } from "../resume/breadcrumb"
import { useResumeState, useSession } from "../resume/session-context"
import { ClearConversationDialog } from "./ClearConversationDialog"
import { Composer } from "./Composer"
import { Transcript } from "./Transcript"
import { useAssistant } from "./use-assistant"

export function AssistantPanel({
  maximized = false,
  onClose,
  onToggleMaximize,
}: {
  maximized?: boolean
  onClose?: () => void
  onToggleMaximize?: () => void
}) {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const resumeId = useResumeState((s) => s.resumeId)
  const conversationId = useResumeState((s) => s.conversationId)
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const [hintSkillId, setHintSkillId] = useState<string | undefined>(undefined)
  // The draft lives here, not in the composer, because a turn's plan chips and
  // its playbook chips both put text in the box from outside it.
  const [draft, setDraft] = useState("")
  // The gate lives here because two places set it: the composer's toggle and
  // the button a refused structural request leaves behind.
  const [structural, setStructural] = useState(false)
  // What the header's clear action needs from the transcript it does not own:
  // a turn in flight cannot be cleared, and an empty one has nothing to clear.
  const [chatBusy, setChatBusy] = useState(false)
  const [chatEmpty, setChatEmpty] = useState(true)
  const [confirmingClear, setConfirmingClear] = useState(false)
  // Bumped after a clear to remount the conversation onto the emptied cache.
  const [generation, setGeneration] = useState(0)
  const clear = useClearConversation(conversationId)
  const { data: skills } = useQuery(skillsQuery())
  // Deleted and disabled rows are still in the list so an old card can name
  // its skill; the header only ever names one the turn could actually load.
  const hint = hintSkillId
    ? skills?.find((skill) => skill.id === hintSkillId && !skill.deleted)
    : undefined

  // What a transcript chip does: remember the skill and put its starter (when
  // it has one) in the box.
  const useSkill = (skillId: string) => {
    setHintSkillId(skillId)
    setDraft(skills?.find((skill) => skill.id === skillId)?.starter ?? "")
  }

  const history = useQuery(messagesQuery(conversationId))

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-11 flex-none items-center gap-2.25 border-b border-border px-3.5">
        <PaneTitle>Assistant</PaneTitle>
        {selectedNodeId ? (
          <button
            type="button"
            onClick={() => session.select(null)}
            title="Clear the selection"
            className="flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-border"
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
        {chatEmpty ? null : (
          <IconButton
            label="Clear conversation"
            disabled={chatBusy || clear.isPending}
            onClick={() => setConfirmingClear(true)}
          >
            <TrashIcon />
          </IconButton>
        )}
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

      {history.data ? (
        <Conversation
          key={`${conversationId}:${generation}`}
          conversationId={conversationId}
          resumeId={resumeId}
          history={history.data}
          hintSkillId={hintSkillId}
          onHintChange={setHintSkillId}
          onUseSkill={useSkill}
          structural={structural}
          onStructuralChange={setStructural}
          draft={draft}
          onDraftChange={setDraft}
          onBusyChange={setChatBusy}
          onEmptyChange={setChatEmpty}
        />
      ) : history.error ? (
        <div className="flex flex-col items-start gap-2 p-3.5 text-[12px] text-muted-foreground">
          Could not load this conversation.
          <Button size="sm" variant="outline" onClick={() => history.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3.5 text-[12px] text-muted-foreground">
          <Spinner className="size-3.5" />
          Loading the conversation
        </div>
      )}

      <ClearConversationDialog
        open={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false)
          // A hovered card's preview outlives the transcript unless it goes.
          session.previewPatches([])
          clear.mutate(undefined, {
            onSuccess: () => {
              setGeneration((n) => n + 1)
              toast.success("Conversation cleared")
            },
            onError: (error) => toast.error(error.message),
          })
        }}
      />
    </aside>
  )
}

/** One transcript over one `useChat`; remounted with the conversation. */
function Conversation({
  conversationId,
  resumeId,
  history,
  hintSkillId,
  onHintChange,
  structural,
  onStructuralChange,
  draft,
  onDraftChange,
  onUseSkill,
  onBusyChange,
  onEmptyChange,
}: {
  conversationId: string
  resumeId: string
  history: ChatHistory
  hintSkillId?: string
  onHintChange: (skillId: string | undefined) => void
  onUseSkill: (skillId: string) => void
  structural: boolean
  onStructuralChange: (structural: boolean) => void
  draft: string
  onDraftChange: (text: string) => void
  onBusyChange: (busy: boolean) => void
  onEmptyChange: (empty: boolean) => void
}) {
  const assistant = useAssistant({
    conversationId,
    resumeId,
    initialMessages: history.messages,
    initialStatuses: history.suggestions,
  })
  const { status } = assistant
  const busy = status === "submitted" || status === "streaming"

  // The header that acts on this transcript is rendered above it, so the two
  // facts its clear action needs are reported up rather than duplicated here.
  useEffect(() => {
    onBusyChange(busy || assistant.deciding)
  }, [busy, assistant.deciding, onBusyChange])
  useEffect(() => {
    onEmptyChange(assistant.messages.length === 0)
  }, [assistant.messages.length, onEmptyChange])

  return (
    <>
      <Transcript
        messages={assistant.messages}
        status={status}
        statuses={assistant.statuses}
        deciding={assistant.deciding}
        hintSkillId={hintSkillId}
        onDecide={assistant.decide}
        onRetry={assistant.retry}
        onEnableStructural={() => {
          onStructuralChange(true)
          assistant.retry({ structural: true })
        }}
        onUseSkill={onUseSkill}
      />
      <Composer
        draft={draft}
        onDraftChange={onDraftChange}
        hintSkillId={hintSkillId}
        onHintChange={onHintChange}
        structural={structural}
        onStructuralChange={onStructuralChange}
        busy={busy}
        onSend={assistant.send}
        onStop={() => void assistant.stop()}
      />
    </>
  )
}
