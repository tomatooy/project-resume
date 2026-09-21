import { type RejectedPatch, structuralReason } from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Spinner } from "@workspace/ui/components/spinner"
import { useEffect, useRef } from "react"

import { useSkillNames } from "@/lib/queries"
import type { ChatUIMessage, Suggestion, SuggestionStatus } from "@/lib/types"
import { useResumeState, useSession } from "../resume/session-context"
import { MessageMarkdown } from "./MessageMarkdown"
import { SuggestionCard } from "./SuggestionCard"
import type { useAssistant } from "./use-assistant"

type UIPart = ChatUIMessage["parts"][number]
type FitPart = Extract<UIPart, { type: "tool-check_fit" }>
type PlanPart = Extract<UIPart, { type: "tool-plan" }>
type ProposePart = Extract<UIPart, { type: "tool-propose_patches" }>

type Assistant = ReturnType<typeof useAssistant>
type Decide = Assistant["decide"]

/**
 * The conversation so far, drawn straight from the stream: user bubbles,
 * assistant text as it arrives, the turn's plan line, the fit check as a chip,
 * and each proposal as cards the user decides on. Keeps itself scrolled to the
 * newest part.
 */
export function Transcript({
  messages,
  status,
  statuses,
  deciding,
  hintSkillId,
  onDecide,
  onRetry,
  onEnableStructural,
  onUseSkill,
}: {
  messages: ChatUIMessage[]
  status: Assistant["status"]
  statuses: Record<string, SuggestionStatus>
  deciding: boolean
  hintSkillId?: string
  onDecide: Decide
  onRetry: () => void
  onEnableStructural: () => void
  onUseSkill: (skillId: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Names for ids that came back without one (`alreadyLoaded`) or that belong
  // to a skill the user has since removed; every row, deleted included.
  const names = useSkillNames()

  // Scroll when anything new arrives, message or streamed part.
  const streamLength = messages.reduce((n, m) => n + m.parts.length, 0)
  useEffect(() => {
    if (streamLength === 0) return
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [streamLength])

  const last = messages.at(-1)
  const streaming = last?.role === "assistant" ? last : undefined
  // The plan line takes over from the status line the moment it lands, and it
  // lands inside the message, so the status line only covers the wait before
  // it. The hint comes off the message, not the composer's state: editing the
  // box while a turn runs must not relabel a turn already in flight.
  const hint = streaming?.metadata?.hintSkillId ?? hintSkillId
  const hinted = hint ? names[hint] : undefined
  const planLanded = streaming?.parts.some((part) => part.type === "tool-plan")
  const busy = status === "submitted" || status === "streaming"

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5"
    >
      {messages.length === 0 ? (
        <div className="rounded-[9px] border border-border bg-canvas p-3.5">
          <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
            Say what you want changed. The assistant picks a playbook from its
            library, says what it is about to do, then sends every edit as a
            card you accept or reject. Nothing touches the document until you
            accept it, and adding or removing whole entries stays off until you
            allow it under Context.
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
            names={names}
            statuses={statuses}
            busy={deciding}
            onDecide={onDecide}
            onEnableStructural={onEnableStructural}
            onUseSkill={onUseSkill}
          />
        )
      )}

      {busy && !planLanded ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Spinner className="size-3.5" />
          {hinted ?? "Working through the resume"}
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
 * produced them: the plan line, text as it streams, the fit check as a chip,
 * the proposal as a summary and cards. Nothing here is reshaped; the stream is
 * the source of truth.
 */
function AssistantTurn({
  message,
  names,
  statuses,
  busy,
  onDecide,
  onEnableStructural,
  onUseSkill,
}: {
  message: ChatUIMessage
  names: Record<string, string>
  statuses: Record<string, SuggestionStatus>
  busy: boolean
  onDecide: Decide
  onEnableStructural: () => void
  onUseSkill: (skillId: string) => void
}) {
  // The chips are read off the load results rather than off the plan's intent:
  // a playbook the model said it would load and never did is not a chip, and
  // since `plan` is optional a turn can load several without ever planning.
  // Deduped by id in arrival order: a turn can load the same playbook twice,
  // and a continuation can reload one the message already carries.
  const planSkills: { id: string; name: string }[] = []
  const seen = new Set<string>()
  const addSkill = (id: string, name: string) => {
    if (seen.has(id)) return
    seen.add(id)
    planSkills.push({ id, name })
  }
  for (const part of message.parts) {
    if (part.type !== "tool-load_skill" || part.state !== "output-available") {
      continue
    }
    for (const skill of part.output.loaded) addSkill(skill.id, skill.name)
    for (const id of part.output.alreadyLoaded) {
      addSkill(id, names[id] ?? id)
    }
  }
  // The chips cannot hang off the plan's part alone: a turn that skipped
  // `plan` would then hide every playbook it loaded.
  const hasPlanPart = message.parts.some((part) => part.type === "tool-plan")

  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`
        if (part.type === "tool-plan") {
          return (
            <PlanLine
              key={key}
              part={part}
              skills={planSkills}
              names={names}
              onUseSkill={onUseSkill}
            />
          )
        }
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
          return <FitChip key={key} part={part} />
        }
        if (part.type === "tool-propose_patches") {
          return (
            <Proposal
              key={key}
              part={part}
              statuses={statuses}
              busy={busy}
              onDecide={onDecide}
              onEnableStructural={onEnableStructural}
            />
          )
        }
        return null
      })}
      {!hasPlanPart && planSkills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <PlaybookChips
            skills={planSkills}
            names={names}
            onUseSkill={onUseSkill}
          />
        </div>
      ) : null}
      {message.metadata?.stopped ? (
        <p className="text-[10.5px] text-muted-foreground">Stopped.</p>
      ) : null}
    </div>
  )
}

/**
 * The playbooks this turn loaded, as chips. A chip runs one playbook on its
 * own, which is how a user who wanted only one of them asks for it.
 */
function PlaybookChips({
  skills,
  names,
  onUseSkill,
}: {
  skills: { id: string; name: string }[]
  names: Record<string, string>
  onUseSkill: (skillId: string) => void
}) {
  return skills.map((skill) => {
    // A name that no longer resolves is a playbook from a library this user no
    // longer has; the chip stays as a record of the turn, not as an action.
    const name = names[skill.id]
    if (!name) {
      return (
        <span
          key={skill.id}
          className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
        >
          {skill.name}
        </span>
      )
    }
    return (
      <button
        key={skill.id}
        type="button"
        title={`Run just this playbook: ${name}`}
        onClick={() => onUseSkill(skill.id)}
        className="rounded-full border border-border bg-paper px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {skill.name}
      </button>
    )
  })
}

/**
 * The turn's opening line, as the model wrote it, with the playbooks it
 * actually loaded beside it.
 */
function PlanLine({
  part,
  skills,
  names,
  onUseSkill,
}: {
  part: PlanPart
  skills: { id: string; name: string }[]
  names: Record<string, string>
  onUseSkill: (skillId: string) => void
}) {
  if (part.state !== "output-available") return null

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-[11.5px] leading-[1.5] text-muted-foreground">
        <span className="font-medium text-foreground">Plan. </span>
        {part.output.summary}
      </span>
      <PlaybookChips skills={skills} names={names} onUseSkill={onUseSkill} />
    </div>
  )
}

/**
 * Reports what the resume would come to with the drafted changes applied. The
 * count is measured from a real render in this browser, not estimated from
 * character counts, so it is the same number the export produces.
 */
function FitChip({ part }: { part: FitPart }) {
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

  return (
    <span className="w-fit rounded-full bg-muted px-2 py-0.75 text-[10.5px] text-muted-foreground">
      Checked fit: {pages}
    </span>
  )
}

function Proposal({
  part,
  statuses,
  busy,
  onDecide,
  onEnableStructural,
}: {
  part: ProposePart
  statuses: Record<string, SuggestionStatus>
  busy: boolean
  onDecide: Decide
  onEnableStructural: () => void
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
  const structuralRefused = output.rejected.some(
    (entry) => entry.code === "STRUCTURAL_NOT_REQUESTED"
  )

  return (
    <>
      {output.summary ? (
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-[10px] bg-muted px-3 py-2.5 text-[12.5px] leading-[1.55] text-foreground">
            <MessageMarkdown>{output.summary}</MessageMarkdown>
          </div>
        </div>
      ) : null}
      <SuggestionGroup
        runId={output.runId}
        suggestions={suggestions}
        rejected={output.rejected}
        busy={busy}
        onDecide={onDecide}
        onEnableStructural={onEnableStructural}
        structuralRefused={structuralRefused}
      />
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
  onEnableStructural,
  structuralRefused,
}: {
  runId: string
  suggestions: Suggestion[]
  rejected: RejectedPatch[]
  busy: boolean
  onDecide: Decide
  onEnableStructural: () => void
  structuralRefused: boolean
}) {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const pending = suggestions.filter((s) => s.status === "pending")
  // Accept all is the bulk path for edits that keep the document's shape.
  // Adding, removing and cross-container moves stay one at a time, the same
  // way they stay one at a time on the server.
  const bulk = pending.filter(
    (s) => structuralReason(doc, s.patch) === undefined
  )

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

      {bulk.length > 1 ? (
        <div className="flex gap-[7px]">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              onDecide(
                bulk.map((s) => s.id),
                "accepted",
                runId
              )
            }
          >
            Accept all {bulk.length}
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

      {structuralRefused ? (
        <StructuralOffer onEnableStructural={onEnableStructural} busy={busy} />
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

/**
 * The refusal is not a dead end. A turn that wanted to remove something was
 * refused by a gate only the user can open, so the gate is offered here:
 * pressing it turns the toggle on and asks the same question again.
 */
function StructuralOffer({
  onEnableStructural,
  busy,
}: {
  onEnableStructural: () => void
  busy: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[9px] border border-destructive/30 bg-destructive/5 p-2.5">
      <span className="text-[11.5px] text-foreground">
        This asked to add, remove or move whole entries, which is off for this
        turn.
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={onEnableStructural}
      >
        Allow it and ask again
      </Button>
    </div>
  )
}

const REJECTION_HELP: Record<string, string> = {
  OP_NOT_ALLOWED: "tried a kind of change this turn is not allowed to make.",
  OUT_OF_SCOPE: "tried to edit something outside the part you selected.",
  BEFORE_MISMATCH: "was written against text that has since changed.",
  FIELD_NOT_ALLOWED: "tried to write a field it may not touch.",
  TARGET_NOT_FOUND: "pointed at something that is no longer in the resume.",
  PARENT_NOT_FOUND: "pointed at a container that is no longer in the resume.",
  EMPTY_TEXT: "would have left the text empty.",
  SCHEMA_INVALID: "was not a well-formed change.",
  KIND_MISMATCH: "put a node somewhere that does not accept it.",
  INDEX_OUT_OF_RANGE: "asked for a position past the end of the list.",
  REQUIRED_FIELD: "would have cleared a field the resume needs.",
  STRUCTURAL_NOT_REQUESTED:
    "changes the shape of the resume, which was not allowed for that turn.",
}
