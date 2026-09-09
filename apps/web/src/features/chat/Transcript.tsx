import type { RejectedPatch } from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef } from "react"

import type { ChatUIMessage, Suggestion, SuggestionStatus } from "@/lib/types"
import { useResumeState, useSession } from "../resume/session-context"
import { MessageMarkdown } from "./MessageMarkdown"
import { SuggestionCard } from "./SuggestionCard"
import type { useAssistant } from "./use-assistant"

type UIPart = ChatUIMessage["parts"][number]
type FitPart = Extract<UIPart, { type: "tool-check_fit" }>
type ProposePart = Extract<UIPart, { type: "tool-propose_patches" }>

type Assistant = ReturnType<typeof useAssistant>
type Decide = Assistant["decide"]

/**
 * The conversation so far, drawn straight from the stream: user bubbles,
 * assistant text as it arrives, the fit check as a chip, and each proposal as
 * cards the user decides on. Keeps itself scrolled to the newest part.
 */
export function Transcript({
  messages,
  status,
  statuses,
  deciding,
  onDecide,
  onRetry,
}: {
  messages: ChatUIMessage[]
  status: Assistant["status"]
  statuses: Record<string, SuggestionStatus>
  deciding: boolean
  onDecide: Decide
  onRetry: () => void
}) {
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

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5"
    >
      {messages.length === 0 ? (
        <div className="rounded-[9px] border border-border bg-canvas p-3.5">
          <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
            Pick a skill, then say what you want changed. Every edit arrives as
            a card you accept or reject, and nothing touches the document until
            you do.
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
            onDecide={onDecide}
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
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
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
  onDecide: Decide
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
  onDecide: Decide
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
  onDecide: Decide
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
  OP_NOT_ALLOWED: "tried a kind of change this skill is not allowed to make.",
  OUT_OF_SCOPE: "tried to edit something outside the part you selected.",
  BEFORE_MISMATCH: "was written against text that has since changed.",
  FIELD_NOT_ALLOWED: "tried to write a field it may not touch.",
  TARGET_NOT_FOUND: "pointed at something that is no longer in the resume.",
  EMPTY_TEXT: "would have left the text empty.",
  SCHEMA_INVALID: "was not a well-formed change.",
}
