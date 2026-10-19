import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentProps, ReactNode } from "react"

export type Choice<T extends string> = { value: T; label: string }

/**
 * What a field needs from the form: whether to show its problem, and a way to
 * say the user has left it. A problem shows only after that, so a half-typed
 * email is not called wrong while it is still being typed.
 */
export type FieldControl = {
  invalid(path: string): boolean
  touch(path: string): void
}

/** "contact.email" is "profile-contact-email". */
export function fieldId(path: string): string {
  return `profile-${path.replaceAll(".", "-")}`
}

const LABEL =
  "text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"

export function Field({
  id,
  label,
  optional,
  error,
  className,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  error?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={LABEL}>
        {label}
        {optional ? (
          <span className="ml-1 font-normal normal-case opacity-70">
            optional
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-[11.5px] text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function TextField({
  control,
  path,
  label,
  value,
  onChange,
  optional,
  message,
  className,
  ...input
}: {
  control: FieldControl
  path: string
  label: string
  value: string
  onChange: (next: string) => void
  optional?: boolean
  /** What to say when the Profile rejects the value. */
  message?: string
  className?: string
} & Pick<
  ComponentProps<"input">,
  "type" | "autoComplete" | "inputMode" | "placeholder" | "maxLength"
>) {
  const id = fieldId(path)
  const invalid = control.invalid(path)
  return (
    <Field
      id={id}
      label={label}
      optional={optional}
      error={invalid ? message : undefined}
      className={className}
    >
      <Input
        id={id}
        {...input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => control.touch(path)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && message ? `${id}-error` : undefined}
      />
    </Field>
  )
}

/**
 * One answer from a list. With `unset`, the list starts with a "no answer"
 * row, which is how a yes/no question stays unanswered rather than "no".
 */
export function ChoiceField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  unset,
  optional,
  className,
}: {
  id: string
  label: string
  value: T | null
  options: readonly Choice<T>[]
  onChange: (next: T | null) => void
  unset?: string
  optional?: boolean
  className?: string
}) {
  const items: { value: T | null; label: string }[] = unset
    ? [{ value: null, label: unset }, ...options]
    : [...options]
  return (
    <Field id={id} label={label} optional={optional} className={className}>
      <Select items={items} value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full text-[12.5px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value ?? ""} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export const YES_NO: readonly Choice<"yes" | "no">[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
]

/** A yes/no question that can stay unanswered. */
export function YesNoField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: "yes" | "no" | null
  onChange: (next: "yes" | "no" | null) => void
}) {
  return (
    <ChoiceField
      id={id}
      label={label}
      value={value}
      options={YES_NO}
      onChange={onChange}
      unset="Not set"
    />
  )
}

/** Several answers from a list, one box each. */
export function CheckGroup<T extends string>({
  label,
  options,
  checked,
  onChange,
}: {
  label: string
  options: readonly Choice<T>[]
  checked: readonly T[]
  onChange: (value: T, checked: boolean) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={cn(LABEL, "mb-2")}>{label}</legend>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <Label
            key={option.value}
            className="w-fit text-[12.5px] leading-normal font-normal"
          >
            <Checkbox
              checked={checked.includes(option.value)}
              onCheckedChange={(next) => onChange(option.value, next)}
            />
            {option.label}
          </Label>
        ))}
      </div>
    </fieldset>
  )
}
