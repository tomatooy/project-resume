import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  sendAutofill,
  AutofillPanelError,
  PROTOCOL,
  type PanelCommand,
} from "./messages"
import { ReviewItem, type Confirmation } from "./ReviewItem"
import { ApplicationAnswers } from "./ApplicationAnswers"
import { SupplementalRecordForm } from "./SupplementalRecordForm"

const explanations: Record<string, string> = {
  missing_scoped_fact: "No saved answer for this question and country",
  country_scope_conflict: "This question names a different country",
  policy_disabled: "Autofill is currently unavailable",
  manual_only: "Complete this question yourself",
  needs_draft: "Review a draft or write your answer",
  choose_record: "Choose the saved experience or education record",
  confirmation_required: "Review the proposed answer before filling",
  eeo_definition_mismatch:
    "This question uses a different definition. Enter a specific answer or complete it manually",
  compound_scope:
    "This question combines different sponsorship periods. Enter a specific answer",
  adapter_unavailable: "This control needs manual attention",
  options_unavailable: "The options could not be verified",
  partial_options:
    "Only some options are available. Review them or complete this field manually",
  existing_value: "Your existing answer is preserved",
  accepted_value: "The control accepted the answer",
  readback_unconfirmed:
    "The value may have changed, but acceptance could not be verified",
  resume_attached: "Resume PDF attached",
  resume_pdf_unavailable:
    "Could not prepare or attach the resume PDF. Upload it manually",
  pdf_not_accepted: "This upload does not accept PDF files",
}
const explanation = (reason: string) =>
  explanations[reason] ?? reason.replaceAll("_", " ")

export function AutofillPanel() {
  const nonce = z.uuid().parse(location.hash.slice("#autofill=".length))
  const client = useQueryClient()
  const key = ["autofill", nonce]
  const state = useQuery({
    queryKey: key,
    queryFn: () =>
      sendAutofill({ type: "af.state", protocolVersion: PROTOCOL, nonce }),
    refetchInterval: (query) => (query.state.error ? false : 1200),
    gcTime: 0,
    retry: false,
  })
  const [resumeId, setResumeId] = useState("")
  const [formId, setFormId] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [countryCode, setCountryCode] = useState("")
  const [currency, setCurrency] = useState("")
  const [salaryPeriod, setSalaryPeriod] = useState<
    "hour" | "month" | "year" | ""
  >("")
  const [queued, setQueued] = useState<{
    scope: string
    items: Confirmation[]
  }>({ scope: "", items: [] })
  const data = state.data
  const session = data?.session
  const scope = `${session?.id}:${session?.generation}:${session?.documentId}`
  const validConfirmation = ({ selection }: Confirmation) =>
    session?.observation?.snapshot?.fields.some(
      (field) =>
        field.fieldId === selection.fieldId &&
        field.fieldRevision === selection.fieldRevision &&
        field.guardRef === selection.guardRef
    ) ?? false
  const confirmations =
    queued.scope === scope ? queued.items.filter(validConfirmation) : []
  const setConfirmations = (
    update: Confirmation[] | ((current: Confirmation[]) => Confirmation[])
  ) =>
    setQueued((current) => ({
      scope,
      items:
        typeof update === "function"
          ? update(
              current.scope === scope
                ? current.items.filter(validConfirmation)
                : []
            )
          : update,
    }))
  const running =
    session &&
    [
      "preparing",
      "observing",
      "planning",
      "executing",
      "interacting",
      "stopping",
    ].includes(session.status)
  useEffect(() => {
    setCountryCode(session?.countryCode ?? "")
    setCurrency(session?.applicationContext?.currency ?? "")
    setSalaryPeriod(session?.applicationContext?.salaryPeriod ?? "")
  }, [
    session?.countryCode,
    session?.applicationContext?.currency,
    session?.applicationContext?.salaryPeriod,
  ])
  const validContext =
    (!countryCode || /^[A-Z]{2}$/.test(countryCode)) &&
    (!currency || /^[A-Z]{3}$/.test(currency))
  useEffect(() => {
    if (data?.account) setResumeId((id) => id || data.preselected || "")
  }, [data?.account, data?.preselected])
  const act = async (command: PanelCommand) => {
    setBusy(true)
    setError("")
    try {
      const next = await sendAutofill(command)
      client.setQueryData(key, next)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not continue")
      return false
    } finally {
      setBusy(false)
    }
  }
  const base = { protocolVersion: PROTOCOL, nonce } as const
  if (!data)
    return (
      <div className="space-y-3 p-4">
        <p role={state.error ? "alert" : "status"}>
          {error || state.error?.message || "Opening autofill…"}
        </p>
        {state.error ? (
          <Button
            variant="outline"
            disabled={busy || state.isFetching}
            onClick={() => {
              if (
                state.error instanceof AutofillPanelError &&
                state.error.code === "auth"
              )
                void act({ ...base, type: "af.connect" })
              else void state.refetch()
            }}
          >
            {state.error instanceof AutofillPanelError &&
            state.error.code === "auth"
              ? "Connect account"
              : "Retry"}
          </Button>
        ) : null}
      </div>
    )
  return (
    <main className="space-y-4 p-4 text-sm">
      <header>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Fill this application</h1>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void act({ ...base, type: "af.close" })}
          >
            Close
          </Button>
        </div>
        <p className="break-all text-xs text-muted-foreground">{data.origin}</p>
      </header>
      {!data.account ? (
        <>
          <p>Connect your VS:Résumé account to select a resume.</p>
          <Button onClick={() => void act({ ...base, type: "af.connect" })}>
            Connect account
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{data.account.email}</p>
          <label htmlFor="af-resume" className="block space-y-1">
            <span>Resume</span>
            <Select
              value={resumeId || null}
              disabled={Boolean(running)}
              onValueChange={(v) => {
                if (v) {
                  setResumeId(v)
                  setFormId("")
                }
              }}
            >
              <SelectTrigger id="af-resume">
                <SelectValue placeholder="Choose a resume" />
              </SelectTrigger>
              <SelectContent>
                {data.resumes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {data.nextCursor ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void sendAutofill({
                  ...base,
                  type: "af.resumes",
                  cursor: data.nextCursor ?? undefined,
                })
                  .then((next) =>
                    client.setQueryData(key, {
                      ...next,
                      resumes: [
                        ...new Map(
                          [...data.resumes, ...next.resumes].map((r) => [
                            r.id,
                            r,
                          ])
                        ).values(),
                      ],
                    })
                  )
                  .catch(() => setError("Could not load more resumes."))
              }}
            >
              Load more resumes
            </Button>
          ) : null}
          {session?.observation &&
          session.observation.forms.length > 0 &&
          !session.observation.snapshot ? (
            <label htmlFor="af-form" className="block space-y-1">
              <span>Target form</span>
              <Select
                value={formId || null}
                onValueChange={(v) => {
                  if (v) setFormId(v)
                }}
              >
                <SelectTrigger id="af-form">
                  <SelectValue placeholder="Choose the application form" />
                </SelectTrigger>
                <SelectContent>
                  {session.observation.forms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label} ({f.fields} fields)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
          <fieldset disabled={busy || Boolean(running)} className="space-y-2">
            <legend className="font-medium">
              Application context (optional)
            </legend>
            <p className="text-xs text-muted-foreground">
              Leave unknown details blank. Country and pay details help match
              saved answers correctly.
            </p>
            <label htmlFor="af-country" className="block space-y-1">
              <span>Country code</span>
              <Input
                id="af-country"
                aria-label="Application country code"
                placeholder="Two-letter code"
                maxLength={2}
                value={countryCode}
                onChange={(event) =>
                  setCountryCode(event.target.value.toUpperCase())
                }
              />
            </label>
            <label htmlFor="af-currency" className="block space-y-1">
              <span>Salary currency</span>
              <Input
                id="af-currency"
                aria-label="Salary currency"
                placeholder="Three-letter code"
                maxLength={3}
                value={currency}
                onChange={(event) =>
                  setCurrency(event.target.value.toUpperCase())
                }
              />
            </label>
            <Select
              value={salaryPeriod || "unknown"}
              disabled={busy || Boolean(running)}
              onValueChange={(value) => {
                if (value === "hour" || value === "month" || value === "year")
                  setSalaryPeriod(value)
                else setSalaryPeriod("")
              }}
            >
              <SelectTrigger aria-label="Salary period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Pay period unknown</SelectItem>
                <SelectItem value="hour">Per hour</SelectItem>
                <SelectItem value="month">Per month</SelectItem>
                <SelectItem value="year">Per year</SelectItem>
              </SelectContent>
            </Select>
            {!validContext ? (
              <p className="text-xs text-warning">
                Use a two-letter country code and a three-letter currency code,
                or leave them blank.
              </p>
            ) : null}
          </fieldset>
          <p className="rounded border border-border bg-muted p-3 text-xs text-muted-foreground">
            Automatically fill saved answers and attach the selected resume as a
            PDF. Missing or uncertain answers are left for you. This site can
            save filled details and uploaded files immediately. Submit the
            application when you are ready.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={
                !resumeId ||
                busy ||
                Boolean(running) ||
                !validContext ||
                confirmations.length > 0
              }
              onClick={() =>
                void act({
                  ...base,
                  type: "af.start",
                  resumeId,
                  countryCode: countryCode || undefined,
                  currency: currency || undefined,
                  salaryPeriod: salaryPeriod || undefined,
                  formId: formId || undefined,
                })
              }
            >
              Fill current page
            </Button>
            {running ? (
              <Button
                variant="outline"
                disabled={session?.status === "stopping"}
                onClick={() => {
                  if (session)
                    void act({
                      ...base,
                      type: "af.cancel",
                      sessionId: session.id,
                      generation: session.generation,
                      requestId: crypto.randomUUID(),
                    })
                }}
              >
                Stop
              </Button>
            ) : session && session.status !== "cancelled" ? (
              <Button
                variant="outline"
                disabled={busy || confirmations.length > 0}
                onClick={() => {
                  if (session)
                    void act({
                      ...base,
                      type: "af.continue",
                      sessionId: session.id,
                      generation: session.generation,
                      requestId: crypto.randomUUID(),
                    })
                }}
              >
                Continue
              </Button>
            ) : null}
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              void act({ ...base, type: "af.profile", section: "identity" })
            }
          >
            Edit Autofill Profile
          </Button>
          {session ? (
            <section className="space-y-3">
              <p role="status">{session.message}</p>
              <p className="text-xs text-muted-foreground">
                {session.status} · Current page only. Navigate and submit when
                you are ready.
              </p>
              {session.observation?.uncovered ? (
                <p className="text-warning">
                  Some embedded or custom content was not scanned. Complete
                  those fields manually.
                </p>
              ) : null}
              {session.results.map((r) => (
                <p
                  key={r.actionId}
                  className={
                    r.status === "filled"
                      ? "text-success"
                      : "text-muted-foreground"
                  }
                >
                  {session.decisions.find((d) => d.fieldId === r.fieldId)
                    ?.label ?? "Field"}
                  : {r.status.replaceAll("_", " ")} ({explanation(r.reasonCode)}
                  )
                </p>
              ))}
              {session.decisions
                .filter(
                  (d) =>
                    d.status !== "resolved" &&
                    !/^page_(navigation|search|authentication|not_application)$/.test(
                      d.reasonCode
                    )
                )
                .map((decision) => (
                  <ReviewItem
                    key={`${session.generation}:${decision.decisionId}`}
                    decision={decision}
                    session={session}
                    disabled={busy || Boolean(running)}
                    send={(command) => act(command)}
                    nonce={nonce}
                    queued={confirmations.some(
                      (item) => item.selection.fieldId === decision.fieldId
                    )}
                    queue={(confirmation) =>
                      setConfirmations((current) => [
                        ...current.filter(
                          (item) =>
                            item.selection.fieldId !==
                            confirmation.selection.fieldId
                        ),
                        confirmation,
                      ])
                    }
                    unqueue={() =>
                      setConfirmations((current) =>
                        current.filter(
                          (item) => item.selection.fieldId !== decision.fieldId
                        )
                      )
                    }
                    explanation={explanation}
                  />
                ))}
              {confirmations.length ? (
                <div className="space-y-2 rounded border border-border bg-muted p-3">
                  <p>
                    {confirmations.length} answers confirmed. They have not been
                    filled yet.
                  </p>
                  <Button
                    disabled={busy || Boolean(running)}
                    onClick={async () => {
                      if (
                        await act({
                          ...base,
                          type: "af.continue",
                          sessionId: session.id,
                          generation: session.generation,
                          requestId: crypto.randomUUID(),
                          confirmations,
                        })
                      )
                        setConfirmations([])
                    }}
                  >
                    Fill confirmed answers
                  </Button>
                </div>
              ) : null}
              <ApplicationAnswers
                session={session}
                nonce={nonce}
                disabled={busy || Boolean(running)}
                send={act}
              />
              {session.applicationContext ? (
                <SupplementalRecordForm
                  key={session.applicationContext.applicationId}
                  applicationId={session.applicationContext.applicationId}
                  disabled={busy || Boolean(running)}
                  queued={confirmations.length > 0}
                  add={(record) =>
                    act({
                      ...base,
                      type: "af.continue",
                      sessionId: session.id,
                      generation: session.generation,
                      requestId: crypto.randomUUID(),
                      supplementalRecord: record,
                    })
                  }
                />
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </main>
  )
}
