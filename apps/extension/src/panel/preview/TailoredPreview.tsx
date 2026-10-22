import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FilePdfIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import type { ResumePreview } from "@workspace/resume-core/contracts"
import {
  PreviewProvider,
  ZOOM_MAX,
  ZOOM_MIN,
  downloadBlob,
  nextZoomStep,
  previousZoomStep,
  usePreview,
  usePreviewDemand,
} from "@workspace/resume-preview"
import { resumeFileName } from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ExtensionError, type PreviewRequest } from "../../lib/messages"
import { resumePreviewQuery } from "../queries"

/** What the preview offers when it fails, by what went wrong. */
const FAILURES = {
  auth: {
    title: "Reconnect to view your resume",
    action: "connect",
    actionLabel: "Connect account",
  },
  gone: {
    title: "Resume unavailable",
    action: "back",
    actionLabel: "Back to this job",
  },
  other: {
    title: "Could not load the preview",
    action: "retry",
    actionLabel: "Try again",
  },
} as const

function failureOf(error: unknown): keyof typeof FAILURES {
  if (!(error instanceof ExtensionError)) return "other"
  if (error.code === "auth") return "auth"
  if (error.code === "not-found" || error.code === "changed") return "gone"
  return "other"
}

const PdfViewer = lazy(() =>
  import("@workspace/resume-preview/viewer").then((module) => ({
    default: module.PdfViewer,
  }))
)

type Props = {
  request: PreviewRequest
  onBack: () => void
  onEdit: () => void
  onConnect: () => void
  editing: boolean
}

export function TailoredPreview({
  request,
  onBack,
  onEdit,
  onConnect,
  editing,
}: Props) {
  const query = useQuery(resumePreviewQuery(request))
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    back.current?.focus()
    return () =>
      window.parent.postMessage({ type: "panel-resize", expanded: false }, "*")
  }, [])
  useEffect(() => {
    // Only layout state crosses into the host page.
    window.parent.postMessage({ type: "panel-resize", expanded }, "*")
  }, [expanded])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      if (expanded) setExpanded(false)
      else onBack()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [expanded, onBack])

  const error = query.error
  const retry = () => {
    setAttempt((value) => value + 1)
    void query.refetch()
  }
  const failure = FAILURES[failureOf(error)]
  const failureAction = { connect: onConnect, back: onBack, retry }[
    failure.action
  ]
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Resume preview"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Button ref={back} variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon /> Back
        </Button>
        <span className="flex-1 text-sm font-medium">Preview</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh preview"
          title="Load the latest saved resume"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? <Spinner /> : <ArrowClockwiseIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Restore preview width" : "Expand preview"}
          title={
            expanded ? "Restore preview width" : "Expand for easier reading"
          }
          aria-pressed={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
        </Button>
      </div>
      {query.isError ? (
        <PreviewNotice
          title={failure.title}
          description={
            error instanceof ExtensionError
              ? error.message
              : "Check your connection and try again. Your saved resume is safe."
          }
          action={failureAction}
          actionLabel={failure.actionLabel}
        />
      ) : query.data ? (
        <ResumePreviewDocument
          key={attempt}
          resume={query.data}
          refreshing={query.isFetching}
          onRetry={retry}
          onEdit={onEdit}
          editing={editing}
        />
      ) : (
        <PreviewLoading label="Loading your saved resume…" />
      )}
      {(query.isError || !query.data) && (
        <div className="shrink-0 border-t border-border bg-card p-4">
          <EditButton onEdit={onEdit} editing={editing} />
        </div>
      )}
    </section>
  )
}

function ResumePreviewDocument({
  resume,
  ...props
}: {
  resume: ResumePreview
  refreshing: boolean
  onRetry: () => void
  onEdit: () => void
  editing: boolean
}) {
  const input = useMemo(
    () => ({
      doc: resume.data,
      templateId: resume.templateId,
      options: resume.templateOptions,
      patches: [],
    }),
    [resume.data, resume.templateId, resume.templateOptions]
  )
  return (
    <PreviewProvider input={input}>
      <PreviewDocument resume={resume} {...props} />
    </PreviewProvider>
  )
}

function PreviewDocument({
  resume,
  refreshing,
  onRetry,
  onEdit,
  editing,
}: {
  resume: ResumePreview
  refreshing: boolean
  onRetry: () => void
  onEdit: () => void
  editing: boolean
}) {
  usePreviewDemand()
  const { blob, stale, loading, error, renderedInput } = usePreview(
    (state) => state
  )
  const [ready, setReady] = useState<{ blob: Blob; pages: number } | null>(null)
  const [failed, setFailed] = useState<Blob | null>(null)
  const [downloaded, setDownloaded] = useState<Blob | null>(null)
  const [zoom, setZoom] = useState(100)
  const [width, setWidth] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.floor(entry.contentRect.width) - 32))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const painted = useCallback((next: Blob, pages: number) => {
    setReady((previous) =>
      previous?.blob === next && previous.pages === pages
        ? previous
        : { blob: next, pages }
    )
  }, [])
  const hasError = Boolean(error || (blob && failed === blob))
  const current = Boolean(
    blob &&
      ready?.blob === blob &&
      !stale &&
      !loading &&
      !hasError &&
      renderedInput?.doc === resume.data &&
      renderedInput.templateId === resume.templateId &&
      renderedInput.options === resume.templateOptions
  )
  const busy = refreshing || (!current && !hasError)
  const available = current && !refreshing
  return (
    <>
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <h2 className="truncate text-sm font-semibold" title={resume.title}>
          {resume.title}
        </h2>
        <div
          className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
          role="status"
        >
          {busy ? (
            <Spinner className="size-3" />
          ) : hasError ? (
            <FilePdfIcon className="size-3.5" />
          ) : (
            <CheckCircleIcon className="size-3.5 text-success" />
          )}
          <span>
            {hasError
              ? "Preview unavailable"
              : refreshing
                ? "Checking for saved changes…"
                : busy
                  ? "Preparing your PDF…"
                  : "Latest saved copy"}
          </span>
          <span className="ml-auto">
            {resume.templateOptions.pageSize === "LETTER" ? "Letter" : "A4"}
          </span>
        </div>
      </div>
      <div
        ref={viewport}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-background"
        aria-busy={busy}
      >
        {hasError ? (
          <PreviewNotice
            title="Could not display the PDF"
            description="Your resume is saved. Try loading the preview again, or open it in the editor."
            action={onRetry}
            actionLabel="Try again"
          />
        ) : !blob || width === 0 ? (
          <PreviewLoading label="Preparing your PDF…" />
        ) : (
          <PdfBoundary onError={() => setFailed(blob)}>
            <Suspense fallback={<PreviewLoading label="Opening your PDF…" />}>
              <div className="w-max min-w-full p-4">
                <PdfViewer
                  blob={blob}
                  baseWidth={width}
                  zoom={zoom}
                  onReady={painted}
                  onError={setFailed}
                />
              </div>
            </Suspense>
          </PdfBoundary>
        )}
      </div>
      <div className="shrink-0 border-t border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {current && ready
              ? `${ready.pages} ${ready.pages === 1 ? "page" : "pages"}`
              : "PDF preview"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setZoom(100)}
              disabled={!current}
              aria-pressed={zoom === 100}
            >
              Fit width
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={!current || zoom <= ZOOM_MIN}
              onClick={() => setZoom(previousZoomStep)}
            >
              <MinusIcon />
            </Button>
            <output
              className="w-10 text-center text-xs tabular-nums"
              aria-label="Zoom"
            >
              {zoom}%
            </output>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={!current || zoom >= ZOOM_MAX}
              onClick={() => setZoom(nextZoomStep)}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
        <div className="space-y-2 p-4">
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!available}
              onClick={() => {
                if (!available || !blob) return
                downloadBlob(blob, resumeFileName(resume.data.basics.name))
                setDownloaded(blob)
              }}
            >
              <DownloadSimpleIcon /> Download PDF
            </Button>
            <EditButton onEdit={onEdit} editing={editing} />
          </div>
          <p className="text-center text-xs" role="status">
            {downloaded && downloaded === blob
              ? "Download started."
              : "Review your resume before applying."}
          </p>
        </div>
      </div>
    </>
  )
}

function EditButton({
  onEdit,
  editing,
}: {
  onEdit: () => void
  editing: boolean
}) {
  return (
    <Button
      variant="outline"
      disabled={editing}
      onClick={onEdit}
      title="Open this resume in VS:Résumé"
    >
      <ArrowSquareOutIcon /> Edit in app
    </Button>
  )
}

function PreviewLoading({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-6"
      role="status"
    >
      <Spinner className="size-6 text-muted-foreground" />
      <p>{label}</p>
    </div>
  )
}

function PreviewNotice({
  title,
  description,
  action,
  actionLabel,
}: {
  title: string
  description: string
  action: () => void
  actionLabel: string
}) {
  return (
    <div
      className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
      role="alert"
    >
      <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FilePdfIcon className="size-6" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm">{description}</p>
      <Button variant="outline" onClick={action}>
        {actionLabel}
      </Button>
    </div>
  )
}

class PdfBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
