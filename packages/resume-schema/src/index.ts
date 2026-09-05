/**
 * The document contract, curated by hand.
 *
 * What is listed here is what the rest of the workspace may depend on: the
 * document and its node types, the patch contract and its two apply modes,
 * the validity and diff readers, templates, ids, and the import shape. The
 * per-item schemas, the id plumbing and `ValidationContext` stay inside;
 * the last one on purpose, since a caller holding it could validate a patch
 * against limits the skill registry never granted.
 */
export {
  type Basics,
  type Bullet,
  type Item,
  type Link,
  type Resume,
  ResumeSchema,
  type Section,
  type SectionTypeName,
  hasBullets,
} from "./schema"
export {
  DEFAULT_TEMPLATE_ID,
  type FontScale,
  FontScaleSchema,
  type PageSize,
  PageSizeSchema,
  TEMPLATE_IDS,
  type TemplateId,
  TemplateIdSchema,
  type TemplateOptions,
  TemplateOptionsSchema,
  defaultTemplateOptions,
  isTemplateId,
  toTemplateId,
  toTemplateOptions,
} from "./template"
export { newId, regenerateIds } from "./ids"
export {
  type NodeKind,
  type NodeRef,
  type ResumeNode,
  breadcrumb,
  collectText,
  findNode,
  indexNodes,
  nodeSummary,
  readField,
  scopeAnchor,
} from "./nodes"
export { type DocumentValidity, NO_ERRORS, documentErrors } from "./validity"
export {
  type ApplyResult,
  PATCH_ERROR_CODES,
  type PatchErrorCode,
  type PatchOp,
  type RejectedPatch,
  type ResumePatch,
  ResumePatchSchema,
  type StrictApplyResult,
  type ValidationResult,
  applyDraft,
  applyStrict,
  validatePatches,
} from "./patch"
export { formatRange, formatYearMonth } from "./format"
export { canonicalJson, contentHash } from "./hash"
export { type FieldChange, type NodeDiff, diffDocuments } from "./diff"
export { migrateResume } from "./migrate"
export {
  type ParsedResume,
  ParsedResumeSchema,
  assembleResume,
  importTitle,
} from "./parsed"
