import { useId, useState } from "react"
import {
  SupplementalRecordSchema,
  type SupplementalRecord,
} from "@workspace/resume-core/contracts"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

export function SupplementalRecordForm({
  applicationId,
  disabled,
  queued,
  add,
}: {
  applicationId: string
  disabled: boolean
  queued: boolean
  add: (record: SupplementalRecord) => Promise<boolean>
}) {
  const idPrefix = useId()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<"experience" | "education">("experience")
  const [organization, setOrganization] = useState("")
  const [role, setRole] = useState("")
  const [study, setStudy] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [present, setPresent] = useState(false)
  const [highlights, setHighlights] = useState("")
  const [error, setError] = useState("")
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {open
          ? "Hide additional record"
          : "Add missing experience or education"}
      </Button>
      {open ? (
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="font-medium">
            Additional record for this application
          </legend>
          <p className="text-xs text-muted-foreground">
            Use this for information missing from your selected resume. It stays
            in this application and does not update your resume.
          </p>
          <Select
            value={kind}
            disabled={disabled}
            onValueChange={(value) => {
              if (value === "experience" || value === "education") {
                setKind(value)
                setOrganization("")
                setRole("")
                setStudy("")
                setStart("")
                setEnd("")
                setPresent(false)
                setHighlights("")
                setError("")
              }
            }}
          >
            <SelectTrigger aria-label="Record type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="experience">Experience</SelectItem>
              <SelectItem value="education">Education</SelectItem>
            </SelectContent>
          </Select>
          <label
            htmlFor={`${idPrefix}-organization`}
            className="block space-y-1"
          >
            <span>{kind === "experience" ? "Company" : "School"}</span>
            <Input
              id={`${idPrefix}-organization`}
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              maxLength={200}
            />
          </label>
          <label htmlFor={`${idPrefix}-role`} className="block space-y-1">
            <span>{kind === "experience" ? "Role" : "Degree"}</span>
            <Input
              id={`${idPrefix}-role`}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              maxLength={200}
            />
          </label>
          {kind === "education" ? (
            <label htmlFor={`${idPrefix}-study`} className="block space-y-1">
              <span>Field of study</span>
              <Input
                id={`${idPrefix}-study`}
                value={study}
                onChange={(event) => setStudy(event.target.value)}
                maxLength={200}
              />
            </label>
          ) : null}
          <label htmlFor={`${idPrefix}-start`} className="block space-y-1">
            <span>Start month{kind === "education" ? " (optional)" : ""}</span>
            <Input
              type="month"
              id={`${idPrefix}-start`}
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label
            htmlFor={`${idPrefix}-present`}
            className="flex items-center gap-2"
          >
            <Checkbox
              id={`${idPrefix}-present`}
              checked={present}
              onCheckedChange={(value) => setPresent(value)}
            />
            {kind === "experience"
              ? "I currently work here"
              : "I currently study here"}
          </label>
          {!present ? (
            <label htmlFor={`${idPrefix}-end`} className="block space-y-1">
              <span>End month{kind === "education" ? " (optional)" : ""}</span>
              <Input
                type="month"
                id={`${idPrefix}-end`}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          ) : null}
          <label htmlFor={`${idPrefix}-highlights`} className="block space-y-1">
            <span>Highlights (one per line, optional)</span>
            <Textarea
              id={`${idPrefix}-highlights`}
              value={highlights}
              onChange={(event) => setHighlights(event.target.value)}
              maxLength={10000}
            />
          </label>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {queued ? (
            <p className="text-xs text-muted-foreground">
              Fill your queued answers before adding a record.
            </p>
          ) : null}
          <Button
            disabled={disabled || queued}
            onClick={async () => {
              const id = (prefix: string) =>
                `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`
              const bullets = highlights
                .split("\n")
                .map((text) => text.trim())
                .filter(Boolean)
                .map((text) => ({ id: id("bul"), text }))
              const common = { applicationId, confirmed: true }
              const parsed = SupplementalRecordSchema.safeParse({
                ...common,
                record:
                  kind === "experience"
                    ? {
                        id: id("exp"),
                        kind,
                        company: organization.trim(),
                        role: role.trim(),
                        start,
                        end: present ? "present" : end,
                        bullets,
                      }
                    : {
                        id: id("edu"),
                        kind,
                        school: organization.trim(),
                        degree: role.trim() || undefined,
                        field: study.trim() || undefined,
                        start: start || undefined,
                        end: present ? "present" : end || undefined,
                        bullets,
                      },
              })
              if (!parsed.success) {
                setError(
                  "Check the required details and dates. Use one short highlight per line."
                )
                return
              }
              if (await add(parsed.data)) {
                setOpen(false)
                setOrganization("")
                setRole("")
                setStudy("")
                setStart("")
                setEnd("")
                setPresent(false)
                setHighlights("")
                setError("")
              }
            }}
          >
            Confirm record and fill current page
          </Button>
        </fieldset>
      ) : null}
    </section>
  )
}
