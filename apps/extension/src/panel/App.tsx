import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  currentQuery,
  useAction,
  useRoutingRefresh,
  useServerUpdates,
} from "./queries"
import { ExtensionError, type Message } from "../lib/messages"

export function App() {
  useRoutingRefresh()
  const state = useQuery(currentQuery())
  const action = useAction()
  const [selection, setSelection] = useState<{
    account: string
    id: string
  } | null>(null)
  const data = state.data
  useServerUpdates(
    data?.page.kind === "job" ? data.page.identity.externalJobId : undefined,
    data?.account?.id,
    data?.lookup?.kind === "bound" ? data.lookup.operation.id : undefined
  )
  const act = (message: Message) => {
    if (!action.isPending) action.mutate(message)
  }
  const lookup = data?.lookup
  const page = data?.page
  const baseId =
    data?.resumes.find(
      (r) =>
        r.id ===
        (selection && selection.account === data.account?.id
          ? selection.id
          : data.lastBaseId)
    )?.id ??
    data?.resumes[0]?.id ??
    ""
  const message = action.error?.message ?? state.error?.message
  const pending = action.isPending
  let content: ReactNode
  if (state.isPending)
    content = (
      <p className="flex items-center gap-2">
        <Spinner />
        Checking this job…
      </p>
    )
  else if (state.isError)
    content = (
      <>
        <h1>Could not check this job</h1>
        <p>Your saved resume may still be processing.</p>
        <Button
          disabled={pending}
          onClick={() => {
            if (
              state.error instanceof ExtensionError &&
              state.error.code === "auth"
            )
              act({ type: "connect" })
            else void state.refetch()
          }}
        >
          {state.error instanceof ExtensionError && state.error.code === "auth"
            ? "Connect account"
            : "Try again"}
        </Button>
      </>
    )
  else if (page?.kind === "unsupported")
    content = (
      <>
        <h1>Find your next role</h1>
        <p>
          Open a LinkedIn job view or search-results page to tailor a resume.
        </p>
      </>
    )
  else if (page?.kind === "select-job")
    content = (
      <>
        <h1>Select a job on LinkedIn</h1>
        <p>Choose a posting to see your resume for that role.</p>
      </>
    )
  else if (!data?.account)
    content = (
      <>
        <h1>A resume for this role</h1>
        <p>Connect your existing VS:Résumé account to get started.</p>
        <Button disabled={pending} onClick={() => act({ type: "connect" })}>
          Connect account
        </Button>
      </>
    )
  else if (page?.kind === "job" && lookup?.kind === "bound") {
    const op = lookup.operation
    content = lookup.canCancel ? (
      <>
        <div className="flex items-start gap-3">
          <Spinner className="mt-1 size-5" />
          <h1>Creating a tailored resume…</h1>
        </div>
        <p>You can close this panel. Your resume will keep processing.</p>
        <Button
          disabled={pending}
          variant="outline"
          onClick={() =>
            act({
              type: "cancel",
              operationId: op.id,
              identity: page.identity,
            })
          }
        >
          Cancel
        </Button>
      </>
    ) : (
      <>
        <span
          className={
            op.status === "succeeded"
              ? "text-success text-xs font-medium"
              : "text-warning text-xs font-medium"
          }
        >
          {op.status === "succeeded"
            ? "READY FOR YOUR NEXT STEP"
            : op.status === "cancelled"
              ? "CANCELLED"
              : "NEEDS ANOTHER TRY"}
        </span>
        <h1>
          {op.status === "succeeded"
            ? "Resume is ready, now apply"
            : op.status === "cancelled"
              ? "Your copy is saved"
              : "Could not finish tailoring"}
        </h1>
        <p>
          {op.errorClass === "conflict"
            ? "Your edits are safe. Retry will use the latest saved resume."
            : op.status === "succeeded"
              ? "Review your tailored resume in VS:Résumé."
              : "You can retry with the saved job description, or edit your copy."}
        </p>
        <div className="flex gap-2">
          {lookup.canRetry && (
            <Button
              disabled={pending}
              onClick={() =>
                act({
                  type: "retry",
                  operationId: op.id,
                  identity: page.identity,
                })
              }
            >
              Retry
            </Button>
          )}
          <Button
            disabled={pending}
            variant={op.status === "succeeded" ? "default" : "outline"}
            onClick={() =>
              act({
                type: "edit",
                resumeId: lookup.resumeId,
                identity: page.identity,
              })
            }
          >
            Edit resume
          </Button>
        </div>
      </>
    )
  } else if (data?.resumes.length === 0)
    content = (
      <>
        <h1>Start with your first resume</h1>
        <p>
          Create a resume in VS:Résumé, then come back to tailor it for this
          job.
        </p>
        <Button onClick={() => act({ type: "open-app" })}>
          Open VS:Résumé
        </Button>
      </>
    )
  else
    content = (
      <>
        <h1>Make this role your next move</h1>
        <p>
          Choose a base resume. We’ll save a separate copy tailored to this
          posting.
        </p>
        <div className="space-y-2">
          <label htmlFor="base" className="text-xs font-medium">
            Base resume
          </label>
          <Select
            value={baseId}
            onValueChange={(id) => {
              if (id && data?.account)
                setSelection({ account: data.account.id, id })
            }}
            items={data?.resumes.map((r) => ({ value: r.id, label: r.title }))}
          >
            <SelectTrigger id="base" className="w-full" disabled={pending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data?.resumes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="w-full"
          disabled={!baseId || pending}
          onClick={() => {
            if (page?.kind === "job")
              act({
                type: "tailor",
                sourceResumeId: baseId,
                identity: page.identity,
              })
          }}
        >
          {pending ? (
            <>
              <Spinner />
              Reading the selected job…
            </>
          ) : action.error instanceof ExtensionError &&
            action.error.code === "capture" ? (
            "Try again"
          ) : (
            "Tailor resume"
          )}
        </Button>
      </>
    )
  return (
    <main className="flex min-h-dvh w-full flex-col border-l border-border bg-card text-foreground">
      <header className="border-b border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-heading text-lg tracking-tight text-foreground">
            <img
              src="/icons/32.png"
              alt=""
              width={32}
              height={32}
              className="size-6 grayscale"
            />
            VS:Résumé
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to floating widget"
            title="Back to floating widget"
            className="text-foreground"
            onClick={() =>
              window.parent.postMessage(
                { type: "panel-collapse" },
                "https://www.linkedin.com"
              )
            }
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M15 3v18M7 9l3 3-3 3" />
            </svg>
          </Button>
        </div>
        <p className="mt-2 text-xs">Your next role, with a resume that fits.</p>
      </header>
      <section className="space-y-5 p-5" aria-live="polite">
        <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-widest">
          Resume tailoring
        </div>
        {content}
        {message && (
          <p
            role="alert"
            className="rounded-lg bg-warning/10 p-3 text-sm text-warning"
          >
            {message}
          </p>
        )}
      </section>
      {data?.account && (
        <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border bg-card px-5 py-4">
          <span className="truncate text-xs text-muted-foreground">
            {data.account.email}
          </span>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => act({ type: "disconnect" })}
          >
            Disconnect
          </Button>
        </footer>
      )}
    </main>
  )
}
