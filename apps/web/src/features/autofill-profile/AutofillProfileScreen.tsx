import { useEffect, useState, useId, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import {
  EEO_DEFINITIONS,
  EeoQuestionSchema,
  ProfileSections,
  ProfileSectionSchema,
  type ProfileData,
  type ProfileSection,
} from "@workspace/resume-core/contracts"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import { useWorkspace } from "@/features/workspace/context"
import { autofillProfileQuery, useResumes } from "@/lib/queries"
import { getAutofillProfile, updateAutofillProfile, getResume } from "@/lib/api"
import { ProfileEditor } from "./editor"
import { SavedAnswers } from "./SavedAnswers"

const names: Record<ProfileSection, string> = {
  identity: "Identity",
  links: "Links",
  address: "Address",
  workAuthorization: "Work authorization",
  eeo: "Voluntary self-identification",
  preferences: "Application preferences",
  aliases: "School and company aliases",
}
const labels: Record<string, string> = {
  displayName: "Display name",
  email: "Contact email",
  phone: "Phone number",
  legalGivenName: "Legal given name",
  legalMiddleName: "Legal middle name",
  legalFamilyName: "Legal family name",
  preferredName: "Preferred name",
  linkedinUrl: "LinkedIn profile URL",
  githubUrl: "GitHub URL",
  portfolioUrl: "Portfolio URL",
  websiteUrl: "Website URL",
  countryCode: "Country (two-letter code)",
  addressLine1: "Street address",
  addressLine2: "Apartment / suite",
  city: "City",
  administrativeArea: "State / province",
  postalCode: "Postal code",
}
export function AutofillProfileScreen({
  userId,
  section,
}: {
  userId: string
  section: ProfileSection
}) {
  const query = useQuery(autofillProfileQuery(userId))
  const workspace = useWorkspace()
  const [editor, setEditor] = useState<ProfileEditor | null>(workspace.profile)
  useEffect(() => {
    if (query.data && !editor) {
      const value = new ProfileEditor(
        query.data,
        updateAutofillProfile,
        getAutofillProfile
      )
      workspace.profile = value
      setEditor(value)
    }
  }, [query.data, editor, workspace])
  if (!editor)
    return (
      <div className="p-6">
        {query.error ? (
          <>
            <p>Could not load your profile.</p>
            <Button onClick={() => void query.refetch()}>Retry</Button>
          </>
        ) : (
          "Loading profile…"
        )}
      </div>
    )
  return (
    <ProfileForm editor={editor} initialSection={section} userId={userId} />
  )
}
function ProfileForm({
  editor,
  initialSection,
  userId,
}: {
  editor: ProfileEditor
  initialSection: ProfileSection
  userId: string
}) {
  const state = useStore(editor.store)
  const [active, setActive] = useState(initialSection)
  const [eeoOpen, setEeoOpen] = useState(false)
  useEffect(() => {
    setActive(initialSection)
  }, [initialSection])
  const draft = state.draft
  const save = () => {
    void editor.save(active).catch(() => undefined)
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-card p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Autofill Profile</h1>
          <p className="mt-2 text-muted-foreground">
            Saved application details shared across your resumes. Only saved
            changes are available to the extension.
          </p>
        </header>
        <nav className="flex flex-wrap gap-1" aria-label="Profile sections">
          {ProfileSectionSchema.options.map((key) => (
            <Button
              key={key}
              variant={active === key ? "secondary" : "ghost"}
              onClick={() => setActive(key)}
            >
              {names[key]}
            </Button>
          ))}
        </nav>
        <p role="status" className="text-xs text-muted-foreground">
          {state.busy ? "Saving…" : state.dirty ? "Unsaved changes" : "Saved"} ·
          Revision {state.saved.revision}
        </p>
        {state.error ? (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        ) : null}
        {state.conflict ? (
          <section className="space-y-3 rounded border border-warning p-4">
            <h2 className="font-semibold">
              This profile changed in another tab
            </h2>
            <p>
              Your draft is preserved. Review the latest saved values before
              saving again.
            </p>
            {active === "eeo" ? (
              <details>
                <summary>Reveal saved EEO answers</summary>
                <SavedValues data={state.conflict.data[active]} />
              </details>
            ) : (
              <SavedValues data={state.conflict.data[active]} />
            )}
            <Button onClick={() => editor.reconcile()}>
              I reviewed the latest values, keep my draft
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                editor.reconcile()
                editor.discard()
              }}
            >
              Use saved profile
            </Button>
          </section>
        ) : null}
        <fieldset disabled={state.busy} className="space-y-4">
          <legend className="mb-4 text-base font-semibold">
            {names[active]}
          </legend>
          {active === "identity" ? (
            <ObjectFields
              value={{
                ...draft.identity,
                displayName: draft.identity.displayName ?? "",
                email: draft.identity.email ?? "",
                phone: draft.identity.phone ?? "",
              }}
              change={(v) => editor.set("identity", v)}
            />
          ) : null}
          {active === "links" ? (
            <>
              <ObjectFields
                value={draft.links}
                change={(v) => editor.set("links", v)}
              />
              <ImportLinks
                onImport={(v) => editor.set("links", { ...draft.links, ...v })}
              />
            </>
          ) : null}
          {active === "address" ? (
            <ObjectFields
              value={draft.address}
              change={(v) => editor.set("address", v)}
            />
          ) : null}
          {active === "workAuthorization" ? (
            <WorkFields
              value={draft.workAuthorization}
              change={(v) => editor.set("workAuthorization", v)}
            />
          ) : null}
          {active === "preferences" ? (
            <Preferences
              value={draft.preferences}
              change={(v) => editor.set("preferences", v)}
            />
          ) : null}
          {active === "aliases" ? (
            <AliasFields
              value={draft.aliases}
              change={(v) => editor.set("aliases", v)}
            />
          ) : null}
          {active === "eeo" ? (
            <>
              <p className="text-muted-foreground">
                Optional. You can skip this section. Saved answers are shown for
                your confirmation on each application. Definitions are specific
                to the question, not universal identity categories.
              </p>
              <Button variant="outline" onClick={() => setEeoOpen(!eeoOpen)}>
                {eeoOpen
                  ? "Hide sensitive answers"
                  : "Edit US self-identification answers"}
              </Button>
              {eeoOpen ? (
                <EeoFields
                  value={draft.eeo}
                  change={(v) => editor.set("eeo", v)}
                />
              ) : null}
            </>
          ) : null}
        </fieldset>
        <footer className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            disabled={state.busy || Boolean(state.conflict)}
            onClick={save}
          >
            Save changes
          </Button>
          <Button
            variant="outline"
            disabled={state.busy}
            onClick={() => editor.discard(active)}
          >
            Discard section changes
          </Button>
          <Button
            variant="ghost"
            disabled={state.busy}
            onClick={() => editor.clear(active)}
          >
            {active === "eeo" ? "Clear EEO information" : "Clear section"}
          </Button>
        </footer>
        <SavedAnswers userId={userId} />
      </div>
    </div>
  )
}
function TextField({
  label,
  value,
  change,
  type = "text",
}: {
  label: string
  value: string
  change: (v: string) => void
  type?: string
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="block space-y-1 text-sm">
      <span>{label}</span>
      <Input
        id={id}
        aria-label={label}
        type={type}
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  )
}
function ObjectFields<T extends Record<string, string>>({
  value,
  change,
}: {
  value: T
  change: (v: T) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Object.entries(value).map(([key, text]) => (
        <TextField
          key={key}
          label={labels[key] ?? key}
          value={text}
          change={(v) => change({ ...value, [key]: v })}
        />
      ))}
    </div>
  )
}
function Choice({
  label,
  value,
  options,
  change,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  change: (v: string) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="block space-y-1 text-sm">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v !== null) change(v)
        }}
      >
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
function YesNo({
  label,
  value,
  change,
}: {
  label: string
  value: "yes" | "no" | "unknown"
  change: (v: "yes" | "no" | "unknown") => void
}) {
  return (
    <Choice
      label={label}
      value={value}
      options={[
        { value: "unknown", label: "Not answered" },
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
      change={(v) => {
        if (v === "unknown" || v === "yes" || v === "no") change(v)
      }}
    />
  )
}
function WorkFields({
  value,
  change,
}: {
  value: ProfileData["workAuthorization"]
  change: (v: ProfileData["workAuthorization"]) => void
}) {
  const row: ProfileData["workAuthorization"][number] = value.find(
    (entry) => entry.countryCode === "US"
  ) ?? {
    countryCode: "US",
    authorizedToWork: "unknown",
    requiresSponsorshipNow: "unknown",
    requiresSponsorshipFuture: "unknown",
  }
  return (
    <div className="space-y-3">
      {(
        [
          {
            key: "authorizedToWork",
            label: "Are you currently authorized to work in the United States?",
          },
          {
            key: "requiresSponsorshipNow",
            label: "Do you require sponsorship now?",
          },
          {
            key: "requiresSponsorshipFuture",
            label: "Will you require sponsorship in the future?",
          },
        ] as const
      ).map(({ key, label }) => (
        <YesNo
          key={key}
          label={label}
          value={row[key]}
          change={(v) =>
            change([
              ...value.filter((entry) => entry.countryCode !== "US"),
              { ...row, [key]: v },
            ])
          }
        />
      ))}
    </div>
  )
}

function Preferences({
  value,
  change,
}: {
  value: ProfileData["preferences"]
  change: (v: ProfileData["preferences"]) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="Applies in country (two-letter code)"
        value={value.countryCode}
        change={(v) => change({ ...value, countryCode: v.toUpperCase() })}
      />
      <TextField
        label="Available from"
        value={value.availableFrom}
        type="date"
        change={(v) => change({ ...value, availableFrom: v })}
      />
      <YesNo
        label="Are you willing to relocate?"
        value={value.willingToRelocate}
        change={(v) => change({ ...value, willingToRelocate: v })}
      />
      <TextField
        label="Salary amount"
        type="number"
        value={value.salaryAmount === null ? "" : String(value.salaryAmount)}
        change={(v) =>
          change({ ...value, salaryAmount: v === "" ? null : Number(v) })
        }
      />
      <TextField
        label="Currency (three-letter code)"
        value={value.salaryCurrency}
        change={(v) => change({ ...value, salaryCurrency: v.toUpperCase() })}
      />
      <Choice
        label="Salary period"
        value={value.salaryPeriod}
        options={["unknown", "hour", "month", "year"].map((v) => ({
          value: v,
          label: v === "unknown" ? "Not answered" : v,
        }))}
        change={(v) => {
          const parsed =
            ProfileSections.preferences.shape.salaryPeriod.safeParse(v)
          if (parsed.success) change({ ...value, salaryPeriod: parsed.data })
        }}
      />
    </div>
  )
}
function EeoFields({
  value,
  change,
}: {
  value: ProfileData["eeo"]
  change: (v: ProfileData["eeo"]) => void
}) {
  return (
    <div className="space-y-4">
      {EEO_DEFINITIONS.map((definition) => {
        const row = value.responses.find(
          (r) => r.questionKey === definition.key
        )
        const answer = row?.answer
        const selected =
          answer?.state === "answered"
            ? answer.code
            : (answer?.state ?? "unanswered")
        const update = (code: string, description?: string) => {
          const key = EeoQuestionSchema.parse(definition.key)
          const others = value.responses.filter((r) => r.questionKey !== key)
          change({
            responses: [
              ...others,
              {
                countryCode: "US",
                questionKey: key,
                definitionVersion: "vs-us-1",
                answer:
                  code === "unanswered"
                    ? { state: "unanswered" }
                    : code === "decline_to_answer"
                      ? { state: "decline_to_answer" }
                      : {
                          state: "answered",
                          code,
                          ...(description ? { text: description } : {}),
                        },
              },
            ],
          })
        }
        return (
          <div key={definition.key} className="space-y-2">
            <Choice
              label={definition.title}
              value={selected}
              options={[
                { value: "unanswered", label: "Not answered" },
                ...definition.codes.map((c) => ({
                  value: c,
                  label: c.replaceAll("_", " "),
                })),
                { value: "decline_to_answer", label: "Prefer not to say" },
              ]}
              change={(v) => update(v)}
            />
            {selected === "self_described" ? (
              <TextField
                label="Your description"
                value={answer?.state === "answered" ? (answer.text ?? "") : ""}
                change={(v) => update(selected, v)}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
function AliasFields({
  value,
  change,
}: {
  value: ProfileData["aliases"]
  change: (v: ProfileData["aliases"]) => void
}) {
  const keys = useRef<string[]>([])
  const keyFor = (index: number) => {
    keys.current[index] ??= crypto.randomUUID()
    return keys.current[index]
  }
  return (
    <div className="space-y-4">
      {value.map((r, i) => (
        <div
          key={keyFor(i)}
          className="space-y-2 rounded border border-border p-4"
        >
          <Choice
            label="Entity"
            value={r.entityKind}
            options={[
              { value: "school", label: "School" },
              { value: "company", label: "Company" },
            ]}
            change={(v) => {
              if (v === "school" || v === "company")
                change(
                  value.map((r, n) => (n === i ? { ...r, entityKind: v } : r))
                )
            }}
          />
          <TextField
            label="Full canonical name"
            value={r.canonicalName}
            change={(v) =>
              change(
                value.map((r, n) => (n === i ? { ...r, canonicalName: v } : r))
              )
            }
          />
          <TextField
            label="Confirmed aliases (separate with semicolons)"
            value={r.aliases.join("; ")}
            change={(v) =>
              change(
                value.map((r, n) =>
                  n === i
                    ? { ...r, aliases: v.split(";").map((s) => s.trim()) }
                    : r
                )
              )
            }
          />
          <Button
            variant="ghost"
            onClick={() => {
              keys.current.splice(i, 1)
              change(value.filter((_, n) => n !== i))
            }}
          >
            Remove alias
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          change([
            ...value,
            { entityKind: "school", canonicalName: "", aliases: [] },
          ])
        }
      >
        Add alias
      </Button>
    </div>
  )
}
type SavedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SavedValue[]
  | { [key: string]: SavedValue }
function describeValue(value: SavedValue): string {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === "unknown"
  )
    return "Not answered"
  if (typeof value !== "object") return String(value).replaceAll("_", " ")
  if (Array.isArray(value))
    return value.length
      ? value.map((row) => describeValue(row)).join("; ")
      : "No entries"
  return Object.entries(value)
    .filter(([key]) => key !== "confirmedAt")
    .map(
      ([key, item]) =>
        `${labels[key] ?? key.replace(/([A-Z])/g, " $1").replaceAll("_", " ")}: ${describeValue(item)}`
    )
    .join(", ")
}
function SavedValues({ data }: { data: ProfileData[ProfileSection] }) {
  return (
    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
      {describeValue(data)}
    </p>
  )
}
function ImportLinks({
  onImport,
}: {
  onImport: (links: Partial<ProfileData["links"]>) => void
}) {
  const resumes = useResumes()
  const [preview, setPreview] = useState<Partial<ProfileData["links"]> | null>(
    null
  )
  const [error, setError] = useState("")
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <Choice
        label="Preview links from a resume"
        value=""
        options={(resumes.data ?? []).map((r) => ({
          value: r.id,
          label: r.title,
        }))}
        change={(id) => {
          void getResume({ id })
            .then((r) => {
              const links: Partial<ProfileData["links"]> = {}
              for (const link of r.data.basics.links) {
                if (/^https:\/\/(www\.)?linkedin\.com\/in\//i.test(link.url)) {
                  const u = new URL(link.url)
                  links.linkedinUrl = `https://www.linkedin.com${u.pathname.replace(/\/$/, "")}`
                } else if (/^https:\/\/github\.com\//i.test(link.url))
                  links.githubUrl = link.url
              }
              setPreview(links)
              setError("")
            })
            .catch(() => setError("Could not load links."))
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <>
          <SavedValues
            data={{
              ...ProfileSections.links.parse({
                linkedinUrl: "",
                githubUrl: "",
                portfolioUrl: "",
                websiteUrl: "",
              }),
              ...preview,
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              onImport(preview)
              setPreview(null)
            }}
          >
            Use these links in my draft
          </Button>
        </>
      ) : null}
    </section>
  )
}
