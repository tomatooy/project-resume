import { CalendarBlankIcon, XIcon } from "@phosphor-icons/react"
import { formatYearMonth } from "@workspace/resume-schema"
import { Calendar } from "@workspace/ui/components/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"
import {
  useEffect,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react"

/**
 * The editor's own field primitives. They are deliberately not the shadcn form
 * components: the design specifies a 34px control with an 11px label above it,
 * and every field writes straight through to the document store rather than
 * living in form state.
 */

export function FieldShell({
  label,
  error,
  hint,
  className,
  children,
}: {
  label?: string
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <div className="mb-[5px] text-[11px] font-medium text-muted-foreground">
          {label}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-[11px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

const CONTROL =
  "w-full rounded-[7px] border bg-card px-2.5 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary"

/**
 * Holds a field's error back while the user is part-way through typing it.
 *
 * Errors are re-derived from the document on every keystroke, so a value on
 * its way to a good one is invalid for a moment: a required field cleared
 * before being retyped, half of an email address, a month picked one component
 * at a time. Reporting those is nagging, not help. The message comes back the
 * moment the field is left, and a standing error stays on screen while the
 * field is merely focused, so entering a bad field still shows what is wrong.
 */
function useEditGate(error: string | undefined) {
  const [typing, setTyping] = useState(false)
  return {
    error: typing ? undefined : error,
    onBlur: () => setTyping(false),
    onEdit: () => setTyping(true),
  }
}

export type TextInputProps = {
  label?: string
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  error?: string
  hint?: string
  className?: string
  onFocus?: () => void
  ariaLabel?: string
}

/**
 * Writes on every keystroke so the live preview keeps up, which is why the
 * store coalesces consecutive edits to one field into a single undo entry.
 */
export function TextInput({
  label,
  value,
  onCommit,
  placeholder,
  error,
  hint,
  className,
  onFocus,
  ariaLabel,
}: TextInputProps) {
  const gate = useEditGate(error)

  return (
    <FieldShell
      label={label}
      error={gate.error}
      hint={hint}
      className={className}
    >
      <input
        value={value}
        aria-label={ariaLabel ?? label}
        aria-invalid={Boolean(gate.error)}
        placeholder={placeholder}
        onFocus={onFocus}
        onBlur={gate.onBlur}
        onChange={(event) => {
          gate.onEdit()
          onCommit(event.target.value)
        }}
        className={cn(
          CONTROL,
          "h-[34px]",
          gate.error ? "border-destructive" : "border-border"
        )}
      />
    </FieldShell>
  )
}

export function TextAreaInput({
  label,
  value,
  onCommit,
  placeholder,
  error,
  hint,
  rows = 4,
  className,
  onFocus,
  onBlur,
  ariaLabel,
  ...rest
}: Omit<TextInputProps, "className"> & {
  rows?: number
  className?: string
} & Pick<TextareaHTMLAttributes<HTMLTextAreaElement>, "onKeyDown" | "onBlur">) {
  const gate = useEditGate(error)

  return (
    <FieldShell
      label={label}
      error={gate.error}
      hint={hint}
      className={className}
    >
      <textarea
        value={value}
        rows={rows}
        aria-label={ariaLabel ?? label}
        aria-invalid={Boolean(gate.error)}
        placeholder={placeholder}
        onFocus={onFocus}
        onBlur={(event) => {
          gate.onBlur()
          onBlur?.(event)
        }}
        onChange={(event) => {
          gate.onEdit()
          onCommit(event.target.value)
        }}
        className={cn(
          CONTROL,
          "resize-y py-2 leading-[1.55]",
          gate.error ? "border-destructive" : "border-border"
        )}
        {...rest}
      />
    </FieldShell>
  )
}

const MONTH_RE = /^(\d{4})-(\d{2})$/

/** `2024-01` -> first of that month in local time, or `undefined`. */
function monthToDate(value: string): Date | undefined {
  const match = MONTH_RE.exec(value)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, 1)
}

/** Any day in a month -> `YYYY-MM` in local time. */
function dateToMonth(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

// The year dropdown only needs to be generous, not infinite; resume dates
// rarely predate 1950.
const START_MONTH = new Date(1950, 0)
const END_MONTH = new Date(new Date().getFullYear() + 6, 11)

/**
 * The document stores `YYYY-MM`, so picking is month-granular: the dropdown
 * caption navigates to the month and year, and clicking any day commits that
 * day's month.
 */
function MonthPicker({
  value,
  onCommit,
  placeholder = "Month",
  error,
  ariaLabel,
  disabled = false,
  className,
  onEditingChange,
}: {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  error?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
  onEditingChange?: (editing: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState<Date>(
    () => monthToDate(value) ?? new Date()
  )

  // Reopen on the month the field holds, not wherever it was navigated last.
  useEffect(() => {
    if (open) setViewMonth(monthToDate(value) ?? new Date())
  }, [open, value])

  const setOpenTracked = (next: boolean) => {
    setOpen(next)
    onEditingChange?.(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpenTracked}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
        className={cn(
          CONTROL,
          "flex h-[34px] min-w-0 items-center justify-between gap-1.5 text-left disabled:bg-muted disabled:text-muted-foreground",
          error ? "border-destructive" : "border-border",
          className
        )}
      >
        <span
          className={cn(
            "truncate",
            value ? "text-foreground" : "text-muted-foreground/70"
          )}
        >
          {value ? formatYearMonth(value) : placeholder}
        </span>
        <CalendarBlankIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={monthToDate(value)}
          month={viewMonth}
          onMonthChange={setViewMonth}
          onSelect={(date) => {
            if (!date) return
            onCommit(dateToMonth(date))
            setOpenTracked(false)
          }}
          captionLayout="dropdown"
          startMonth={START_MONTH}
          endMonth={END_MONTH}
          showOutsideDays={false}
        />
      </PopoverContent>
    </Popover>
  )
}

export function MonthInput({
  label,
  value,
  onCommit,
  error,
  className,
}: {
  label?: string
  value: string
  onCommit: (value: string) => void
  error?: string
  className?: string
}) {
  const gate = useEditGate(error)

  return (
    <FieldShell label={label} error={gate.error} className={className}>
      <MonthPicker
        value={value}
        onCommit={onCommit}
        error={gate.error}
        ariaLabel={label}
        onEditingChange={(editing) => (editing ? gate.onEdit() : gate.onBlur())}
      />
    </FieldShell>
  )
}

/**
 * An end date is either a month or the literal `present`, so the checkbox and
 * the month picker are one control rather than two that can disagree.
 */
export function EndDateInput({
  label = "End",
  value,
  onCommit,
  error,
}: {
  label?: string
  value: string | undefined
  onCommit: (value: string) => void
  error?: string
}) {
  const present = value === "present"
  const [lastMonth, setLastMonth] = useState(present ? "" : (value ?? ""))

  useEffect(() => {
    if (value && value !== "present") setLastMonth(value)
  }, [value])

  const gate = useEditGate(error)

  return (
    <FieldShell label={label} error={gate.error}>
      {/* Both halves share one gate: unticking Present hands the month picker
          back an empty value, and that is the start of an edit, not a
          mistake to report while the user is still working. */}
      <div className="flex items-center gap-2">
        <MonthPicker
          value={present ? "" : (value ?? "")}
          onCommit={onCommit}
          error={gate.error}
          ariaLabel={label}
          disabled={present}
          className="flex-1"
          onEditingChange={(editing) =>
            editing ? gate.onEdit() : gate.onBlur()
          }
        />
        <label className="flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-border px-2.5 text-[12px] text-muted-foreground has-checked:border-primary has-checked:bg-primary/8 has-checked:text-primary-text">
          <input
            type="checkbox"
            checked={present}
            onBlur={gate.onBlur}
            onChange={(event) => {
              gate.onEdit()
              onCommit(event.target.checked ? "present" : lastMonth)
            }}
            className="size-3 accent-[var(--primary)]"
          />
          Present
        </label>
      </div>
    </FieldShell>
  )
}

/** Comma or Enter commits a chip. Backspace on an empty input removes the last. */
export function ChipInput({
  label,
  values,
  onCommit,
  placeholder = "Add a skill",
  error,
}: {
  label?: string
  values: string[]
  onCommit: (values: string[]) => void
  placeholder?: string
  error?: string
}) {
  const [draft, setDraft] = useState("")

  const add = (raw: string) => {
    const next = raw.trim().replace(/,$/, "").trim()
    if (!next || values.includes(next)) {
      setDraft("")
      return
    }
    onCommit([...values, next])
    setDraft("")
  }

  return (
    <FieldShell label={label} error={error}>
      <div
        className={cn(
          "flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-[7px] border bg-card p-1.5",
          error ? "border-destructive" : "border-border"
        )}
      >
        {values.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1 pl-2.5 text-[11.5px]"
          >
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={(event) => {
                event.stopPropagation()
                onCommit(values.filter((v) => v !== value))
              }}
              className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-2.5" weight="bold" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={values.length === 0 ? placeholder : ""}
          aria-label={label}
          onChange={(event) => {
            if (event.target.value.endsWith(",")) add(event.target.value)
            else setDraft(event.target.value)
          }}
          onBlur={() => add(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add(draft)
            }
            if (
              event.key === "Backspace" &&
              draft === "" &&
              values.length > 0
            ) {
              onCommit(values.slice(0, -1))
            }
          }}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[12.5px] outline-none placeholder:text-muted-foreground/70"
        />
      </div>
    </FieldShell>
  )
}
