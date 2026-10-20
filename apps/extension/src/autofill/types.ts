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
  options(): HTMLElement[]
  values(): string[]
  clearer(): HTMLElement | null
}

export type ScannedField = {
  descriptor: FieldDescriptor
  /** The control, or the group container for radios, checkboxes and buttons. */
  element: HTMLElement
  kind: DriverKind
  /** The page's options in order after placeholders: `choices[n - 1]` is `#n`. */
  choices: { element: HTMLElement; label: string }[]
  combo?: ComboParts
}

export type WriteOutcome = z.infer<typeof WriteOutcomeSchema>

export type FieldHandle = {
  descriptor: FieldDescriptor
  hasValue(): boolean
  readOptions(): Promise<Option[] | null>
  write(fill: Fill): Promise<WriteOutcome>
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
