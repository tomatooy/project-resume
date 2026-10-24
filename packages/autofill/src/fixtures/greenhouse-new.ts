import type { FieldDescriptor } from "../fields"

const select = (id: string, label: string): FieldDescriptor => ({
  id,
  label,
  control: "combobox",
  optionsPending: true,
  required: true,
  hasValue: false,
})

const link = (
  id: string,
  label: string,
  required: boolean
): FieldDescriptor => ({
  id,
  label,
  control: "text",
  required,
  maxLength: 255,
  hasValue: false,
})

/**
 * The 18 fields of the new Greenhouse board form (GH research 4.4) in page
 * order, as the scan reads them before anything is written. The react-select
 * options exist only while a menu is open, so the selects wait for them.
 */
export const greenhouseNewFields: FieldDescriptor[] = [
  {
    id: "first_name",
    label: "First Name",
    control: "text",
    required: true,
    maxLength: 255,
    hasValue: false,
    autocomplete: "given-name",
  },
  {
    id: "last_name",
    label: "Last Name",
    control: "text",
    required: true,
    maxLength: 255,
    hasValue: false,
    autocomplete: "family-name",
  },
  {
    id: "email",
    label: "Email",
    control: "email",
    required: true,
    maxLength: 255,
    hasValue: false,
    autocomplete: "email",
  },
  select("country", "Country"),
  {
    id: "phone",
    label: "Phone",
    control: "tel",
    required: true,
    hasValue: false,
    autocomplete: "tel",
  },
  {
    id: "candidate-location",
    label: "Location (City)",
    control: "combobox",
    searchable: true,
    required: true,
    hasValue: false,
  },
  {
    id: "resume",
    label: "Resume/CV",
    control: "file",
    required: true,
    hasValue: false,
  },
  select(
    "question_12521589004",
    "Are you currently based in any of these countries?"
  ),
  {
    ...select(
      "question_12521590004",
      "Will you require Visa Sponsorship now, or in the future?"
    ),
    // Reconstructed: the research quotes only "Please mark 'YES' ...".
    help: "Please mark 'YES' if you will now or in the future require sponsorship for employment visa status.",
  },
  select(
    "question_14151266004",
    "Your authorization to work in the country where you live"
  ),
  select(
    "question_12550683004",
    "Do you have experience implementing access control models (like OAuth)"
  ),
  link("question_12521592004", "LinkedIn Profile", true),
  link("question_12521593004", "Twitter", false),
  link("question_12521594004", "Github", false),
  link("question_12521595004", "Website", false),
  // Reconstructed: the research elides the middle of this label.
  select(
    "question_12521596004",
    "I acknowledge that I have read the Job Applicant Privacy Notice"
  ),
  // Reconstructed: the research quotes this label up to "is crucial...".
  select(
    "question_12521597004",
    "Please double-check all the information provided above. Ensuring accuracy is crucial for your application."
  ),
  select("question_17702872004", "Where did you first hear about this role?"),
]
