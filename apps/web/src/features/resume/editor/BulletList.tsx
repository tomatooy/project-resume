import { TrashIcon } from "@phosphor-icons/react"
import type { Bullet } from "@workspace/resume-schema"
import { cn } from "@workspace/ui/lib/utils"
import { useRef } from "react"

import { addBullet, moveNode, removeNode, setText } from "../actions"
import { bulletNeedsMetric } from "../flags"
import { useSession } from "../session-context"
import { SortableList, SortableRow } from "./SortableRow"

/**
 * Achievements for one item. Enter adds the next bullet, Backspace on an empty
 * one removes it, which is how a list of bullets is actually written.
 */
export function BulletList({
  itemId,
  bullets,
}: {
  itemId: string
  bullets: Bullet[]
}) {
  const session = useSession()
  const refs = useRef(new Map<string, HTMLTextAreaElement>())

  const focusBullet = (id: string) => {
    requestAnimationFrame(() => {
      const el = refs.current.get(id)
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <SortableList
        ids={bullets.map((b) => b.id)}
        onReorder={(id, toIndex) => moveNode(session, id, toIndex)}
        className="flex flex-col gap-2"
      >
        {bullets.map((bullet, index) => {
          const weak = bulletNeedsMetric(bullet.text)
          return (
            <SortableRow
              key={bullet.id}
              id={bullet.id}
              handleLabel="Reorder bullet"
            >
              {(handle) => (
                <div
                  className={cn(
                    "group/bullet rounded-[9px] border bg-paper transition-colors",
                    weak ? "border-flag/40 bg-flag/4" : "border-border"
                  )}
                >
                  <div className="flex items-start gap-2 px-2 py-2.5">
                    <div className="mt-0.5">{handle}</div>
                    <textarea
                      ref={(node) => {
                        if (node) refs.current.set(bullet.id, node)
                        else refs.current.delete(bullet.id)
                      }}
                      value={bullet.text}
                      rows={1}
                      aria-label={`Achievement ${index + 1}`}
                      onFocus={() => session.select(bullet.id)}
                      onChange={(event) =>
                        setText(session, bullet.id, "text", event.target.value)
                      }
                      onInput={(event) => {
                        // Grow to fit, so a long bullet is fully readable.
                        const el = event.currentTarget
                        el.style.height = "auto"
                        el.style.height = `${el.scrollHeight}px`
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault()
                          addBullet(session, itemId, bullet.id)
                          const next = session.state.doc.sections
                            .flatMap((s) => s.items)
                            .find((i) => i.id === itemId)
                          if (next && "bullets" in next) {
                            const created = next.bullets[index + 1]
                            if (created) focusBullet(created.id)
                          }
                        }
                        if (
                          event.key === "Backspace" &&
                          bullet.text.trim() === "" &&
                          bullets.length > 1
                        ) {
                          event.preventDefault()
                          const previous = bullets[index - 1]
                          removeNode(session, bullet.id)
                          if (previous) focusBullet(previous.id)
                        }
                      }}
                      className="min-h-[20px] flex-1 resize-none bg-transparent text-[12.5px] leading-[1.55] outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Delete achievement"
                      disabled={bullets.length <= 1}
                      onClick={() => removeNode(session, bullet.id)}
                      className="flex size-6 flex-none items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/bullet:opacity-100 hover:bg-muted hover:text-destructive focus-visible:opacity-100 disabled:pointer-events-none"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </div>

                  {weak ? (
                    <p className="px-2 pb-2 pl-9 text-[10.5px] text-flag-foreground">
                      No measurable outcome. Add a number, a scale, or a
                      timeframe.
                    </p>
                  ) : null}
                </div>
              )}
            </SortableRow>
          )
        })}
      </SortableList>

      <button
        type="button"
        onClick={() => {
          addBullet(session, itemId, bullets.at(-1)?.id ?? null)
          const item = session.state.doc.sections
            .flatMap((s) => s.items)
            .find((i) => i.id === itemId)
          if (item && "bullets" in item) {
            const created = item.bullets.at(-1)
            if (created) focusBullet(created.id)
          }
        }}
        className="h-[33px] rounded-[7px] border border-dashed border-border px-3 text-left text-[12px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        + Add achievement
      </button>
    </div>
  )
}
