export * from "./domain/job-identity"
export * from "./domain/linkedin-extension"
export * from "./domain/tailor-operation"
export * from "./domain/tailor-input"
export * from "./domain/job-target"
export {
  ResumeSummarySchema,
  ResumePageSchema,
  ResumePageInputSchema,
} from "./domain/resume"

export * from "./autofill-profile/schema"
export * from "./autofill/contract"
export * from "./autofill/page-contract"
export * from "./autofill/page-projection"
export {
  AutofillDraftSchema,
  type AutofillDraft,
} from "./autofill/interpreter-port"
export { meaningForField, conditionsForField } from "./autofill/answers"
export { isResumeUpload, acceptsResumePdf } from "./autofill/upload"

// The source service replaced the prepare operation in place, so the two
// operations the extension still calls are named here rather than through the
// retired planner contract.
export {
  PrepareSourcesInputSchema,
  SourcePreparationSchema,
  PdfDocumentInputSchema,
  PdfDocumentSchema,
  type PdfDocument,
  type SourcePreparation,
} from "./dom-agent/source-service"
