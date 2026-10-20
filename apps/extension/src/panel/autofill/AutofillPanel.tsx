import type { ProfileSection } from "@workspace/autofill/fields"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  AI_DEGRADED,
  ATTACH_FAILED,
  earlierLine,
  limitLine,
  mismatchLine,
  missingLine,
  NO_FORM,
  NO_RESUME,
  OPEN_FORM,
  pageLine,
  runLine,
  SET_IN_PROFILE,
  vendorTitle,
} from "../../lib/autofill-copy"
import type { AutofillAction, AutofillView } from "../../lib/autofill-view"
import type { Snapshot } from "../../lib/messages"
import { Groups } from "./Groups"
import { Questions } from "./Questions"
import { ResumePicker } from "./ResumePicker"

type Props = {
  view: AutofillView
  resumes: { rows: Snapshot["resumes"]; more: (() => void) | null }
  onAction: (action: AutofillAction) => void
  onOpenProfile: (section: ProfileSection) => void
  onOpenApp: () => void
  /** Another panel action is in flight. */
  pending: boolean
  /** The autofill action in flight, apart from focus and draft. */
  sending: AutofillAction["kind"] | null
}

/** The autofill view of an application page, laid out as spec 6.1. */
export function AutofillPanel({
  view,
  resumes,
  onAction,
  onOpenProfile,
  onOpenApp,
  pending,
  sending,
}: Props) {
  const busy = pending || sending !== null || view.running
  const limited = view.quota?.remaining === 0
  const line = pageLine(view.company, view.title)
  const header = (
    <div className="space-y-1">
      <h1>{view.vendor ? vendorTitle(view.vendor) : "Autofill"}</h1>
      {line && <p>{line}</p>}
    </div>
  )
  if (view.scanning)
    return (
      <>
        {header}
        <p className="flex items-center gap-2">
          <Spinner />
          Checking this page…
        </p>
      </>
    )
  if (!view.form)
    return (
      <>
        {header}
        <p>{NO_FORM}</p>
        {view.formLink && (
          <Button
            variant="outline"
            onClick={() => onAction({ kind: "open-form" })}
          >
            {OPEN_FORM}
          </Button>
        )}
      </>
    )
  const mismatch =
    view.jobMatch === "mismatch" &&
    !view.useAnyway &&
    view.job !== null &&
    view.company !== null
      ? mismatchLine(view.job.company, view.company)
      : null
  const missing = view.missing[0]
  return (
    <>
      {header}
      {view.resume === null ? (
        <div className="space-y-3">
          <p>{NO_RESUME}</p>
          <Button disabled={pending} onClick={onOpenApp}>
            Open VS:Résumé
          </Button>
        </div>
      ) : (
        <ResumePicker
          value={view.resume.id}
          rows={resumes.rows}
          more={resumes.more}
          disabled={busy}
          onPick={(resumeId) => onAction({ kind: "resume", resumeId })}
        />
      )}
      {mismatch && (
        <div className="space-y-2 rounded-lg bg-warning/10 p-3">
          <p className="text-warning">{mismatch}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction({ kind: "use-anyway" })}
          >
            Use anyway
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button
          disabled={busy || view.resume === null}
          onClick={() => onAction({ kind: "run" })}
        >
          {(sending === "run" || (view.running && sending !== "answer")) && (
            <Spinner />
          )}
          Autofill
        </Button>
        <span className="text-muted-foreground text-sm">{runLine(view)}</span>
      </div>
      {(missing ||
        view.earlier ||
        view.degraded ||
        limited ||
        view.attachFailed) && (
        <div className="space-y-1">
          {missing && (
            <p>
              {missingLine(view.missing.length)}{" "}
              <Button
                size="xs"
                variant="link"
                className="h-auto p-0"
                onClick={() => onOpenProfile(missing.anchor)}
              >
                {SET_IN_PROFILE}
              </Button>
            </p>
          )}
          {view.earlier && (
            <p>{earlierLine(view.earlier.at, view.earlier.resumeTitle)}</p>
          )}
          {view.degraded && <p className="text-warning">{AI_DEGRADED}</p>}
          {limited && (
            <p className="text-warning">
              {limitLine(view.quota?.resetAt ?? null)}
            </p>
          )}
          {view.attachFailed && <p className="text-warning">{ATTACH_FAILED}</p>}
        </div>
      )}
      <Questions
        view={view}
        disabled={busy}
        limited={limited}
        saving={sending === "answer"}
        onAction={onAction}
        onOpenProfile={onOpenProfile}
      />
      <Groups
        groups={view.groups}
        disabled={busy}
        onAction={onAction}
        onOpenProfile={onOpenProfile}
      />
    </>
  )
}
