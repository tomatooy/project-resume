import {
  BooksIcon,
  DotsThreeIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import {
  Link,
  useMatchRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { ImportDialog } from "@/features/import/ImportDialog"
import { SKELETON_KEYS, absoluteTime, relativeTime } from "@/lib/format"
import {
  SEARCH_MIN_QUERY,
  resumesQuery,
  searchResumesQuery,
  useDeleteResume,
  useDuplicateResume,
} from "@/lib/queries"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import { DeleteResumeDialog } from "./DeleteResumeDialog"
import { IconButton } from "./IconButton"
import { RenameDialog } from "./RenameDialog"
import { RailSlotHost } from "./rail-slot"
import { useOptionalWorkspace } from "@/features/workspace/context"
import { SearchField, SearchResults } from "./ResumeSearch"
import { SkillsRail } from "./SkillsRail"

export function ResumeRail() {
  const matchRoute = useMatchRoute()
  // The initial route seeds the rail; browsing it leaves the active tab alone.
  const [skillsMode, setSkillsMode] = useState(() =>
    Boolean(matchRoute({ to: "/skills", fuzzy: true }))
  )

  return (
    <nav className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {skillsMode ? <SkillsRail /> : <ResumeList />}
      <RailSwitch
        skillsMode={skillsMode}
        onToggle={() => setSkillsMode((current) => !current)}
      />
    </nav>
  )
}

/** The foot of the rail: one row, naming what the rail is not showing. */
function RailSwitch({
  skillsMode,
  onToggle,
}: {
  skillsMode: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex flex-none items-center border-t border-border p-1.5">
      <Button
        type="button"
        variant="ghost"
        onClick={onToggle}
        className="h-[26px] w-full justify-start gap-1.5 rounded-[6px] px-2 text-[12.5px] font-normal text-foreground/60 hover:bg-accent"
      >
        {skillsMode ? (
          <FileTextIcon className="size-3.5 flex-none opacity-70" />
        ) : (
          <BooksIcon className="size-3.5 flex-none opacity-70" />
        )}
        <span className="truncate">{skillsMode ? "My resumes" : "Skills"}</span>
      </Button>
    </div>
  )
}

/** The user's resumes, as the rail shows them when the library is not up. */
function ResumeList() {
  const { data, isPending } = useQuery(resumesQuery())
  const params = useParams({ strict: false })
  const activeId = "resumeId" in params ? params.resumeId : undefined

  // A row opens the tab the user is already on, so switching resumes from
  // Export does not throw them back to the editor.
  const workspace = useOptionalWorkspace()

  const navigate = useNavigate()
  const [renaming, setRenaming] = useState<{
    id: string
    title: string
  } | null>(null)
  const [deleting, setDeleting] = useState<{
    id: string
    title: string
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [tailoring, setTailoring] = useState<string | null>(null)

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const typed = query.trim()
  // The request waits for typing to stop; the field itself stays live.
  const debouncedQuery = useDebouncedValue(typed, 300)
  const searching = debouncedQuery.length >= SEARCH_MIN_QUERY
  const search = useQuery(searchResumesQuery(debouncedQuery))

  const duplicate = useDuplicateResume()
  const remove = useDeleteResume()

  /** Close the field, drop the query, and hand focus back to its button. */
  function closeSearch() {
    setSearchOpen(false)
    setQuery("")
    searchButtonRef.current?.focus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-[42px] flex-none items-center gap-1.5 px-2.5">
        {/* One row, two states: the label gives its width to the field. Both
            cells stay mounted, so the input has width to be focused into the
            moment the track opens. */}
        <div
          className={cn(
            "grid min-w-0 flex-1 items-center transition-[grid-template-columns] duration-200 ease-out",
            searchOpen ? "grid-cols-[0fr_1fr]" : "grid-cols-[1fr_0fr]"
          )}
        >
          <div
            aria-hidden={searchOpen}
            className={cn(
              "flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap transition-opacity duration-150",
              searchOpen && "opacity-0"
            )}
          >
            <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
              My resumes
            </span>
            <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {data?.length ?? 0}
            </span>
          </div>
          <div className="min-w-0 overflow-hidden" inert={!searchOpen}>
            <SearchField
              open={searchOpen}
              value={query}
              onValueChange={setQuery}
              onClose={closeSearch}
            />
          </div>
        </div>
        <IconButton
          ref={searchButtonRef}
          label="Search resumes"
          aria-expanded={searchOpen}
          onClick={() => {
            if (searchOpen) closeSearch()
            else setSearchOpen(true)
          }}
        >
          <MagnifyingGlassIcon weight="bold" />
        </IconButton>
        <IconButton
          label="Create a new resume"
          onClick={() => setImporting(true)}
        >
          <PlusIcon weight="bold" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pb-3">
        {searching ? (
          <SearchResults
            query={debouncedQuery}
            result={search.data}
            isPending={search.isPending}
            isPlaceholderData={search.isPlaceholderData}
            isError={search.isError}
            activeId={activeId}
            onRetry={() => void search.refetch()}
            onClear={() => setQuery("")}
          />
        ) : isPending ? (
          SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="h-[26px] w-full rounded-[6px]" />
          ))
        ) : (
          data?.map((resume) => {
            const selected = resume.id === activeId
            return (
              <div key={resume.id}>
                {/* Only the row itself is hoverable: the sections below it are
                    their own rows, not part of this one's target. */}
                <div className="group/row relative">
                  <Link
                    to="/r/$resumeId/edit"
                    params={{ resumeId: resume.id }}
                    title={resume.title}
                    className={cn(
                      "flex h-[26px] w-full items-center gap-1.5 rounded-[6px] pr-1.5 pl-2 transition-colors",
                      // The open row is marked by its colour alone: the blue
                      // band belongs to the section it has open, and two of
                      // them stacked read as one double highlight.
                      selected
                        ? "text-foreground text-semibold"
                        : "text-foreground/60 hover:bg-accent"
                    )}
                  >
                    <FileTextIcon className="size-3.5 flex-none opacity-70" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                      {resume.title}
                    </span>
                    {/* One right-hand slot, two claimants: the row shows when it
                      was last saved, and yields it to the menu on hover. */}
                    <time
                      dateTime={resume.updatedAt}
                      title={absoluteTime(resume.updatedAt)}
                      className="flex-none text-[10.5px] text-muted-foreground transition-opacity group-has-[:focus-visible]/row:opacity-0 group-hover/row:opacity-0"
                    >
                      {relativeTime(resume.updatedAt)}
                    </time>
                  </Link>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Actions for ${resume.title}`}
                          className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-has-[:focus-visible]/row:opacity-100 group-hover/row:opacity-100 hover:bg-accent focus-visible:opacity-100"
                        >
                          <DotsThreeIcon weight="bold" />
                        </button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={() =>
                          setRenaming({ id: resume.id, title: resume.title })
                        }
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          duplicate.mutate(resume.id, {
                            onSuccess: (copy) =>
                              toast.success(`Duplicated as "${copy.title}"`),
                          })
                        }
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTailoring(resume.id)}>
                        Tailor for a job
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() =>
                          setDeleting({ id: resume.id, title: resume.title })
                        }
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* The open resume is the one that expands; the route that
                    holds its document portals the sections in here. */}
                {selected ? <RailSlotHost /> : null}
              </div>
            )
          })
        )}
        {/* The list is still the browsing list under the hint: one character
            is not a query yet. */}
        {!searching && typed.length > 0 && typed.length < SEARCH_MIN_QUERY && (
          <p className="pt-1 text-center text-[10.5px] text-muted-foreground">
            Type at least {SEARCH_MIN_QUERY} characters
          </p>
        )}
      </div>

      <ImportDialog open={importing} onOpenChange={setImporting} />
      <ImportDialog
        open={tailoring !== null}
        onOpenChange={(next) => {
          if (!next) setTailoring(null)
        }}
        tab="job"
        sourceResumeId={tailoring ?? undefined}
      />
      <RenameDialog target={renaming} onClose={() => setRenaming(null)} />
      <DeleteResumeDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={(id) => {
          remove.mutate(id, {
            onSuccess: () => {
              if (workspace) void workspace.forgetResource("resume", id)
              else if (id === activeId) void navigate({ to: "/dashboard" })
            },
          })
          setDeleting(null)
        }}
      />
    </div>
  )
}
