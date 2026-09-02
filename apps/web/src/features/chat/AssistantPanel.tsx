import { ArrowUpIcon, XIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
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
import { toast } from "sonner"

import { decideSuggestions } from "@/lib/api"
import { runAssistant } from "@/lib/assistant"
import { qk } from "@/lib/query-keys"
import { DEFAULT_SKILL, SKILLS, skillById } from "@/lib/skills"
import type { SkillId, Suggestion } from "@/lib/types"
import { breadcrumbOf } from "../resume/breadcrumb"
import { useResumeState, useSession } from "../resume/session-context"
import { SuggestionCard } from "./SuggestionCard"

/** Result of the page-fit measurement taken once a run has produced cards. */
type Fit =
  | { state: "pending" }
  | { state: "ready"; pageCount: number; targetPages?: number }
  | { state: "failed" }

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string
      role: "assistant"
      text: string
      runId?: string
      rejected?: RejectedPatch[]
      demo?: boolean
      fit?: Fit
    }

export function AssistantPanel({ onClose }: { onClose?: () => void }) {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const resumeId = useResumeState((s) => s.resumeId)
  const conversationId = useResumeState((s) => s.conversationId)
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const templateId = useResumeState((s) => s.templateId)
  const templateOptions = useResumeState((s) => s.templateOptions)
  const queryClient = useQueryClient()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [skillId, setSkillId] = useState<SkillId>(DEFAULT_SKILL)
  const [draft, setDraft] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [targetPages, setTargetPages] = useState(1)
  const [running, setRunning] = useState(false)
  const [deciding, setDeciding] = useState(false)

  const skill = skillById.get(skillId)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll when anything new arrives, message or card.
  const streamLength = messages.length + suggestions.length
  useEffect(() => {
    if (streamLength === 0) return
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [streamLength])

  async function send(text: string) {
    if (!text.trim() || running) return
    setDraft("")
    setMessages((prev) => [
      ...prev,
      { id: `u${Date.now()}`, role: "user", text: text.trim() },
    ])
    setRunning(true)

    try {
      const wantsTarget = skill?.needsTargetPages === true
      const run = await runAssistant({
        resumeId,
        conversationId,
        resume: doc,
        skillId,
        message: text.trim(),
        selectedNodeId,
        jobDescription: jobDescription.trim() || undefined,
        targetPages: wantsTarget ? targetPages : undefined,
      })
      setSuggestions((prev) => [...prev, ...run.suggestions])
      setMessages((prev) => [
        ...prev,
        {
          id: run.runId,
          role: "assistant",
          text: run.text,
          runId: run.runId,
          rejected: run.rejected,
          demo: run.demo,
          fit: run.suggestions.length > 0 ? { state: "pending" } : undefined,
        },
      ])

      // Measured after the cards are on screen rather than before, because
      // rendering a whole PDF takes long enough to be felt. The chip fills in
      // a moment later; the cards do not wait on it.
      if (run.suggestions.length > 0) {
        // Imported here rather than at the top of the file because pdf.js
        // touches DOMMatrix on load, which does not exist while the panel is
        // being server-rendered. The same reason PdfViewer is lazy.
        const { checkFit } = await import("../resume/preview/check-fit")
        const result = await checkFit({
          resume: doc,
          templateId,
          options: templateOptions,
          patches: run.suggestions.map((suggestion) => suggestion.patch),
        })
        const fit: Fit = result.ok
          ? {
              state: "ready",
              pageCount: result.pageCount,
              targetPages: wantsTarget ? targetPages : undefined,
            }
          : { state: "failed" }
        setMessages((prev) =>
          prev.map((message) =>
            message.id === run.runId && message.role === "assistant"
              ? { ...message, fit }
              : message
          )
        )
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e${Date.now()}`,
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "Something went wrong reaching the assistant.",
        },
      ])
    } finally {
      setRunning(false)
    }
  }

  async function decide(
    ids: string[],
    status: "accepted" | "rejected",
    runId: string
  ) {
    if (ids.length === 0) return
    setDeciding(true)
    session.previewPatches([])
    try {
      const result = await decideSuggestions({
        runId,
        decisions: ids.map((suggestionId) => ({ suggestionId, status })),
      })
      session.replaceHead(result.head, result.revision, result.updatedAt)
      setSuggestions((prev) =>
        prev.map((suggestion) => {
          const outcome = result.results.find(
            (r) => r.suggestionId === suggestion.id
          )
          return outcome
            ? { ...suggestion, status: outcome.status }
            : suggestion
        })
      )
      if (result.version) {
        await queryClient.invalidateQueries({ queryKey: qk.versions(resumeId) })
      }
      const stale = result.results.filter((r) => r.status === "stale").length
      if (stale > 0) {
        toast.warning(
          `${stale} ${stale === 1 ? "suggestion" : "suggestions"} no longer matched the text`
        )
      }
    } finally {
      setDeciding(false)
    }
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper">
      <header className="flex h-11 flex-none items-center gap-[9px] border-b border-border px-3.5">
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

        {messages.map((message) => (
          <div key={message.id} className="flex flex-col gap-2">
            <div
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[88%] rounded-[10px] px-3 py-2.5 text-[12.5px] leading-[1.55]",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                )}
              >
                {message.text}
              </div>
            </div>

            {message.role === "assistant" && message.demo ? (
              <p className="text-[10.5px] text-muted-foreground">
                Demo mode: no model is connected yet, so these cards come from a
                fixed script. The validation and accept flow around them is
                real.
              </p>
            ) : null}

            {message.role === "assistant" && message.fit ? (
              <FitChip fit={message.fit} />
            ) : null}

            {message.role === "assistant" && message.runId ? (
              <SuggestionGroup
                runId={message.runId}
                suggestions={suggestions.filter(
                  (s) => s.runId === message.runId
                )}
                rejected={message.rejected ?? []}
                busy={deciding}
                onDecide={decide}
              />
            ) : null}
          </div>
        ))}

        {running ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Spinner className="size-3.5" />
            Working through the resume
          </div>
        ) : null}
      </div>

      <div className="flex-none border-t border-border p-3.5">
        <div className="mb-2.5 flex flex-wrap gap-[7px]">
          {SKILLS.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={!option.available}
              title={
                option.available
                  ? option.description
                  : `${option.description} (not in this release)`
              }
              onClick={() => setSkillId(option.id)}
              className={cn(
                "h-[26px] rounded-full border px-2.5 text-[11.5px] transition-colors",
                option.id === skillId
                  ? "border-transparent bg-ink font-medium text-background"
                  : "border-border bg-paper text-foreground hover:bg-muted",
                !option.available &&
                  "cursor-not-allowed opacity-40 hover:bg-paper"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {skill?.needsTargetPages ? (
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

        {skill?.needsJobDescription ? (
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
            void send(draft)
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
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim() || running}
            className="flex size-6 flex-none items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <ArrowUpIcon className="size-3" weight="bold" />
          </button>
        </form>
      </div>
    </aside>
  )
}

/**
 * Reports what the resume would come to with this run's changes applied. The
 * count is measured from a real render, not estimated from character counts,
 * so it is the same number the export produces.
 */
function FitChip({ fit }: { fit: Fit }) {
  if (fit.state === "failed") return null

  if (fit.state === "pending") {
    return (
      <span className="flex w-fit items-center gap-1.5 rounded-full bg-muted px-2 py-[3px] text-[10.5px] text-muted-foreground">
        <Spinner className="size-2.5" />
        Checking fit
      </span>
    )
  }

  const pages = `${fit.pageCount} ${fit.pageCount === 1 ? "page" : "pages"}`
  const missedTarget =
    fit.targetPages !== undefined && fit.pageCount > fit.targetPages

  return (
    <span
      className={cn(
        "w-fit rounded-full px-2 py-[3px] text-[10.5px]",
        missedTarget
          ? "bg-flag/15 text-flag-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {missedTarget
        ? `Checked fit: ${pages}, still over your ${fit.targetPages}-page target`
        : `Checked fit: ${pages}`}
    </span>
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
