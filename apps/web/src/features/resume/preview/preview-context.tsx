import { useStore } from "@tanstack/react-store"
import {
  createContext,
  lazy,
  Suspense,
  use,
  useMemo,
  type ReactNode,
} from "react"

import { ClientOnly } from "@/lib/client-only"
import {
  createPreviewStore,
  type PreviewState,
  type PreviewStore,
} from "./preview-store"

// Kept out of the SSR bundle: both @react-pdf/renderer's usePDF and pdf.js
// assume a browser.
const PdfEngine = lazy(() => import("./PdfEngine"))

const PreviewContext = createContext<PreviewStore | null>(null)

/**
 * Owns the rendered PDF for the open resume. The engine lives here rather than
 * in the preview pane so the blob survives navigation between Editor, Export
 * and History, and so Export can download without re-rendering.
 */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createPreviewStore(), [])
  return (
    <PreviewContext value={store}>
      <ClientOnly>
        <Suspense fallback={null}>
          <PdfEngine store={store} />
        </Suspense>
      </ClientOnly>
      {children}
    </PreviewContext>
  )
}

export function usePreviewStore(): PreviewStore {
  const store = use(PreviewContext)
  if (!store)
    throw new Error("usePreviewStore must be used inside a PreviewProvider")
  return store
}

export function usePreview<T>(select: (state: PreviewState) => T): T {
  return useStore(usePreviewStore(), select)
}
