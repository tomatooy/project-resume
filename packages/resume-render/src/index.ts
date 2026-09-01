export { registerFonts, SANS, SERIF } from "./fonts"
export { ResumeDocument, type ResumeDocumentProps } from "./document"
export { templates, templateList } from "./templates/index"
export { accents, ink } from "./tokens"
export {
  defaultTemplateOptions,
  isTemplateId,
  TEMPLATE_IDS,
  type FontScale,
  type PageSize,
  type TemplateDefinition,
  type TemplateId,
  type TemplateOptions,
} from "./types"

/**
 * Re-exported so the application never imports `@react-pdf/renderer` directly.
 * That package and the `react-pdf` viewer both export `Document` and `Page`;
 * keeping the renderer's surface inside this package is what stops the two
 * being mixed in one file.
 */
export { pdf, usePDF } from "@react-pdf/renderer"
