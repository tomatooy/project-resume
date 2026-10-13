import { useState } from "react"
import {
  emptyProfile,
  type ApplicationAnswer,
  type AnswerConditions,
} from "@workspace/resume-core/contracts"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { profileUpdateForAnswer } from "./profile-answer"
import { PROTOCOL, type AutofillSession } from "./messages"
import type { PanelSend } from "./ReviewItem"

const conditionLabels: Record<string, string> = {
  countryCode: "Country",
  employerId: "Employer",
  jobId: "Job",
  currency: "Currency",
  salaryPeriod: "Pay period",
}

export function ApplicationAnswers({
  session,
  nonce,
  disabled,
  send,
}: {
  session: AutofillSession
  nonce: string
  disabled: boolean
  send: PanelSend
}) {
  if (!session.applicationAnswers.length) return null
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h2 className="font-semibold">Confirmed for this application</h2>
      <p className="text-xs text-muted-foreground">
        These answers stay with this application until you close the tab. Saving
        for future applications is a separate choice.
      </p>
      {session.applicationAnswers.map((answer) => (
        <SaveAnswer
          key={answer.answerId}
          answer={answer}
          session={session}
          nonce={nonce}
          disabled={disabled}
          send={send}
        />
      ))}
    </section>
  )
}

function SaveAnswer({
  answer,
  session,
  nonce,
  disabled,
  send,
}: {
  answer: ApplicationAnswer
  session: AutofillSession
  nonce: string
  disabled: boolean
  send: PanelSend
}) {
  const [destination, setDestination] = useState("application")
  const [conditionKeys, setConditionKeys] = useState(
    Object.keys(answer.conditions)
  )
  const recordAnswer =
    Boolean(answer.recordId) ||
    /^(experience_|education_|current_employer$|recent_employer$)/.test(
      answer.meaning.concept
    )
  const profileAvailable = Boolean(
    profileUpdateForAnswer(
      session.sourceSnapshot?.profile ?? emptyProfile(),
      answer
    )
  )
  const saved = session.savedAnswerIds.includes(answer.answerId)
  const conditions = Object.fromEntries(
    Object.entries(answer.conditions).filter(([key]) =>
      conditionKeys.includes(key)
    )
  )
  const selectedConditions: AnswerConditions = conditions
  return (
    <fieldset
      disabled={disabled || saved}
      className="space-y-2 rounded border border-border p-3"
    >
      <legend className="px-1 font-medium">
        {answer.meaning.concept.replaceAll("_", " ")}
      </legend>
      {answer.meaning.questionKey ? (
        <p className="text-xs text-muted-foreground">
          {answer.meaning.questionKey}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap break-words">{answer.value}</p>
      {saved ? (
        <p className="text-success">Saved for future matching applications</p>
      ) : recordAnswer ? (
        <p className="text-xs text-muted-foreground">
          This record stays in this application. Update your resume in the
          editor to keep it there.
        </p>
      ) : (
        <>
          <Select
            value={destination}
            disabled={disabled || saved}
            onValueChange={(value) => {
              if (value) setDestination(value)
            }}
          >
            <SelectTrigger
              aria-label={`Save ${answer.meaning.concept.replaceAll("_", " ")}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="application">
                Keep in this application only
              </SelectItem>
              {profileAvailable ? (
                <SelectItem value="profile">
                  Save to Autofill Profile
                </SelectItem>
              ) : null}
              <SelectItem value="scoped">
                Save for matching applications
              </SelectItem>
            </SelectContent>
          </Select>
          {destination === "profile" ? (
            <p className="text-xs text-muted-foreground">
              This updates the matching Profile detail for future applications
              {answer.conditions.countryCode
                ? ` in ${answer.conditions.countryCode}`
                : ""}
              . Your current application keeps its starting Profile version.
            </p>
          ) : null}
          {destination === "scoped" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Reuse only when all selected conditions match. Removing an
                employer or job condition allows more applications to reuse this
                answer.
              </p>
              {Object.entries(answer.conditions)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => (
                  <label
                    key={key}
                    htmlFor={`af-scope-${answer.answerId}-${key}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Checkbox
                      id={`af-scope-${answer.answerId}-${key}`}
                      checked={conditionKeys.includes(key)}
                      disabled={[
                        "countryCode",
                        "currency",
                        "salaryPeriod",
                      ].includes(key)}
                      onCheckedChange={(checked) =>
                        setConditionKeys((current) =>
                          checked
                            ? [...current, key]
                            : current.filter((item) => item !== key)
                        )
                      }
                    />
                    <span className="break-all">
                      {conditionLabels[key] ?? key}: {value}
                    </span>
                  </label>
                ))}
              {!conditionKeys.length ? (
                <p className="text-xs text-warning">
                  Choose at least one known condition before saving for reuse.
                </p>
              ) : null}
            </>
          ) : null}
          {destination !== "application" ? (
            <Button
              size="sm"
              disabled={
                disabled || (destination === "scoped" && !conditionKeys.length)
              }
              onClick={() => {
                if (destination !== "profile" && destination !== "scoped")
                  return
                void send({
                  protocolVersion: PROTOCOL,
                  nonce,
                  type: "af.saveAnswer",
                  sessionId: session.id,
                  generation: session.generation,
                  requestId: crypto.randomUUID(),
                  answerId: answer.answerId,
                  destination,
                  conditions:
                    destination === "scoped" ? selectedConditions : undefined,
                  confirmed: true,
                })
              }}
            >
              {destination === "profile"
                ? "Confirm save to Profile"
                : "Confirm save for future use"}
            </Button>
          ) : null}
        </>
      )}
    </fieldset>
  )
}
