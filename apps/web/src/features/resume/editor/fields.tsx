import { XIcon } from "@phosphor-icons/react"
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
  "w-full rounded-[7px] border bg-paper px-2.5 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"

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
  return (
    <FieldShell label={label} error={error} hint={hint} className={className}>
      <input
        value={value}
        aria-label={ariaLabel ?? label}
        aria-invalid={Boolean(error)}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(event) => onCommit(event.target.value)}
        className={cn(
          CONTROL,
          "h-[34px]",
          error ? "border-destructive" : "border-border"
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
  ...rest
}: Omit<TextInputProps, "className"> & {
  rows?: number
  className?: string
} & Pick<TextareaHTMLAttributes<HTMLTextAreaElement>, "onKeyDown" | "onBlur">) {
  return (
    <FieldShell label={label} error={error} hint={hint} className={className}>
      <textarea
        value={value}
        rows={rows}
        aria-invalid={Boolean(error)}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(event) => onCommit(event.target.value)}
        className={cn(
          CONTROL,
          "resize-y py-2 leading-[1.55]",
          error ? "border-destructive" : "border-border"
        )}
        {...rest}
      />
    </FieldShell>
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
  return (
    <FieldShell label={label} error={error} className={className}>
      <input
        type="month"
        value={value}
        aria-label={label}
        aria-invalid={Boolean(error)}
        onChange={(event) => onCommit(event.target.value)}
        className={cn(
          CONTROL,
          // `w-full` alone does not contain a month input: the native picker
          // gives it a wide intrinsic minimum, and min-width:auto stops it
          // shrinking inside a grid cell, which scrolls the whole pane
          // sideways.
          "h-[34px] min-w-0",
          error ? "border-destructive" : "border-border"
        )}
      />
    </FieldShell>
  )
}

/**
 * An end date is either a month or the literal `present`, so the checkbox and
 * the month field are one control rather than two that can disagree.
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

  return (
    <FieldShell label={label} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="month"
          value={present ? "" : (value ?? "")}
          disabled={present}
          aria-label={label}
          onChange={(event) => onCommit(event.target.value)}
          className={cn(
            CONTROL,
            "h-[34px] min-w-0 flex-1 disabled:bg-muted disabled:text-muted-foreground",
            error ? "border-destructive" : "border-border"
          )}
        />
        <label className="flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-border px-2.5 text-[12px] text-muted-foreground has-checked:border-primary has-checked:bg-primary/8 has-checked:text-primary-strong">
          <input
            type="checkbox"
            checked={present}
            onChange={(event) =>
              onCommit(event.target.checked ? "present" : lastMonth)
            }
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
          "flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-[7px] border bg-paper p-1.5",
          error ? "border-destructive" : "border-border"
        )}
      >
        {values.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-full border border-border bg-canvas py-0.5 pr-1 pl-2.5 text-[11.5px]"
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
