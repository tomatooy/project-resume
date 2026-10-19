import { PlusIcon, XIcon } from "@phosphor-icons/react"
import {
  type Profile,
  type ProfileSection,
  US_STATES,
} from "@workspace/autofill"
import type { ProfileState } from "@workspace/resume-core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import {
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useState,
} from "react"

import { SECTIONS } from "./AutofillRail"
import {
  CheckGroup,
  type Choice,
  ChoiceField,
  Field,
  type FieldControl,
  fieldId,
  TextField,
  YesNoField,
} from "./fields"
import {
  CALLING_CODES,
  chooseRace,
  joinPhone,
  OTHER_CODE,
  profileIssues,
  type RaceAnswer,
  splitPhone,
} from "./profile-fields"
import { useProfileAutosave } from "./use-profile-autosave"

const BLOCKED = "Fix the highlighted fields to save your changes."
const DECLINE = "Decline to self-identify"
const LIST_LIMIT = 10

const MESSAGES = {
  email: "Enter an email address, like ada@example.com.",
  phone: "Enter the full phone number.",
  zip: "Use 5 digits, or ZIP+4 like 94103-1234.",
  url: "Use a full address that starts with https://.",
  amount: "Use a whole number above zero.",
  weeks: "Use a number of weeks from 0 to 52.",
  label: "Name this link.",
  language: "Name the language.",
}

const LEGEND =
  "mb-2 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"

type SectionProps = {
  profile: Profile
  set: <K extends keyof Profile>(key: K, next: Profile[K]) => void
  control: FieldControl
}

/** One anchored section of the page, the target of the rail's links. */
export function PageSection({
  anchor,
  title,
  children,
}: {
  anchor: ProfileSection
  title: string
  children?: ReactNode
}) {
  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className="mt-7 scroll-mt-6"
    >
      <h3
        id={`${anchor}-title`}
        className="text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase"
      >
        {title}
      </h3>
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  )
}

const BODIES: Record<
  Exclude<ProfileSection, "notes">,
  ComponentType<SectionProps>
> = {
  personal: Personal,
  contact: Contact,
  links: Links,
  "work-authorization": WorkAuthorization,
  preferences: Preferences,
  eeo: Eeo,
  other: Other,
}

/**
 * The saved Profile's sections, each change written back by the autosave.
 * A field the schema rejects holds every save until it is fixed, so once the
 * user has left such a field the page says so above the sections.
 */
export function ProfileForm({ state }: { state: ProfileState }) {
  const { profile, update, notice } = useProfileAutosave(state)
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const issues = useMemo(() => profileIssues(profile), [profile])
  const blocked = [...issues].some((path) => touched.has(path))
  const message = notice ?? (blocked ? BLOCKED : null)

  const props: SectionProps = {
    profile,
    set: (key, next) => update({ ...profile, [key]: next }),
    control: {
      invalid: (path) => touched.has(path) && issues.has(path),
      touch: (path) =>
        setTouched((current) =>
          current.has(path) ? current : new Set([...current, path])
        ),
    },
  }

  return (
    <div>
      {/* Always mounted, so a screen reader hears each message it gets. */}
      <div role="status" className={cn("sticky top-3 z-10", message && "mt-5")}>
        {message ? (
          <p className="rounded-[10px] border border-border bg-background px-3.5 py-2.5 text-[12px] shadow-sm">
            {message}
          </p>
        ) : null}
      </div>
      {SECTIONS.map(({ anchor, title }) => {
        if (anchor === "notes") return null
        const Body = BODIES[anchor]
        return (
          <PageSection key={anchor} anchor={anchor} title={title}>
            <Body {...props} />
          </PageSection>
        )
      })}
    </div>
  )
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
      {children}
    </div>
  )
}

/** Enter in a list's new-row box adds the row, as the button does. */
function onEnter(add: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    add()
  }
}

/* -------------------------------------------------------------- personal */

const PRONOUNS: readonly Choice<
  NonNullable<Profile["personal"]["pronouns"]>
>[] = [
  { value: "she/her", label: "she/her" },
  { value: "he/him", label: "he/him" },
  { value: "they/them", label: "they/them" },
  { value: "custom", label: "Custom" },
]

function Personal({ profile, set, control }: SectionProps) {
  const value = profile.personal
  const patch = (next: Partial<Profile["personal"]>) =>
    set("personal", { ...value, ...next })
  return (
    <Grid>
      <TextField
        control={control}
        path="personal.first"
        label="Legal first name"
        autoComplete="given-name"
        value={value.first}
        onChange={(first) => patch({ first })}
      />
      <TextField
        control={control}
        path="personal.middle"
        label="Middle name"
        optional
        autoComplete="additional-name"
        value={value.middle}
        onChange={(middle) => patch({ middle })}
      />
      <TextField
        control={control}
        path="personal.last"
        label="Legal last name"
        autoComplete="family-name"
        value={value.last}
        onChange={(last) => patch({ last })}
      />
      <TextField
        control={control}
        path="personal.preferred"
        label="Preferred first name"
        optional
        autoComplete="nickname"
        value={value.preferred}
        onChange={(preferred) => patch({ preferred })}
      />
      <ChoiceField
        id={fieldId("personal.pronouns")}
        label="Pronouns"
        value={value.pronouns}
        options={PRONOUNS}
        unset="Not set"
        onChange={(pronouns) => patch({ pronouns })}
      />
      {value.pronouns === "custom" ? (
        <TextField
          control={control}
          path="personal.pronounsCustom"
          label="Your pronouns"
          maxLength={40}
          value={value.pronounsCustom}
          onChange={(pronounsCustom) => patch({ pronounsCustom })}
        />
      ) : null}
    </Grid>
  )
}

/* --------------------------------------------------------------- contact */

const STATES: readonly Choice<string>[] = Object.entries(US_STATES).map(
  ([code, name]) => ({ value: code, label: name })
)

const CODE_ITEMS = [
  ...CALLING_CODES.map(({ code }) => ({ value: code, label: code })),
  { value: OTHER_CODE, label: "Other" },
]

function Contact({ profile, set, control }: SectionProps) {
  const value = profile.contact
  const patch = (next: Partial<Profile["contact"]>) =>
    set("contact", { ...value, ...next })
  return (
    <Grid>
      <TextField
        control={control}
        path="contact.email"
        label="Email"
        type="email"
        autoComplete="email"
        message={MESSAGES.email}
        value={value.email}
        onChange={(email) => patch({ email })}
      />
      <PhoneField
        control={control}
        value={value.phone}
        onChange={(phone) => patch({ phone })}
      />
      <TextField
        control={control}
        path="contact.street"
        label="Street address"
        optional
        autoComplete="address-line1"
        value={value.street}
        onChange={(street) => patch({ street })}
      />
      <TextField
        control={control}
        path="contact.apartment"
        label="Apartment or suite"
        optional
        autoComplete="address-line2"
        value={value.apartment}
        onChange={(apartment) => patch({ apartment })}
      />
      <TextField
        control={control}
        path="contact.city"
        label="City"
        autoComplete="address-level2"
        value={value.city}
        onChange={(city) => patch({ city })}
      />
      <ChoiceField
        id={fieldId("contact.state")}
        label="State"
        value={value.state || null}
        options={STATES}
        unset="Not set"
        onChange={(state) => patch({ state: state ?? "" })}
      />
      <TextField
        control={control}
        path="contact.zip"
        label="ZIP code"
        inputMode="numeric"
        autoComplete="postal-code"
        message={MESSAGES.zip}
        value={value.zip}
        onChange={(zip) => patch({ zip })}
      />
      <TextField
        control={control}
        path="contact.country"
        label="Country"
        autoComplete="country-name"
        value={value.country}
        onChange={(country) => patch({ country })}
      />
    </Grid>
  )
}

/**
 * A country code and the number after it, stored together as E.164. The code
 * is also kept here, because before any digits are typed the stored value is
 * "" and could not remember which code was picked.
 */
function PhoneField({
  control,
  value,
  onChange,
}: {
  control: FieldControl
  value: string
  onChange: (next: string) => void
}) {
  const path = "contact.phone"
  const id = fieldId(path)
  const invalid = control.invalid(path)
  const [chosen, setChosen] = useState(() => splitPhone(value).code)
  // A number loaded from elsewhere, after a conflict, brings its own code.
  const code =
    value === "" || value.startsWith(chosen) ? chosen : splitPhone(value).code
  if (code !== chosen) setChosen(code)
  const national = value.slice(code.length)

  return (
    <Field id={id} label="Phone" error={invalid ? MESSAGES.phone : undefined}>
      <div className="flex gap-2">
        <Select
          items={CODE_ITEMS}
          value={code}
          onValueChange={(next) => {
            if (next === null) return
            setChosen(next)
            onChange(joinPhone(next, national))
          }}
        >
          <SelectTrigger
            aria-label="Country code"
            className="w-[84px] flex-none text-[12.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CALLING_CODES.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.code} {option.country}
              </SelectItem>
            ))}
            <SelectItem value={OTHER_CODE}>
              Other (type the code with the number)
            </SelectItem>
          </SelectContent>
        </Select>
        <Input
          id={id}
          type="tel"
          autoComplete="tel-national"
          placeholder={code === OTHER_CODE ? "Country code and number" : ""}
          value={national}
          onChange={(event) => onChange(joinPhone(code, event.target.value))}
          onBlur={() => control.touch(path)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
        />
      </div>
    </Field>
  )
}

/* ----------------------------------------------------------------- links */

function Links({ profile, set, control }: SectionProps) {
  const value = profile.links
  const patch = (next: Partial<Profile["links"]>) =>
    set("links", { ...value, ...next })
  return (
    <div className="flex flex-col gap-5">
      <Grid>
        <TextField
          control={control}
          path="links.linkedin"
          label="LinkedIn"
          type="url"
          placeholder="https://www.linkedin.com/in/"
          message={MESSAGES.url}
          value={value.linkedin}
          onChange={(linkedin) => patch({ linkedin })}
        />
        <TextField
          control={control}
          path="links.github"
          label="GitHub"
          type="url"
          placeholder="https://github.com/"
          message={MESSAGES.url}
          value={value.github}
          onChange={(github) => patch({ github })}
        />
        <TextField
          control={control}
          path="links.portfolio"
          label="Portfolio"
          type="url"
          placeholder="https://"
          message={MESSAGES.url}
          value={value.portfolio}
          onChange={(portfolio) => patch({ portfolio })}
        />
        <TextField
          control={control}
          path="links.website"
          label="Website"
          type="url"
          placeholder="https://"
          message={MESSAGES.url}
          value={value.website}
          onChange={(website) => patch({ website })}
        />
      </Grid>
      <OtherLinks
        control={control}
        value={value.other}
        onChange={(other) => patch({ other })}
      />
    </div>
  )
}

function OtherLinks({
  control,
  value,
  onChange,
}: {
  control: FieldControl
  value: Profile["links"]["other"]
  onChange: (next: Profile["links"]["other"]) => void
}) {
  const [draft, setDraft] = useState({ label: "", url: "" })
  const ready = draft.label.trim() !== "" && draft.url.trim() !== ""

  function add() {
    if (!ready) return
    const index = value.length
    onChange([...value, { label: draft.label.trim(), url: draft.url.trim() }])
    // Added as typed, so an address the Profile rejects is pointed out now.
    control.touch(`links.other.${index}.label`)
    control.touch(`links.other.${index}.url`)
    setDraft({ label: "", url: "" })
  }

  return (
    <fieldset className="min-w-0">
      <legend className={LEGEND}>Other links</legend>
      <div className="flex flex-col gap-2">
        {value.map((link, index) => {
          const labelPath = `links.other.${index}.label`
          const urlPath = `links.other.${index}.url`
          const labelInvalid = control.invalid(labelPath)
          const urlInvalid = control.invalid(urlPath)
          const errorId = `${fieldId(`links.other.${index}`)}-error`
          const replace = (next: Partial<(typeof value)[number]>) =>
            onChange(
              value.map((row, at) => (at === index ? { ...row, ...next } : row))
            )
          return (
            // Rows have no identity of their own; the position is the key.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Link ${index + 1} label`}
                  maxLength={40}
                  value={link.label}
                  onChange={(event) => replace({ label: event.target.value })}
                  onBlur={() => control.touch(labelPath)}
                  aria-invalid={labelInvalid || undefined}
                  aria-describedby={labelInvalid ? errorId : undefined}
                  className="w-36 flex-none"
                />
                <Input
                  aria-label={`Link ${index + 1} address`}
                  type="url"
                  value={link.url}
                  onChange={(event) => replace({ url: event.target.value })}
                  onBlur={() => control.touch(urlPath)}
                  aria-invalid={urlInvalid || undefined}
                  aria-describedby={urlInvalid ? errorId : undefined}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove link ${index + 1}`}
                  onClick={() =>
                    onChange(value.filter((_, at) => at !== index))
                  }
                >
                  <XIcon />
                </Button>
              </div>
              <RowProblems
                id={errorId}
                problems={[
                  labelInvalid ? MESSAGES.label : null,
                  urlInvalid ? MESSAGES.url : null,
                ]}
              />
            </div>
          )
        })}
        {value.length < LIST_LIMIT ? (
          <div className="flex items-center gap-2">
            <Input
              aria-label="New link label"
              placeholder="Label"
              maxLength={40}
              value={draft.label}
              onChange={(event) =>
                setDraft({ ...draft, label: event.target.value })
              }
              onKeyDown={onEnter(add)}
              className="w-36 flex-none"
            />
            <Input
              aria-label="New link address"
              type="url"
              placeholder="https://"
              value={draft.url}
              onChange={(event) =>
                setDraft({ ...draft, url: event.target.value })
              }
              onKeyDown={onEnter(add)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!ready}
              onClick={add}
              className="flex-none"
            >
              <PlusIcon />
              Add link
            </Button>
          </div>
        ) : null}
      </div>
    </fieldset>
  )
}

function RowProblems({
  id,
  problems,
}: {
  id: string
  problems: (string | null)[]
}) {
  const shown = problems.filter((problem) => problem !== null)
  if (shown.length === 0) return null
  return (
    <p id={id} role="alert" className="text-[11.5px] text-destructive">
      {shown.join(" ")}
    </p>
  )
}

/* ---------------------------------------------------- work authorization */

const STATUSES: readonly Choice<NonNullable<Profile["workAuth"]["status"]>>[] =
  [
    { value: "citizen", label: "Citizen" },
    { value: "permanent-resident", label: "Permanent resident" },
    { value: "h1b", label: "H-1B" },
    { value: "f1-opt", label: "F-1 OPT" },
    { value: "f1-stem-opt", label: "F-1 STEM OPT" },
    { value: "other", label: "Other" },
  ]

function WorkAuthorization({ profile, set, control }: SectionProps) {
  const value = profile.workAuth
  const patch = (next: Partial<Profile["workAuth"]>) =>
    set("workAuth", { ...value, ...next })
  return (
    <Grid>
      <YesNoField
        id={fieldId("workAuth.authorized")}
        label="Authorized to work in the US"
        value={value.authorized}
        onChange={(authorized) => patch({ authorized })}
      />
      <YesNoField
        id={fieldId("workAuth.sponsorshipNow")}
        label="Needs sponsorship now"
        value={value.sponsorshipNow}
        onChange={(sponsorshipNow) => patch({ sponsorshipNow })}
      />
      <YesNoField
        id={fieldId("workAuth.sponsorshipFuture")}
        label="Needs sponsorship in the future"
        value={value.sponsorshipFuture}
        onChange={(sponsorshipFuture) => patch({ sponsorshipFuture })}
      />
      <ChoiceField
        id={fieldId("workAuth.status")}
        label="Status"
        value={value.status}
        options={STATUSES}
        unset="Not set"
        onChange={(status) => patch({ status })}
      />
      {value.status === "other" ? (
        <TextField
          control={control}
          path="workAuth.statusOther"
          label="Your status"
          maxLength={100}
          value={value.statusOther}
          onChange={(statusOther) => patch({ statusOther })}
        />
      ) : null}
      <TextField
        control={control}
        path="workAuth.expiry"
        label="Status expiry"
        optional
        type="date"
        value={value.expiry}
        onChange={(expiry) => patch({ expiry })}
      />
    </Grid>
  )
}

/* ----------------------------------------------------------- preferences */

/** Digits only: "" is no answer, anything else a whole number. */
function amount(text: string): number | null {
  const digits = text.replace(/\D/g, "")
  return digits === "" ? null : Number(digits)
}

function amountText(value: number | null): string {
  return value === null ? "" : String(value)
}

const CURRENCIES: readonly Choice<string>[] = ["USD", "CAD", "EUR", "GBP"].map(
  (currency) => ({ value: currency, label: currency })
)

const PERIODS: readonly Choice<Profile["preferences"]["salaryPeriod"]>[] = [
  { value: "year", label: "Per year" },
  { value: "hour", label: "Per hour" },
]

const START_KINDS: readonly Choice<
  NonNullable<Profile["preferences"]["startKind"]>
>[] = [
  { value: "date", label: "On a date" },
  { value: "notice", label: "After a notice period" },
]

const WORK_MODES: readonly Choice<
  Profile["preferences"]["workModes"][number]
>[] = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "Onsite" },
]

function Preferences({ profile, set, control }: SectionProps) {
  const value = profile.preferences
  const patch = (next: Partial<Profile["preferences"]>) =>
    set("preferences", { ...value, ...next })
  return (
    <div className="flex flex-col gap-5">
      <Grid>
        <TextField
          control={control}
          path="preferences.salaryMin"
          label="Minimum salary"
          inputMode="numeric"
          maxLength={9}
          message={MESSAGES.amount}
          value={amountText(value.salaryMin)}
          onChange={(text) => patch({ salaryMin: amount(text) })}
        />
        <TextField
          control={control}
          path="preferences.salaryMax"
          label="Maximum salary"
          optional
          inputMode="numeric"
          maxLength={9}
          message={MESSAGES.amount}
          value={amountText(value.salaryMax)}
          onChange={(text) => patch({ salaryMax: amount(text) })}
        />
        <ChoiceField
          id={fieldId("preferences.currency")}
          label="Currency"
          value={value.currency}
          options={CURRENCIES}
          onChange={(currency) => {
            if (currency !== null) patch({ currency })
          }}
        />
        <ChoiceField
          id={fieldId("preferences.salaryPeriod")}
          label="Pay period"
          value={value.salaryPeriod}
          options={PERIODS}
          onChange={(salaryPeriod) => {
            if (salaryPeriod !== null) patch({ salaryPeriod })
          }}
        />
        <ChoiceField
          id={fieldId("preferences.startKind")}
          label="Start"
          value={value.startKind}
          options={START_KINDS}
          unset="Not set"
          onChange={(startKind) => patch({ startKind })}
        />
        {value.startKind === "date" ? (
          <TextField
            control={control}
            path="preferences.startDate"
            label="Start date"
            type="date"
            value={value.startDate}
            onChange={(startDate) => patch({ startDate })}
          />
        ) : null}
        {value.startKind === "notice" ? (
          <TextField
            control={control}
            path="preferences.noticeWeeks"
            label="Notice in weeks"
            inputMode="numeric"
            maxLength={2}
            message={MESSAGES.weeks}
            value={amountText(value.noticeWeeks)}
            onChange={(text) => patch({ noticeWeeks: amount(text) })}
          />
        ) : null}
        <YesNoField
          id={fieldId("preferences.relocation")}
          label="Open to relocation"
          value={value.relocation}
          onChange={(relocation) => patch({ relocation })}
        />
      </Grid>
      <CheckGroup
        label="Work mode"
        options={WORK_MODES}
        checked={value.workModes}
        onChange={(mode, checked) =>
          patch({
            workModes: checked
              ? [...value.workModes.filter((m) => m !== mode), mode]
              : value.workModes.filter((m) => m !== mode),
          })
        }
      />
      <Cities value={value.cities} onChange={(cities) => patch({ cities })} />
    </div>
  )
}

function Cities({
  value,
  onChange,
}: {
  value: readonly string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")

  function add() {
    const city = draft.trim()
    if (city === "") return
    if (!value.includes(city)) onChange([...value, city])
    setDraft("")
  }

  return (
    <fieldset className="min-w-0">
      <legend className={LEGEND}>Preferred cities</legend>
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((city) => (
            <li
              key={city}
              className="flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-2.5 text-[12px]"
            >
              {city}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${city}`}
                className="size-5 rounded-full"
                onClick={() => onChange(value.filter((c) => c !== city))}
              >
                <XIcon className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.length < LIST_LIMIT ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label="New city"
            placeholder="City"
            maxLength={100}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onEnter(add)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={draft.trim() === ""}
            onClick={add}
            className="flex-none"
          >
            <PlusIcon />
            Add city
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}

/* ------------------------------------------------------------------- eeo */

const GENDERS: readonly Choice<Profile["eeo"]["gender"]>[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non-binary", label: "Non-binary" },
  { value: "decline", label: DECLINE },
]

const YES_NO_DECLINE: readonly Choice<"yes" | "no" | "decline">[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "decline", label: DECLINE },
]

const VETERAN: readonly Choice<Profile["eeo"]["veteran"]>[] = [
  { value: "protected", label: "Protected veteran" },
  { value: "not-protected", label: "Not a protected veteran" },
  { value: "decline", label: DECLINE },
]

const RACES: readonly Choice<RaceAnswer>[] = [
  { value: "american-indian", label: "American Indian or Alaska Native" },
  { value: "asian", label: "Asian" },
  { value: "black", label: "Black or African American" },
  {
    value: "pacific-islander",
    label: "Native Hawaiian or Other Pacific Islander",
  },
  { value: "white", label: "White" },
  { value: "decline", label: DECLINE },
]

function Eeo({ profile, set }: SectionProps) {
  const value = profile.eeo
  const patch = (next: Partial<Profile["eeo"]>) =>
    set("eeo", { ...value, ...next })
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[62ch] text-[12px] leading-[1.55] text-muted-foreground">
        Voluntary. Each answer starts as {DECLINE}.
      </p>
      <Grid>
        <ChoiceField
          id={fieldId("eeo.gender")}
          label="Gender"
          value={value.gender}
          options={GENDERS}
          onChange={(gender) => {
            if (gender !== null) patch({ gender })
          }}
        />
        <ChoiceField
          id={fieldId("eeo.hispanic")}
          label="Hispanic or Latino"
          value={value.hispanic}
          options={YES_NO_DECLINE}
          onChange={(hispanic) => {
            if (hispanic !== null) patch({ hispanic })
          }}
        />
        <ChoiceField
          id={fieldId("eeo.veteran")}
          label="Veteran status"
          value={value.veteran}
          options={VETERAN}
          onChange={(veteran) => {
            if (veteran !== null) patch({ veteran })
          }}
        />
        <ChoiceField
          id={fieldId("eeo.disability")}
          label="Disability"
          value={value.disability}
          options={YES_NO_DECLINE}
          onChange={(disability) => {
            if (disability !== null) patch({ disability })
          }}
        />
      </Grid>
      <CheckGroup
        label="Race"
        options={RACES}
        checked={value.race}
        onChange={(choice, checked) =>
          patch({ race: chooseRace(value.race, choice, checked) })
        }
      />
    </div>
  )
}

/* ----------------------------------------------------------------- other */

type Level = Profile["other"]["languages"][number]["level"]

const LEVELS: readonly Choice<Level>[] = [
  { value: "native", label: "Native" },
  { value: "fluent", label: "Fluent" },
  { value: "professional", label: "Professional" },
  { value: "basic", label: "Basic" },
]

function Other({ profile, set, control }: SectionProps) {
  const value = profile.other
  const patch = (next: Partial<Profile["other"]>) =>
    set("other", { ...value, ...next })
  return (
    <div className="flex flex-col gap-5">
      <Grid>
        <YesNoField
          id={fieldId("other.adult")}
          label="18 or older"
          value={value.adult}
          onChange={(adult) => patch({ adult })}
        />
        <YesNoField
          id={fieldId("other.backgroundCheck")}
          label="Willing to undergo a background check"
          value={value.backgroundCheck}
          onChange={(backgroundCheck) => patch({ backgroundCheck })}
        />
        <YesNoField
          id={fieldId("other.driversLicense")}
          label="Driver's license"
          value={value.driversLicense}
          onChange={(driversLicense) => patch({ driversLicense })}
        />
      </Grid>
      <Languages
        control={control}
        value={value.languages}
        onChange={(languages) => patch({ languages })}
      />
    </div>
  )
}

function LevelSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: Level
  onChange: (next: Level) => void
}) {
  return (
    <Select
      items={LEVELS}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next)
      }}
    >
      <SelectTrigger
        aria-label={label}
        className="w-[124px] flex-none text-[12.5px]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((level) => (
          <SelectItem key={level.value} value={level.value}>
            {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Languages({
  control,
  value,
  onChange,
}: {
  control: FieldControl
  value: Profile["other"]["languages"]
  onChange: (next: Profile["other"]["languages"]) => void
}) {
  const [draft, setDraft] = useState<{ language: string; level: Level }>({
    language: "",
    level: "professional",
  })

  function add() {
    const language = draft.language.trim()
    if (language === "") return
    onChange([...value, { language, level: draft.level }])
    setDraft({ language: "", level: draft.level })
  }

  return (
    <fieldset className="min-w-0">
      <legend className={LEGEND}>Languages</legend>
      <div className="flex flex-col gap-2">
        {value.map((row, index) => {
          const path = `other.languages.${index}.language`
          const invalid = control.invalid(path)
          const errorId = `${fieldId(path)}-error`
          const replace = (next: Partial<(typeof value)[number]>) =>
            onChange(
              value.map((item, at) =>
                at === index ? { ...item, ...next } : item
              )
            )
          return (
            // Rows have no identity of their own; the position is the key.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Language ${index + 1}`}
                  maxLength={60}
                  value={row.language}
                  onChange={(event) =>
                    replace({ language: event.target.value })
                  }
                  onBlur={() => control.touch(path)}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorId : undefined}
                />
                <LevelSelect
                  label={`Language ${index + 1} level`}
                  value={row.level}
                  onChange={(level) => replace({ level })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove language ${index + 1}`}
                  onClick={() =>
                    onChange(value.filter((_, at) => at !== index))
                  }
                >
                  <XIcon />
                </Button>
              </div>
              <RowProblems
                id={errorId}
                problems={[invalid ? MESSAGES.language : null]}
              />
            </div>
          )
        })}
        {value.length < LIST_LIMIT ? (
          <div className="flex items-center gap-2">
            <Input
              aria-label="New language"
              placeholder="Language"
              maxLength={60}
              value={draft.language}
              onChange={(event) =>
                setDraft({ ...draft, language: event.target.value })
              }
              onKeyDown={onEnter(add)}
            />
            <LevelSelect
              label="New language level"
              value={draft.level}
              onChange={(level) => setDraft({ ...draft, level })}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={draft.language.trim() === ""}
              onClick={add}
              className="flex-none"
            >
              <PlusIcon />
              Add language
            </Button>
          </div>
        ) : null}
      </div>
    </fieldset>
  )
}
