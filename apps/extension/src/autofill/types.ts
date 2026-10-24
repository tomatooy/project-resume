import type {
  AutofillVendor,
  FieldDescriptor,
  Fill,
  Option,
} from "@workspace/autofill/fields"
import type { z } from "zod"
import type {
  PageInfoSchema,
  WriteOutcomeSchema,
} from "../lib/autofill-protocol"

/** The company and job title the page shows. */
export type PageInfo = z.infer<typeof PageInfoSchema>

/** How a field is read and written: a native control or a vendor widget. */
export type DriverKind =
  | "text"
  | "select"
  | "radio"
  | "checkbox"
  | "checkboxes"
  | "file"
  | "combo"
  | "buttons"

/** The parts of a react-select style combobox. */
export type ComboParts = {
  input: HTMLInputElement
  opener: HTMLElement
  location?: boolean
  loading?(): boolean
  /** Vendors that search on keyboard events instead of input/change. */
  setQuery?(value: string): void
  options(): HTMLElement[]
  /** The value label when a result also renders supporting details. */
  optionLabel?(option: HTMLElement): string
  matchSearch?(target: string, labels: readonly string[]): number | null
  values(): string[]
  clearer(): HTMLElement | null
}

export type ResolveLocation = (
  fieldId: string,
  options: Option[]
) => Promise<Option | null>

export type ScannedField = {
  descriptor: FieldDescriptor
  /** The control, or the group container for radios, checkboxes and buttons. */
  element: HTMLElement
  kind: DriverKind
  /** The page's options in order after placeholders: `choices[n - 1]` is `#n`. */
  choices: { element: HTMLElement; label: string }[]
  combo?: ComboParts
  /** A date picker's text input: date fills (YYYY-MM-DD) are typed in this format. */
  dateFormat?: "MM/DD/YYYY"
}

/** A scanned field's live parts on the page, without what is sent on. */
export type LiveField = Omit<ScannedField, "descriptor">

export type WriteOutcome = z.infer<typeof WriteOutcomeSchema>

export type FieldHandle = {
  descriptor: FieldDescriptor
  hasValue(): boolean
  readOptions(cancelled?: () => boolean): Promise<Option[] | null>
  write(
    fill: Fill,
    cancelled?: () => boolean,
    resolveLocation?: ResolveLocation
  ): Promise<WriteOutcome>
  clear(): Promise<void>
  focus(): void
}

/** What a vendor knows about its pages: posting keys, the form, its fields. */
export type VendorAdapter = {
  vendor: AutofillVendor
  postingKey(url: URL): string | null
  findForm(doc: Document): Element | null
  formLink(doc: Document, url: URL): string | null
  scan(form: Element): ScannedField[]
  page(doc: Document, url: URL): PageInfo
  attachedName?(field: ScannedField): string | null
}
