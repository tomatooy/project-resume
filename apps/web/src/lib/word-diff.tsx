import { cn } from "@workspace/ui/lib/utils"
import { diffWords } from "diff"
import { useMemo } from "react"

/**
 * Word-level diff, so a small rewrite reads as a small rewrite.
 *
 * Shared by the assistant's suggestion cards and the versions panel: both
 * answer "what did this do to the sentence?", and a reader who has learned to
 * read one should not have to learn the other.
 *
 * A `span` rather than a `p` because the versions panel nests it inside a line
 * of running text, where a block element would be invalid.
 */
export function WordDiff({
  before,
  after,
  className,
}: {
  before: string
  after: string
  className?: string
}) {
  const parts = useMemo(() => diffWords(before, after), [before, after])

  return (
    <span className={cn("block text-[12.5px] leading-[1.55]", className)}>
      {parts.map((part) => {
        // A diff part is uniquely identified by its marker plus its text.
        const key = `${part.added ? "+" : part.removed ? "-" : "="}${part.value}`
        if (part.added) {
          return (
            <span
              key={key}
              className="rounded-[2px] bg-success/10 font-medium text-success"
            >
              {part.value}
            </span>
          )
        }
        if (part.removed) {
          return (
            <span
              key={key}
              className="bg-destructive/10 text-destructive line-through decoration-current"
            >
              {part.value}
            </span>
          )
        }
        return <span key={key}>{part.value}</span>
      })}
    </span>
  )
}
