import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"

import { SKILLS, available, needs, skillOf } from "@/lib/skills"
import type { SkillId } from "@/lib/types"
import { useResumeState } from "../resume/session-context"
import type { SendOptions } from "./use-assistant"

/**
 * Where a turn is put together: the skill, the inputs that skill asks for,
 * and the message. Hands the finished turn up as one value, so the panel
 * never has to know which skill wanted a job description.
 */
export function Composer({
  skillId,
  onSkillChange,
  busy,
  onSend,
  onStop,
}: {
  skillId: SkillId
  onSkillChange: (skillId: SkillId) => void
  busy: boolean
  onSend: (text: string, options: SendOptions) => void
  onStop: () => void
}) {
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const [draft, setDraft] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [targetPages, setTargetPages] = useState(1)
  const skill = skillOf(skillId)

  function send() {
    const trimmed = draft.trim()
    if (!trimmed || busy) return
    setDraft("")
    onSend(trimmed, {
      skillId,
      selectedNodeId,
      jobDescription: needs(skill, "jobDescription")
        ? jobDescription.trim() || undefined
        : undefined,
      targetPages: needs(skill, "targetPages") ? targetPages : undefined,
    })
  }

  return (
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
          send()
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
            onClick={onStop}
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
  )
}

/** Keeps the page target usable when the number input is cleared or pasted into. */
function clampPages(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(4, Math.max(1, Math.round(value)))
}
