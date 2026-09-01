import { Store } from "@tanstack/store"

export type PreviewState = {
  /** The most recent successful render. Kept while a new one is in flight so
   *  the viewer never blanks between keystrokes. */
  blob: Blob | null
  loading: boolean
  error: string | null
  pageCount: number | null
  /** Viewer zoom, as a percentage. */
  zoom: number
}

export const ZOOM_STEPS = [50, 75, 100, 125, 150] as const

export function createPreviewStore(): Store<PreviewState> {
  return new Store<PreviewState>({
    blob: null,
    loading: true,
    error: null,
    pageCount: null,
    zoom: 100,
  })
}

export type PreviewStore = ReturnType<typeof createPreviewStore>
