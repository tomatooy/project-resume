import { ArrowUpIcon, StopIcon, XIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import type { RejectedPatch } from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef, useState } from "react"

import { messagesQuery } from "@/lib/queries"
import { DEFAULT_SKILL, SKILLS, available, needs, skillOf } from "@/lib/skills"
import type {
  ChatHistory,
  ChatUIMessage,
  SkillId,
  Suggestion,
  SuggestionStatus,
} from "@/lib/types"
import { breadcrumbOf } from "../resume/breadcrumb"
import { useResumeState, useSession } from "../resume/session-context"
import { MessageMarkdown } from "./MessageMarkdown"
import { SuggestionCard } from "./SuggestionCard"
import { useAssistant } from "./use-assistant"

type UIPart = ChatUIMessage["parts"][number]
type FitPart = Extract<UIPart, { type: "tool-check_fit" }>
type ProposePart = Extract<UIPart, { type: "tool-propose_patches" }>

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
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const assistant = useAssistant({
    conversationId,
    resumeId,
    initialMessages: history.messages,
    initialStatuses: history.suggestions,
  })
  const { messages, status, statuses, deciding, decide } = assistant
  const busy = status === "submitted" || status === "streaming"

  const [draft, setDraft] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [targetPages, setTargetPages] = useState(1)
  const skill = skillOf(skillId)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll when anything new arrives, message or streamed part.
  const streamLength = messages.reduce((n, m) => n + m.parts.length, 0)
  useEffect(() => {
    if (streamLength === 0) return
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [streamLength])

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setDraft("")
    assistant.send(trimmed, {
      skillId,
      selectedNodeId,
      jobDescription: needs(skill, "jobDescription")
        ? jobDescription.trim() || undefined
        : undefined,
      targetPages: needs(skill, "targetPages") ? targetPages : undefined,
    })
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5"
      >
        {messages.length === 0 ? (
          <div className="rounded-[9px] border border-border bg-canvas p-3.5">
            <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
              Pick a skill, then say what you want changed. Every edit arrives
              as a card you accept or reject, and nothing touches the document
              until you do.
            </p>
          </div>
        ) : null}

        {messages.map((message) =>
          message.role === "user" ? (
            <UserBubble key={message.id} message={message} />
          ) : (
            <AssistantTurn
              key={message.id}
              message={message}
              statuses={statuses}
              busy={deciding}
              onDecide={decide}
            />
          )
        )}

        {status === "submitted" ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Spinner className="size-3.5" />
            Working through the resume
          </div>
        ) : null}

        {status === "error" ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            That request did not finish.
            <Button size="sm" variant="outline" onClick={assistant.retry}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex-none border-t border-border p-3.5">
        <div className="mb-2.5 flex flex-wrap gap-[7px]">
          {SKILLS.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={!available(option)}
              title={
                available(option)
                  ? option.description
                  : `${option.description} (not in this release)`
              }
              onClick={() => onSkillChange(option.id)}
              className={cn(
                "h-[26px] rounded-full border px-2.5 text-[11.5px] transition-colors",
                option.id === skillId
                  ? "border-transparent bg-primary font-medium text-primary-foreground"
                  : "border-border bg-paper text-foreground hover:bg-muted",
                !available(option) &&
                  "cursor-not-allowed opacity-40 hover:bg-paper"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {needs(skill, "targetPages") ? (
          <label className="mb-2.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
            Fit onto
            <input
              type="number"
              min={1}
              max={4}
              value={targetPages}
              onChange={(event) =>
                setTargetPages(clampPages(event.target.valueAsNumber))
              }
              className="h-[26px] w-14 rounded-[7px] border border-border bg-canvas px-2 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
            {targetPages === 1 ? "page" : "pages"}
          </label>
        ) : null}

        {needs(skill, "jobDescription") ? (
          <textarea
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            rows={3}
            placeholder="Paste the job description"
            className="mb-2.5 w-full resize-y rounded-[9px] border border-border bg-canvas px-2.5 py-2 text-[12px] leading-[1.5] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
          />
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
          className="flex items-center gap-2 rounded-[9px] border border-border px-2.5 py-2 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about this resume…"
            aria-label="Message the assistant"
            className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
          />
          {busy ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => void assistant.stop()}
              className="flex size-6 flex-none items-center justify-center rounded-md bg-muted text-foreground transition-colors hover:bg-border"
            >
              <StopIcon className="size-3" weight="fill" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim()}
              className="flex size-6 flex-none items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUpIcon className="size-3" weight="bold" />
            </button>
          )}
        </form>
      </div>
    </>
  )
}

function UserBubble({ message }: { message: ChatUIMessage }) {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-[10px] bg-primary px-3 py-2.5 text-[12.5px] leading-[1.55] text-primary-foreground">
        {text}
      </div>
    </div>
  )
}

/**
 * One assistant message, rendered part by part in the order the model
 * produced them: text as it streams, the fit check as a chip, the proposal
 * as cards. Nothing here is reshaped; the stream is the source of truth.
 */
function AssistantTurn({
  message,
  statuses,
  busy,
  onDecide,
}: {
  message: ChatUIMessage
  statuses: Record<string, SuggestionStatus>
  busy: boolean
  onDecide: (
    ids: string[],
    status: "accepted" | "rejected",
    runId: string
  ) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`
        if (part.type === "text") {
          if (part.text.length === 0) return null
          return (
            <div key={key} className="flex justify-start">
              <div className="max-w-[88%] rounded-[10px] bg-muted px-3 py-2.5 text-[12.5px] leading-[1.55] text-foreground">
                <MessageMarkdown mode="streaming">{part.text}</MessageMarkdown>
              </div>
            </div>
          )
        }
        if (part.type === "tool-check_fit") {
          return (
            <FitChip
              key={key}
              part={part}
              targetPages={message.metadata?.targetPages}
            />
          )
        }
        if (part.type === "tool-propose_patches") {
          return (
            <Proposal
              key={key}
              part={part}
              statuses={statuses}
              busy={busy}
              onDecide={onDecide}
            />
          )
        }
        return null
      })}
      {message.metadata?.stopped ? (
        <p className="text-[10.5px] text-muted-foreground">Stopped.</p>
      ) : null}
    </div>
  )
}

/**
 * Reports what the resume would come to with the drafted changes applied. The
 * count is measured from a real render in this browser, not estimated from
 * character counts, so it is the same number the export produces.
 */
function FitChip({
  part,
  targetPages,
}: {
  part: FitPart
  targetPages: number | undefined
}) {
  if (part.state === "output-error") return null

  if (part.state !== "output-available") {
    return (
      <span className="flex w-fit items-center gap-1.5 rounded-full bg-muted px-2 py-[3px] text-[10.5px] text-muted-foreground">
        <Spinner className="size-2.5" />
        Checking fit
      </span>
    )
  }

  const count = part.output.pageCount
  const pages = `${count} ${count === 1 ? "page" : "pages"}`
  const missedTarget = targetPages !== undefined && count > targetPages

  return (
    <span
      className={cn(
        "w-fit rounded-full px-2 py-0.75 text-[10.5px]",
        missedTarget
          ? "bg-flag/15 text-flag-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {missedTarget
        ? `Checked fit: ${pages}, still over your ${targetPages}-page target`
        : `Checked fit: ${pages}`}
    </span>
  )
}

function Proposal({
  part,
  statuses,
  busy,
  onDecide,
}: {
  part: ProposePart
  statuses: Record<string, SuggestionStatus>
  busy: boolean
  onDecide: (
    ids: string[],
    status: "accepted" | "rejected",
    runId: string
  ) => void
}) {
  if (part.state === "output-error") {
    return (
      <p className="text-[11px] text-muted-foreground">
        The suggestions could not be checked. Try sending the request again.
      </p>
    )
  }
  if (part.state !== "output-available") {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Spinner className="size-3.5" />
        Checking the suggestions
      </div>
    )
  }

  const { output } = part
  const suggestions: Suggestion[] = output.suggestions.map((s) => ({
    id: s.id,
    runId: output.runId,
    ordinal: s.ordinal,
    patch: s.patch,
    status: statuses[s.id] ?? "pending",
  }))

  return (
    <>
      {output.gaps.length > 0 ? (
        <div className="rounded-[9px] border border-border bg-canvas p-2.5">
          <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Missing details
          </p>
          <ul className="flex flex-col gap-0.5">
            {output.gaps.map((gap, index) => (
              <li
                // Gaps are plain strings off one finished tool result: never
                // reordered, no state, and two can read alike, so the text
                // alone is not a key.
                // biome-ignore lint/suspicious/noArrayIndexKey: stable within one result
                key={`${index}-${gap}`}
                className="text-[11.5px] text-foreground"
              >
                <MessageMarkdown>{gap}</MessageMarkdown>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SuggestionGroup
        runId={output.runId}
        suggestions={suggestions}
        rejected={output.rejected}
        busy={busy}
        onDecide={onDecide}
      />
      {output.followUpQuestion ? (
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-[10px] bg-muted px-3 py-2.5 text-[12.5px] leading-[1.55] text-foreground">
            <MessageMarkdown>{output.followUpQuestion}</MessageMarkdown>
          </div>
        </div>
      ) : null}
    </>
  )
}

/** Keeps the page target usable when the number input is cleared or pasted into. */
function clampPages(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(4, Math.max(1, Math.round(value)))
}

function SuggestionGroup({
  runId,
  suggestions,
  rejected,
  busy,
  onDecide,
}: {
  runId: string
  suggestions: Suggestion[]
  rejected: RejectedPatch[]
  busy: boolean
  onDecide: (
    ids: string[],
    status: "accepted" | "rejected",
    runId: string
  ) => void
}) {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const pending = suggestions.filter((s) => s.status === "pending")

  if (suggestions.length === 0 && rejected.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          resume={doc}
          busy={busy}
          onHover={(hovering) =>
            session.previewPatches(hovering ? [suggestion.patch] : [])
          }
          onAccept={() => onDecide([suggestion.id], "accepted", runId)}
          onReject={() => onDecide([suggestion.id], "rejected", runId)}
        />
      ))}

      {pending.length > 1 ? (
        <div className="flex gap-[7px]">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              onDecide(
                pending.map((s) => s.id),
                "accepted",
                runId
              )
            }
          >
            Accept all {pending.length}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              onDecide(
                pending.map((s) => s.id),
                "rejected",
                runId
              )
            }
          >
            Dismiss all
          </Button>
        </div>
      ) : null}

      {rejected.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="w-full rounded-[7px] border border-dashed border-border px-2.5 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted"
              >
                {rejected.length}{" "}
                {rejected.length === 1 ? "suggestion was" : "suggestions were"}{" "}
                discarded before you saw {rejected.length === 1 ? "it" : "them"}
              </button>
            }
          />
          <CollapsibleContent>
            <ul className="mt-1.5 flex flex-col gap-1 rounded-[7px] bg-canvas p-2.5">
              {rejected.map((entry) => (
                <li
                  key={`${entry.index}-${entry.code}`}
                  className="text-[11px] text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {entry.code}
                  </span>{" "}
                  {REJECTION_HELP[entry.code] ?? entry.message}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

const REJECTION_HELP: Record<string, string> = {
  UNGROUNDED_NUMBER:
    "used a figure that appears nowhere in your resume or your message.",
  OP_NOT_ALLOWED: "tried a kind of change this skill is not allowed to make.",
  OUT_OF_SCOPE: "tried to edit something outside the part you selected.",
  BEFORE_MISMATCH: "was written against text that has since changed.",
  FIELD_NOT_ALLOWED: "tried to write a field it may not touch.",
  TARGET_NOT_FOUND: "pointed at something that is no longer in the resume.",
  EMPTY_TEXT: "would have left the text empty.",
  SCHEMA_INVALID: "was not a well-formed change.",
}
