import { useEffect, useState } from "react"
import {
  ConceptSchema,
  type FieldDecision,
} from "@workspace/resume-core/contracts"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { PROTOCOL, type PanelCommand, type AutofillSession } from "./messages"

export type Confirmation = NonNullable<
  Extract<PanelCommand, { type: "af.continue" }>["confirmations"]
>[number]
export type PanelSend = (command: PanelCommand) => Promise<boolean>

export function ReviewItem({
  decision,
  session,
  disabled,
  nonce,
  send,
  queued,
  queue,
  unqueue,
  explanation,
}: {
  decision: FieldDecision
  session: AutofillSession
  disabled: boolean
  nonce: string
  send: PanelSend
  queued: boolean
  queue: (confirmation: Confirmation) => void
  unqueue: () => void
  explanation: (reason: string) => string
}) {
  const [concept, setConcept] = useState(
    decision.status === "needs_draft"
      ? "open_answer"
      : (decision.semanticKey ?? "unmapped")
  )
  const [candidate, setCandidate] = useState(
    decision.reasonCode === "choose_record"
      ? (decision.recordId ?? "")
      : (decision.optionIds?.[0] ?? "")
  )
  const [candidateSet, setCandidateSet] = useState<string[]>([])
  const [value, setValue] = useState("")
  const field = session.observation?.snapshot?.fields.find(
    (item) => item.fieldId === decision.fieldId
  )
  const draft = session.drafts.find((item) => item.fieldId === decision.fieldId)
  useEffect(() => {
    if (draft) {
      setValue(draft.text)
      setConcept("open_answer")
    }
  }, [draft])
  const multiple =
    field?.control === "multi_select" || field?.control === "checkbox_group"
  const blocked = ["blocked", "unsupported"].includes(decision.status)
  const storedPreview =
    session.replacementPreviews.find(
      (item) => item.fieldId === decision.fieldId
    ) ?? session.replacementPreview
  const preview =
    storedPreview?.fieldId === field?.fieldId &&
    storedPreview?.guardRef === field?.guardRef &&
    storedPreview?.fieldRevision === field?.fieldRevision
      ? storedPreview
      : null
  const base: {
    protocolVersion: 1
    nonce: string
    sessionId: string
    generation: number
  } = {
    protocolVersion: PROTOCOL,
    nonce,
    sessionId: session.id,
    generation: session.generation,
  }
  const validConcept = concept !== "unmapped" && concept !== "ambiguous"
  const proposed = value.trim() || decision.value
  const canQueue =
    validConcept &&
    Boolean(
      proposed || candidate || candidateSet.length || decision.optionIds?.length
    )
  const edit = () => unqueue()
  return (
    <section className="space-y-2 rounded border border-border p-3">
      <h2 className="font-medium">{decision.label || "Unlabelled field"}</h2>
      <p className="text-xs text-muted-foreground">
        {decision.status.replaceAll("_", " ")}:{" "}
        {explanation(decision.reasonCode)}
      </p>
      {field?.description ? (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      ) : null}
      {preview ? (
        <p className="break-words">
          Existing answer: {preview.value || "Empty"}
        </p>
      ) : null}
      {decision.status === "preserved" && !preview ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            void send({
              ...base,
              type: "af.preview",
              fieldId: decision.fieldId,
              requestId: crypto.randomUUID(),
            })
          }
        >
          Review existing answer
        </Button>
      ) : null}
      {decision.value ? (
        <p className="break-words">Proposed: {decision.value}</p>
      ) : null}
      {decision.sourceLabel ? (
        <p className="text-xs text-muted-foreground">
          From {decision.sourceLabel}
        </p>
      ) : null}
      {!blocked && field && (decision.status !== "preserved" || preview) ? (
        <fieldset disabled={disabled} className="space-y-2">
          <legend className="sr-only">Review {decision.label}</legend>
          {!decision.semanticKey ||
          ["unmapped", "ambiguous"].includes(decision.semanticKey) ? (
            <Select
              value={concept}
              disabled={disabled}
              onValueChange={(value) => {
                const parsed = ConceptSchema.safeParse(value)
                if (parsed.success) {
                  edit()
                  setConcept(parsed.data)
                }
              }}
            >
              <SelectTrigger aria-label={`Meaning of ${decision.label}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ConceptSchema.options.map((concept) => (
                  <SelectItem key={concept} value={concept}>
                    {concept.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {decision.candidates?.length &&
          decision.reasonCode !== "choose_concept" ? (
            multiple && decision.reasonCode !== "choose_record" ? (
              <fieldset className="space-y-2">
                <legend>Confirm the complete set of answers</legend>
                {decision.candidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    htmlFor={`af-option-${field.fieldId}-${candidate.id}`}
                    className="flex items-center gap-2"
                  >
                    <Checkbox
                      id={`af-option-${field.fieldId}-${candidate.id}`}
                      checked={candidateSet.includes(candidate.id)}
                      onCheckedChange={(checked) => {
                        edit()
                        setValue("")
                        setCandidateSet((current) =>
                          checked
                            ? [...current, candidate.id]
                            : current.filter((id) => id !== candidate.id)
                        )
                      }}
                    />
                    {candidate.label}
                  </label>
                ))}
              </fieldset>
            ) : (
              <Select
                value={candidate || null}
                disabled={disabled}
                onValueChange={(value) => {
                  edit()
                  setValue("")
                  setCandidate(value ?? "")
                }}
              >
                <SelectTrigger aria-label={`Choose for ${decision.label}`}>
                  <SelectValue
                    placeholder={
                      decision.reasonCode === "choose_record"
                        ? "Choose source record"
                        : "Choose observed option"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {decision.candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : null}
          {decision.status === "needs_draft" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  unqueue()
                  void send({
                    ...base,
                    type: "af.draft",
                    fieldId: field.fieldId,
                    requestId: crypto.randomUUID(),
                  })
                }}
              >
                {draft ? "Generate another draft" : "Generate draft"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Review and edit the draft before confirming. Only confirmed
                information is used.
              </p>
              {draft?.missingInformation.map((item) => (
                <p key={item} className="text-xs text-warning">
                  Still needed: {item}
                </p>
              ))}
            </>
          ) : null}
          {decision.reasonCode !== "choose_record" ? (
            <Textarea
              aria-label={`Answer for ${decision.label}, this application only`}
              placeholder="Answer for this application only"
              maxLength={4000}
              value={value}
              onChange={(event) => {
                edit()
                setCandidate("")
                setCandidateSet([])
                setValue(event.target.value)
              }}
            />
          ) : null}
          {queued ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-success">Queued for filling</p>
              <Button size="sm" variant="ghost" onClick={unqueue}>
                Remove from queue
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              disabled={!canQueue}
              onClick={() => {
                if (!session.sourceStamp || !canQueue) return
                queue({
                  selection: {
                    fieldId: field.fieldId,
                    fieldRevision: field.fieldRevision,
                    concept,
                    recordId:
                      decision.reasonCode === "choose_record"
                        ? candidate
                        : decision.recordId,
                    optionIds:
                      decision.reasonCode === "choose_record"
                        ? undefined
                        : multiple && candidateSet.length
                          ? candidateSet
                          : candidate
                            ? [candidate]
                            : decision.optionIds,
                    optionsRevision: field.options?.optionsRevision,
                    queryRevision: field.options?.queryRevision,
                    confirmed: true,
                    replace: Boolean(preview),
                    guardRef: field.guardRef,
                    profileRevision: session.sourceStamp.profileRevision,
                  },
                  override: value.trim()
                    ? {
                        overrideId: crypto.randomUUID(),
                        concept,
                        fieldId: field.fieldId,
                        value: value.trim(),
                        countryCode:
                          decision.conditions?.countryCode ??
                          session.countryCode,
                      }
                    : undefined,
                })
              }}
            >
              {preview ? "Confirm replacement" : "Confirm this answer"}
            </Button>
          )}
          {preview?.value ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!validConcept}
              onClick={() =>
                void send({
                  ...base,
                  type: "af.captureAnswer",
                  fieldId: field.fieldId,
                  concept,
                  confirmed: true,
                  requestId: crypto.randomUUID(),
                })
              }
            >
              Use existing answer for this application
            </Button>
          ) : null}
        </fieldset>
      ) : null}
    </section>
  )
}
