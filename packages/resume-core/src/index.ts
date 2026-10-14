export * from "./domain/index"
export * from "./ports/index"
export * from "./services/index"

export * from "./autofill-profile/schema"
export * from "./autofill-profile/service"
export * from "./autofill/contract"
export * from "./autofill/ports"
export * from "./autofill/answers"
export * from "./autofill/page-contract"
export * from "./autofill/page-projection"
export * from "./autofill/interpreter-port"

// The dom-agent protocol is reachable through its own subpath export rather
// than this barrel, because the retired engine's contract still exports names
// it also uses (ActionSchema, FactSchema, SourceRefSchema). Merging the two
// during the transition would silently shadow one with the other.
//
// The source service is named explicitly instead, so the one part of that
// protocol the server answers a request with stays reachable without pulling
// the whole subtree into this namespace.
export {
  RENDER_ASSET_VERSION,
  PrepareSourcesInputSchema,
  SourcePreparationSchema,
  PdfDocumentInputSchema,
  PdfDocumentSchema,
  SourceService,
  type PdfDocument,
  type SourceDeps,
  type SourcePreparation,
} from "./dom-agent/source-service"

// Account-level saved answers in the question's own shape. They belong on this
// barrel because the web app answers account requests with them, unlike the
// dom-agent protocol above, which is a page-side protocol and stays behind its
// own subpath. The legacy concept rows are read into this shape by
// `dom-agent/saved-answer.ts` and are never rewritten in place, so both
// vocabularies stay readable side by side.
export * from "./saved-answers"
