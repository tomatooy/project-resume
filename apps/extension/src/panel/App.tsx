import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowSquareOutIcon, FilePdfIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { MAX_TAILOR_INSTRUCTIONS_CHARS } from "@workspace/resume-core/contracts"
import {
  currentQuery,
  resumePreviewKey,
  useAutofillAction,
  useAutofillUpdates,
  useBaseResumes,
  useOperationRecovery,
  useAction,
  useRoutingRefresh,
  useServerUpdates,
} from "./queries"
import { AutofillPanel } from "./autofill/AutofillPanel"
import { useResumeAttach } from "./autofill/attach"
import { TailoredPreview } from "./preview/TailoredPreview"
import { useTailorInstructions } from "./use-tailor-instructions"
import {
  ExtensionError,
  type Message,
  type ResumePreviewRequest,
} from "../lib/messages"
import {
  AtsVendorSchema,
  atsName,
  autofillVendor,
  categoryOf,
} from "../lib/pages"

const vendors = new Intl.ListFormat("en", { type: "disjunction" }).format(
  AtsVendorSchema.options.map(atsName)
)
const control = (type: "panel-minimize" | "panel-close") => {
  void chrome.runtime.sendMessage({ type }).catch(() => {})
}

export function App() {
  const state = useQuery(currentQuery())
  const autofill = useAutofillAction()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewButton = useRef<HTMLButtonElement>(null)
  const [selection, setSelection] = useState<{
    account: string
    id: string
  } | null>(null)
  const data = state.data
  useResumeAttach(data?.autofill?.attach ?? null, (next) =>
    autofill.mutate(next)
  )
  const instructions = useTailorInstructions(
    data?.lookup?.kind === "none" ? data.account?.id : undefined
  )
  const action = useAction(instructions.persist)
  const navigated = useRoutingRefresh(data?.tabId, data?.page)
  const changingPage = navigated && state.isFetching
  const resumes = useBaseResumes(data)
  useOperationRecovery(data)
  useAutofillUpdates(data?.tabId)
  useServerUpdates(
    data?.page.kind === "job" ? data.page.identity.externalJobId : undefined,
    data?.account?.id,
    data?.lookup?.kind === "bound" ? data.lookup.operation.id : undefined
  )
  const act = (message: Message) => {
    if (!action.isPending && !changingPage) action.mutate(message)
  }
  const lookup = data?.lookup
  const page = data?.page
  const readyPreview: ResumePreviewRequest | null =
    !state.isError &&
    data?.account &&
    page?.kind === "job" &&
    lookup?.kind === "bound" &&
    lookup.operation.status === "succeeded"
      ? {
          accountId: data.account.id,
          identity: page.identity,
          resumeId: lookup.resumeId,
          operationId: lookup.operation.id,
        }
      : !state.isError &&
          data?.account &&
          page?.kind === "ats" &&
          data.autofill?.form &&
          data.autofill.resume &&
          data.autofill.postingKey
        ? {
            accountId: data.account.id,
            resumeId: data.autofill.resume.id,
            postingKey: data.autofill.postingKey,
          }
        : null
  const readyKey = readyPreview
    ? JSON.stringify([data?.tabId, ...resumePreviewKey(readyPreview)])
    : null
  const preview = previewId && previewId === readyKey ? readyPreview : null
  useEffect(() => {
    setPreviewId((current) => (current === readyKey ? current : null))
  }, [readyKey])
  const closePreview = () => {
    setPreviewId(null)
    void state.refetch()
    requestAnimationFrame(() => previewButton.current?.focus())
  }
  const baseId =
    resumes.rows.find(
      (r) =>
        r.id ===
        (selection && selection.account === data?.account?.id
          ? selection.id
          : data?.lastBaseId)
    )?.id ??
    resumes.rows[0]?.id ??
    ""
  const message =
    action.error?.message ?? autofill.error?.message ?? state.error?.message
  // Focus, draft and the resume attach never hold up the panel's other
  // autofill buttons.
  const sent = autofill.isPending ? autofill.variables?.kind : undefined
  const sending =
    sent === undefined ||
    sent === "focus" ||
    sent === "draft" ||
    sent === "attach" ||
    sent === "attach-failed"
      ? null
      : sent
  const pending = action.isPending
  // A failed refresh still says which page the tab is on.
  const known =
    (state.error instanceof ExtensionError ? state.error.page : undefined) ??
    page
  const category = known ? categoryOf(known) : undefined
  const openApp = (
    <Button disabled={pending} onClick={() => act({ type: "open-app" })}>
      Open VS:Résumé
    </Button>
  )
  let content: ReactNode
  if (state.isPending)
    content = (
      <p className="flex items-center gap-2">
        <Spinner />
        Checking this page…
      </p>
    )
  else if (state.isError) {
    const auth =
      state.error instanceof ExtensionError && state.error.code === "auth"
    content = (
      <>
        <h1>
          {category === "job"
            ? "Could not check this job"
            : "Could not reach VS:Résumé"}
        </h1>
        <p>
          {category === "job"
            ? "We couldn’t load your resume’s status for this job. Try again in a moment."
            : "Check your connection and try again."}
        </p>
        <Button
          disabled={pending}
          onClick={() => {
            if (auth) act({ type: "connect" })
            else void state.refetch()
          }}
        >
          {auth ? "Connect account" : "Try again"}
        </Button>
      </>
    )
  } else if (!data?.account)
    content = (
      <>
        <h1>Connect your account</h1>
        <p>Connect your existing VS:Résumé account to get started.</p>
        <Button disabled={pending} onClick={() => act({ type: "connect" })}>
          Connect account
        </Button>
      </>
    )
  else if (preview)
    content = (
      <TailoredPreview
        key={previewId}
        request={preview}
        onBack={closePreview}
        onEdit={() =>
          act(
            "postingKey" in preview
              ? { type: "autofill-edit", ...preview }
              : {
                  type: "edit",
                  resumeId: preview.resumeId,
                  identity: preview.identity,
                }
          )
        }
        onConnect={() => {
          setPreviewId(null)
          act({ type: "connect" })
        }}
        editing={pending}
      />
    )
  else if (page?.kind === "ats" && data.autofill) {
    const view = data.autofill
    content = (
      <AutofillPanel
        view={{ ...view, vendor: view.vendor ?? autofillVendor(page) }}
        resumes={{
          rows: resumes.rows,
          more:
            resumes.hasNextPage && !resumes.isFetchingNextPage
              ? () => void resumes.fetchNextPage()
              : null,
        }}
        onAction={(next) => autofill.mutate(next)}
        onOpenProfile={(section) => act({ type: "open-app", section })}
        onOpenApp={() => act({ type: "open-app" })}
        onPreview={() => setPreviewId(readyKey)}
        previewButtonRef={previewButton}
        pending={pending}
        sending={sending}
      />
    )
  } else if (page?.kind === "ats")
    content = (
      <>
        <h1>Autofill is coming soon</h1>
        <p>
          We recognized this {atsName(page.vendor)} application. Soon VS:Résumé
          will fill it in from your resume.
        </p>
        {openApp}
      </>
    )
  else if (page?.kind === "unsupported")
    content = (
      <>
        <h1>No job or application detected</h1>
        <p>Open a LinkedIn job, or an application on {vendors}.</p>
        {openApp}
      </>
    )
  else if (page?.kind === "select-job")
    content = (
      <>
        <h1>Select a job on LinkedIn</h1>
        <p>Choose a posting to see your resume for that role.</p>
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
            ? "SAVED TO YOUR ACCOUNT"
            : op.status === "cancelled"
              ? "CANCELLED"
              : "NEEDS ANOTHER TRY"}
        </span>
        <h1>
          {op.status === "succeeded"
            ? "Your tailored resume is ready"
            : op.status === "cancelled"
              ? "Your copy is saved"
              : "Could not finish tailoring"}
        </h1>
        <p>
          {op.errorClass === "conflict"
            ? "Your edits are safe. Retry will use the latest saved resume."
            : op.status === "succeeded"
              ? "Review your PDF, download it, or make a few final edits."
              : "You can retry with the saved job description, or edit your copy."}
        </p>
        {op.status === "succeeded" && (
          <Button
            className="w-full"
            disabled={pending}
            onClick={() => act({ type: "apply", identity: page.identity })}
          >
            <ArrowSquareOutIcon /> Apply now
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          {op.status === "succeeded" && (
            <Button
              ref={previewButton}
              className="flex-1"
              variant="outline"
              onClick={() => setPreviewId(readyKey)}
            >
              <FilePdfIcon /> Preview resume
            </Button>
          )}
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
            variant="outline"
            onClick={() =>
              act({
                type: "edit",
                resumeId: lookup.resumeId,
                identity: page.identity,
              })
            }
          >
            {op.status === "succeeded" ? (
              <>
                <ArrowSquareOutIcon /> Edit in app
              </>
            ) : (
              "Edit resume"
            )}
          </Button>
        </div>
      </>
    )
  } else if (resumes.rows.length === 0)
    content = (
      <>
        <h1>Start with your first resume</h1>
        <p>
          Create a resume in VS:Résumé, then come back to tailor it for this
          job.
        </p>
        {openApp}
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
            items={resumes.rows.map((r) => ({ value: r.id, label: r.title }))}
          >
            <SelectTrigger id="base" className="w-full" disabled={pending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resumes.rows.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {resumes.hasNextPage && (
            <Button
              variant="ghost"
              disabled={resumes.isFetchingNextPage || pending}
              onClick={() => void resumes.fetchNextPage()}
            >
              {resumes.isFetchingNextPage
                ? "Loading…"
                : resumes.isFetchNextPageError
                  ? "Retry loading more"
                  : "Load more"}
            </Button>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="tailor-instructions" className="text-xs font-medium">
            Additional instructions
            <span className="ml-1 font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Textarea
            id="tailor-instructions"
            value={instructions.value}
            onChange={(event) => instructions.change(event.target.value)}
            placeholder="For example: Don’t include a summary. Focus on my backend experience."
            maxLength={MAX_TAILOR_INSTRUCTIONS_CHARS}
            rows={3}
            className="field-sizing-fixed min-h-24 max-h-48 resize-y text-sm"
            disabled={pending || instructions.loading}
            aria-describedby="tailor-instructions-help"
          />
          <p id="tailor-instructions-help" className="text-xs">
            Instructions save automatically in this browser. Edit or clear
            anytime.
          </p>
          {instructions.error && (
            <div className="flex items-center gap-2" role="alert">
              <p className="text-xs text-warning">{instructions.error}</p>
              <Button size="xs" variant="ghost" onClick={instructions.retry}>
                Try again
              </Button>
            </div>
          )}
        </div>
        <Button
          className="w-full"
          disabled={
            !baseId ||
            pending ||
            instructions.loading ||
            Boolean(instructions.error)
          }
          onClick={() => {
            if (page?.kind === "job")
              act({
                type: "tailor",
                sourceResumeId: baseId,
                instructions: instructions.value,
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
    <main
      className={cn(
        "flex w-full flex-col border-l border-border bg-card text-foreground",
        preview ? "h-dvh min-h-0 overflow-hidden" : "min-h-dvh"
      )}
    >
      <header
        className={cn(
          "shrink-0 border-b border-border bg-card",
          preview ? "px-4 py-3" : "p-5"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-heading text-lg tracking-tight text-foreground">
            <img
              src="/logo.svg"
              alt=""
              width={32}
              height={32}
              className="size-6 shrink-0 object-contain dark:invert"
            />
            VS:Résumé
          </div>
          <div className="flex items-center gap-1">
            {category && category !== "unsupported" && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Minimize to widget"
                title="Minimize to widget"
                className="text-foreground"
                onClick={() => control("panel-minimize")}
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
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close for this tab"
              title="Close for this tab"
              className="text-foreground"
              onClick={() => control("panel-close")}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </Button>
          </div>
        </div>
        {!preview && (
          <p className="mt-2 text-xs">
            Your next role, with a resume that fits.
          </p>
        )}
      </header>
      <section
        className={preview ? "flex min-h-0 flex-1 flex-col" : "space-y-5 p-5"}
        aria-live={preview ? "off" : "polite"}
        aria-busy={changingPage}
        inert={changingPage}
      >
        {!preview && (category === "job" || category === "ats") && (
          <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-widest">
            {category === "job" ? "Resume tailoring" : "Autofill"}
          </div>
        )}
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
      {data?.account && !preview && (
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
