import { XIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { useState } from "react"

import { messagesQuery } from "@/lib/queries"
import { DEFAULT_SKILL, skillOf } from "@/lib/skills"
import type { ChatHistory, SkillId } from "@/lib/types"
import { breadcrumbOf } from "../resume/breadcrumb"
import { useResumeState, useSession } from "../resume/session-context"
import { Composer } from "./Composer"
import { Transcript } from "./Transcript"
import { useAssistant } from "./use-assistant"

export function AssistantPanel({ onClose }: { onClose?: () => void }) {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const resumeId = useResumeState((s) => s.resumeId)
  const conversationId = useResumeState((s) => s.conversationId)
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const [skillId, setSkillId] = useState<SkillId>(DEFAULT_SKILL)
  const skill = skillOf(skillId)

  const history = useQuery(messagesQuery(conversationId))

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper">
      <header className="flex h-11 flex-none items-center gap-2.25 border-b border-border px-3.5">
        <span className="size-1.5 rounded-full bg-chart-2" />
        <span className="font-heading text-[12.5px] font-semibold">
          Assistant
        </span>
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
            {skill?.description}
          </span>
        )}
        <div className="flex-1" />
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close assistant"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        ) : null}
      </header>

      {history.data ? (
        <Conversation
          key={conversationId}
          conversationId={conversationId}
          resumeId={resumeId}
          history={history.data}
          skillId={skillId}
          onSkillChange={setSkillId}
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
    </aside>
  )
}

/** One transcript over one `useChat`; remounted with the conversation. */
function Conversation({
  conversationId,
  resumeId,
  history,
  skillId,
  onSkillChange,
}: {
  conversationId: string
  resumeId: string
  history: ChatHistory
  skillId: SkillId
  onSkillChange: (skillId: SkillId) => void
}) {
  const assistant = useAssistant({
    conversationId,
    resumeId,
    initialMessages: history.messages,
    initialStatuses: history.suggestions,
  })
  const { status } = assistant

  return (
    <>
      <Transcript
        messages={assistant.messages}
        status={status}
        statuses={assistant.statuses}
        deciding={assistant.deciding}
        onDecide={assistant.decide}
        onRetry={assistant.retry}
      />
      <Composer
        skillId={skillId}
        onSkillChange={onSkillChange}
        busy={status === "submitted" || status === "streaming"}
        onSend={assistant.send}
        onStop={() => void assistant.stop()}
      />
    </>
  )
}
