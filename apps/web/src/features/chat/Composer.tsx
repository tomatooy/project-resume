import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { useRef } from "react"

import { skillsQuery } from "@/lib/queries"
import { useResumeState } from "../resume/session-context"
import type { SendOptions } from "./use-assistant"

/**
 * Where a turn is put together: the message, the skill chip that shortcuts it,
 * and the flag that allows structural edits.
 *
 * A chip is a shortcut, not a mode. Tapping one writes its starter into the
 * box, remembers the id as a hint and puts the cursor back in the box; typing
 * anything clears the hint, because a hint the text no longer reflects is a
 * lie. What the model may do comes from the request (the structural toggle)
 * and the user's per-patch accept, never from a chip.
 *
 * The chips are the user's live library: the six built-ins minus whatever they
 * switched off, plus what they wrote. Disabled and deleted skills are not
 * offered, which is what "disabled" means.
 */
export function Composer({
  draft,
  onDraftChange,
  hintSkillId,
  onHintChange,
  structural,
  onStructuralChange,
  busy,
  onSend,
  onStop,
}: {
  draft: string
  onDraftChange: (text: string) => void
  hintSkillId?: string
  onHintChange: (skillId: string | undefined) => void
  structural: boolean
  onStructuralChange: (structural: boolean) => void
  busy: boolean
  onSend: (text: string, options: SendOptions) => void
  onStop: () => void
}) {
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const { data: skills } = useQuery(skillsQuery())
  const input = useRef<HTMLInputElement | null>(null)

  const options = (skills ?? []).filter(
    (skill) => skill.enabled && !skill.deleted
  )

  function send() {
    const trimmed = draft.trim()
    if (!trimmed || busy) return
    onDraftChange("")
    onSend(trimmed, {
      hintSkillId,
      selectedNodeId,
      structural,
    })
  }

  /** A skill with no starter is still a hint; the box is the user's to fill. */
  function applyStarter(skillId: string, starter?: string) {
    if (starter) onDraftChange(starter)
    onHintChange(skillId)
    input.current?.focus()
  }

  return (
    <div className="flex-none border-t border-border p-3.5">
      <div className="mx-auto w-full min-w-0 max-w-4xl">
        <div className="mb-2.5 flex flex-wrap gap-[7px]">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              title={[
                option.description,
                option.whenToUse,
                option.notFor ? `Not for: ${option.notFor}` : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => applyStarter(option.id, option.starter)}
              className={cn(
                "h-[26px] rounded-full border px-2.5 text-[11.5px] transition-colors",
                option.id === hintSkillId
                  ? "border-transparent bg-primary font-medium text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted"
              )}
            >
              {option.name}
            </button>
          ))}
        </div>

        <div className="mb-2.5 flex items-center gap-2">
          <Switch
            checked={structural}
            onCheckedChange={onStructuralChange}
            aria-label="Allow removing and restructuring"
          />
          <span
            className="text-[11.5px] text-muted-foreground"
            title="Off, the assistant only rewrites what is already there. On, a turn may also propose removing an item or a section, adding one, or moving a bullet to another entry."
          >
            Allow removing and restructuring
          </span>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
          className="flex items-center gap-2 rounded-[9px] border border-border px-2.5 py-2 focus-within:border-primary"
        >
          <input
            ref={input}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value)
              // Editing by hand is the user taking the turn back.
              if (hintSkillId) onHintChange(undefined)
            }}
            placeholder="Ask about this resume…"
            aria-label="Message the assistant"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
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
    </div>
  )
}
