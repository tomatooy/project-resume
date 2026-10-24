import { type RefObject, useEffect, useRef } from "react"

import { clampZoom, type PreviewStore } from "./preview-store"

/**
 * How far a single wheel event may take the zoom. A pinch arrives as a stream
 * of small deltas that add up; a mouse wheel arrives as one big notch under
 * the same Ctrl, and should move the zoom by a step rather than by a factor of
 * three. Exponential, so a step feels the same at 50 percent as at 150.
 */
const SENSITIVITY = 0.005
const MIN_STEP = 0.85
const MAX_STEP = 1.18

/** Firefox measures wheel deltas in lines, and a rare mode in pages. */
const LINE_HEIGHT = 16
const PAGE_HEIGHT = 800

/** Where the pointer sat, how much content there was, and which zoom the
 *  pages were at, when a pinch step landed. The correction needs all three to
 *  put that point back under the pointer once they have taken their new
 *  size. */
type Anchor = {
  zoom: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
  scrollWidth: number
  scrollHeight: number
}

/** The zoom a pinch event asks for, clamped to the viewer's range. */
export function pinchedZoom(
  current: number,
  deltaY: number,
  deltaMode = 0
): number {
  const delta =
    deltaMode === WheelEvent.DOM_DELTA_LINE
      ? deltaY * LINE_HEIGHT
      : deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? deltaY * PAGE_HEIGHT
        : deltaY
  const step = Math.min(
    MAX_STEP,
    Math.max(MIN_STEP, Math.exp(-delta * SENSITIVITY))
  )
  return clampZoom(current * step)
}

/**
 * Trackpad pinch zoom. A pinch has no event of its own: the browser reports it
 * as a wheel event with ctrlKey set, and Ctrl+wheel from a mouse arrives the
 * same way. Plain two-finger scrolling is left to the scroll container.
 *
 * Returns the ref for that container. The zoom is anchored to the point under
 * the pointer, and `zoom` is what tells the hook the pages have resized.
 */
export function usePinchZoom(
  store: PreviewStore,
  zoom: number
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const anchor = useRef<Anchor | null>(null)
  // The zoom the pages are at. It trails the store while a pinch is throttled,
  // and an anchor has to be taken against what is on screen, not against what
  // the next commit will show.
  const rendered = useRef(zoom)

  useEffect(() => {
    rendered.current = zoom
  }, [zoom])

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      // Swallowed even at the ends of the range, so a pinch that has run out
      // of zoom does not zoom the browser page instead.
      event.preventDefault()

      const current = store.state.zoom
      const next = pinchedZoom(current, event.deltaY, event.deltaMode)
      if (next === current) return

      anchor.current = {
        zoom: rendered.current,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      }
      store.setState((state) => ({ ...state, zoom: next }))
    }

    const dropAnchor = () => {
      anchor.current = null
    }

    element.addEventListener("wheel", onWheel, { passive: false })
    // Scrolling between the pinch and the resize makes the anchor stale.
    element.addEventListener("scroll", dropAnchor, { passive: true })
    return () => {
      element.removeEventListener("wheel", onWheel)
      element.removeEventListener("scroll", dropAnchor)
    }
  }, [store])

  useEffect(() => {
    const element = ref.current
    const start = anchor.current
    // Still at the zoom the anchor was taken at, so the pages have not taken
    // their new size yet: what is measured below would be the old layout. Hold
    // the anchor for the commit that resizes them.
    if (!element || !start || start.zoom === zoom) return
    anchor.current = null

    // The pages have resized by now: a canvas sets its own size in a child
    // effect, and effects run children first. Measured rather than derived
    // from the zoom ratio, because the gaps between pages keep their size
    // while the pages themselves do not.
    const scaleX =
      start.scrollWidth > 0 ? element.scrollWidth / start.scrollWidth : 1
    const scaleY =
      start.scrollHeight > 0 ? element.scrollHeight / start.scrollHeight : 1
    const bounds = element.getBoundingClientRect()
    const x = start.clientX - bounds.left
    const y = start.clientY - bounds.top

    element.scrollLeft = (start.scrollLeft + x) * scaleX - x
    element.scrollTop = (start.scrollTop + y) * scaleY - y
  }, [zoom])

  return ref
}
