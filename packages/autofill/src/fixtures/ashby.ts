import type { FieldDescriptor } from "../fields"

const required = (
  id: string,
  label: string,
  control: FieldDescriptor["control"] = "text"
): FieldDescriptor => ({ id, label, control, required: true, hasValue: false })

/** The 7 fields of the Ashby application form (Ashby research 4.2), in order. */
export const ashbyFields: FieldDescriptor[] = [
  required("_systemfield_name", "Name"),
  required("_systemfield_email", "Email", "email"),
  required("_systemfield_resume", "Resume", "file"),
  required(
    "question_11916356008",
    "LinkedIn (preferred), personal site, or GitHub"
  ),
  {
    ...required(
      "question_11916357008",
      "Do you have three or more years of production-level experience with our tech stack?"
    ),
    // Reconstructed: the research says only that the stack is in the help text.
    help: "Our stack:\nTypeScript, Node.js and React\nPostgres on AWS",
  },
  required("question_11916358008", "What interests you about the role?"),
  required("question_11916361008", "How did you find us?"),
]
