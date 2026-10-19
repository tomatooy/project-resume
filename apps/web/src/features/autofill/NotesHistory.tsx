import { ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"

import { absoluteTime } from "@/lib/format"
import { noteVersionQuery, noteVersionsQuery } from "@/lib/queries"

import { characters, REASON_LABELS } from "./notes-session"
import type { NotesAutosave } from "./use-notes-autosave"

/** The Notes' earlier versions, a preview of the one picked, and Restore. */
export function NotesHistory({
  restore,
}: {
  restore: NotesAutosave["restore"]
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" />}
      >
        <ClockCounterClockwiseIcon />
        History
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>
            Your notes as they were before each update, editing session and
            restore. Restoring a version keeps the current text here too.
          </DialogDescription>
        </DialogHeader>
        <Versions restore={restore} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** Mounted only while the dialog is open, so the list loads on each open. */
function Versions({
  restore,
  onDone,
}: {
  restore: NotesAutosave["restore"]
  onDone: () => void
}) {
  // Any save can add a version, so a list from an earlier open is stale.
  const versions = useQuery({ ...noteVersionsQuery(), staleTime: 0 })
  const [picked, setPicked] = useState<string | null>(null)
  // Closes on "reloaded" too: the editor then shows the latest text and says why.
  const bringBack = useMutation({
    mutationFn: restore,
    onSuccess: () => onDone(),
    onError: (error) => toast.error(error.message),
  })

  let list: ReactNode
  if (!versions.data) {
    list = versions.isError ? (
      <Failure
        message="History didn't load."
        retry={() => void versions.refetch()}
      />
    ) : (
      <Quiet>Loading versions…</Quiet>
    )
  } else if (versions.data.length === 0) {
    list = <Quiet>No earlier versions yet.</Quiet>
  } else {
    // The server sends them newest first.
    list = (
      <ul className="flex flex-col gap-0.5">
        {versions.data.map((version) => (
          <li key={version.id}>
            <button
              type="button"
              aria-pressed={picked === version.id}
              onClick={() => setPicked(version.id)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors",
                picked === version.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              )}
            >
              <span className="text-[12.5px] font-medium">
                {REASON_LABELS[version.reason]}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {absoluteTime(version.createdAt)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {characters(version.length)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="max-h-[50vh] overflow-auto">{list}</div>
        <div className="max-h-[50vh] min-h-32 overflow-auto rounded-lg border border-border bg-background p-3">
          {picked ? (
            <Preview id={picked} />
          ) : (
            <Quiet>Choose a version to see its text.</Quiet>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          disabled={picked === null || bringBack.isPending}
          onClick={() => {
            if (picked) bringBack.mutate(picked)
          }}
        >
          Restore
        </Button>
      </DialogFooter>
    </>
  )
}

function Preview({ id }: { id: string }) {
  const version = useQuery(noteVersionQuery(id))
  if (!version.data) {
    return version.isError ? (
      <Failure
        message="This version didn't load."
        retry={() => void version.refetch()}
      />
    ) : (
      <Quiet>Loading this version…</Quiet>
    )
  }
  if (!version.data.content) return <Quiet>This version has no text.</Quiet>
  return (
    <pre className="font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap wrap-anywhere">
      {version.data.content}
    </pre>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-muted-foreground">{children}</p>
}

function Failure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Quiet>{message}</Quiet>
      <Button type="button" variant="outline" size="xs" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}
