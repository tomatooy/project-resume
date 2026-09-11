import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import { SKILL_META } from "@/lib/skills"
import type { SkillId } from "@/lib/types"
import { useResumeState } from "../resume/session-context"
import type { SendOptions } from "./use-assistant"

/**
 * Where a turn is put together: the message, the playbook chip that shortcut
 * it, and the flag that allows structural edits.
 *
 * A chip is a shortcut, not a mode. Tapping one writes its starter into the
 * box and remembers the id as a hint; typing anything clears the hint, because
 * a hint the text no longer reflects is a lie. What the model may do comes
 * from the request (the structural toggle) and the user's per-patch accept,
 * never from a chip.
 *
 * The job description and the page target used to sit in a context strip here.
 * Both are the message's job now: a posting is pasted into the turn, and the
 * page count is measured only when the turn asks about length, so neither has
 * a slot the request can preset.
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
  hintSkillId?: SkillId
  onHintChange: (skillId: SkillId | undefined) => void
  structural: boolean
  onStructuralChange: (structural: boolean) => void
  busy: boolean
  onSend: (text: string, options: SendOptions) => void
  onStop: () => void
}) {
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)

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

  function applyStarter(skillId: SkillId, starter: string) {
    onDraftChange(starter)
    onHintChange(skillId)
  }

  return (
    <div className="flex-none border-t border-border p-3.5">
      <div className="mb-2.5 flex flex-wrap gap-[7px]">
        {SKILL_META.map((option) => (
          <button
            key={option.id}
            type="button"
            title={`${option.whenToUse} Not for: ${option.notFor}`}
            onClick={() => applyStarter(option.id, option.starter)}
            className={cn(
              "h-[26px] rounded-full border px-2.5 text-[11.5px] transition-colors",
              option.id === hintSkillId
                ? "border-transparent bg-primary font-medium text-primary-foreground"
                : "border-border bg-paper text-foreground hover:bg-muted"
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
        className="flex items-center gap-2 rounded-[9px] border border-border px-2.5 py-2 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20"
      >
        <input
          value={draft}
          onChange={(event) => {
            onDraftChange(event.target.value)
            // Editing by hand is the user taking the turn back.
            if (hintSkillId) onHintChange(undefined)
          }}
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
