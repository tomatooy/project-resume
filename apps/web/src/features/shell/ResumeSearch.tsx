import { FileTextIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef, type ReactNode } from "react"

import { absoluteTime, relativeTime } from "@/lib/format"
import type { ResumeSearch, ResumeSearchGroup, TextRange } from "@/lib/types"
import { RailSkeleton } from "./RailSkeleton"

/**
 * The rail's search: the field that replaces the header's label, and the
 * results that replace the resume list while a query is up.
 *
 * Both live here because they are one gesture. `ResumeRail` owns the state
 * (open, query, debounce) and hands it down, so the header toggle and the
 * results cannot disagree about whether a search is running.
 */

type SearchFieldProps = {
  open: boolean
  value: string
  onValueChange: (next: string) => void
  onClose: () => void
}

export function SearchField({
  open,
  value,
  onValueChange,
  onClose,
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus once the cell has width. While the field is closed the input is
  // mounted but inert, and an inert, zero-width input cannot take focus.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return (
    // `ring-inset`: the cell clips its overflow, so an outward focus ring
    // would be cut off on all four sides.
    <InputGroup className="h-6 rounded-[7px] ring-inset">
      <InputGroupAddon className="py-0">
        <MagnifyingGlassIcon aria-hidden className="size-3.5" />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        value={value}
        aria-label="Search resumes"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search resumes"
        className="h-6 px-1.5 text-[12.5px]"
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          // The editor listens for Escape on window to clear the selected
          // node. Inside the field, closing it is the whole gesture.
          event.stopPropagation()
          onClose()
        }}
      />
      {value.length > 0 && (
        <InputGroupAddon align="inline-end" className="py-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => {
                    onValueChange("")
                    inputRef.current?.focus()
                  }}
                >
                  <XIcon weight="bold" />
                </InputGroupButton>
              }
            />
            <TooltipContent side="top">Clear search</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

type SearchResultsProps = {
  /** The debounced query the result belongs to. */
  query: string
  result: ResumeSearch | undefined
  isPending: boolean
  isPlaceholderData: boolean
  isError: boolean
  activeId: string | undefined
  onRetry: () => void
  onClear: () => void
}

export function SearchResults({
  query,
  result,
  isPending,
  isPlaceholderData,
  isError,
  activeId,
  onRetry,
  onClear,
}: SearchResultsProps) {
  const groups = result?.groups ?? []
  // With `keepPreviousData` an empty batch has nothing to keep, so a fresh
  // query that has not answered yet shows the skeletons rather than claiming
  // there are no matches.
  const waiting = isPending || (isPlaceholderData && groups.length === 0)

  if (waiting) {
    return <RailSkeleton />
  }

  return (
    <>
      {isError && <SearchFailure onRetry={onRetry} />}
      {groups.map((group) => (
        <ResultCard key={group.resume.id} group={group} activeId={activeId} />
      ))}
      {!isError && groups.length === 0 && (
        <NoMatches query={query} onClear={onClear} />
      )}
      {groups.length > 0 && (
        <p className="sticky bottom-0 bg-background pt-1.5 text-center text-[10.5px] text-muted-foreground">
          {groups.length} of {result?.scanned ?? 0} resumes
        </p>
      )}
    </>
  )
}

function ResultCard({
  group,
  activeId,
}: {
  group: ResumeSearchGroup
  activeId: string | undefined
}) {
  const selected = group.resume.id === activeId
  const extra = group.totalHits - group.hits.length

  return (
    <Link
      to="/r/$resumeId/edit"
      params={{ resumeId: group.resume.id }}
      title={group.resume.title}
      className={cn(
        "block w-full rounded-[6px] px-2 py-1 text-left transition-colors",
        selected ? "bg-muted" : "hover:bg-muted"
      )}
    >
      <div className="flex h-[22px] items-center gap-1.5">
        <FileTextIcon className="size-3.5 flex-none text-muted-foreground opacity-70" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12.5px]",
            selected
              ? "font-semibold text-primary-text"
              : "font-medium text-foreground/80"
          )}
        >
          <Highlighted text={group.resume.title} ranges={group.titleRanges} />
        </span>
        <time
          dateTime={group.resume.updatedAt}
          title={absoluteTime(group.resume.updatedAt)}
          className="flex-none text-[10.5px] text-muted-foreground"
        >
          {relativeTime(group.resume.updatedAt)}
        </time>
      </div>

      {/* Hits hang under the file, indented past the icon column. */}
      {group.hits.map((hit) => (
        <div
          key={`${hit.nodeId}:${hit.field}:${hit.snippet}`}
          className="mt-0.5 pl-5"
        >
          <div className="truncate text-[10.5px] leading-[1.3] text-muted-foreground">
            {hit.breadcrumb}
          </div>
          <div className="truncate text-[11px] leading-[1.35] text-foreground/80">
            <Highlighted text={hit.snippet} ranges={hit.ranges} />
          </div>
        </div>
      ))}

      {extra > 0 && (
        <div className="mt-0.5 pl-5 text-[10.5px] leading-[1.3] text-muted-foreground">
          +{extra} more {extra === 1 ? "match" : "matches"}
        </div>
      )}
    </Link>
  )
}

/** The snippet and title with every range the server reported marked. */
function Highlighted({ text, ranges }: { text: string; ranges: TextRange[] }) {
  if (ranges.length === 0) return <>{text}</>

  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark
        key={start}
        className="rounded-[3px] bg-muted px-0.5 text-primary-text"
      >
        {text.slice(start, end)}
      </mark>
    )
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))

  return <>{parts}</>
}

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <Empty className="gap-3 p-4">
      <EmptyHeader className="gap-1">
        <EmptyTitle className="text-[12.5px]">
          No resume mentions "{query}"
        </EmptyTitle>
        <EmptyDescription className="text-[11px] leading-[1.4]">
          Try a word you know is in the resume.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="text-[11px]">
        <Button variant="ghost" size="xs" onClick={onClear}>
          Clear search
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function SearchFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[8px] border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] leading-[1.4] text-destructive">
      <span>Search failed</span>
      <Button
        variant="ghost"
        size="xs"
        className="text-destructive"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  )
}
