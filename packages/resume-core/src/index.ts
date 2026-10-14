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
