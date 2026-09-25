import { useStore } from "@tanstack/react-store"
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useResumeState } from "../session-context"
import {
  createPreviewStore,
  type PreviewState,
  type PreviewStore,
} from "./preview-store"
import { PreviewRenderQueue } from "./render-queue"

const PreviewContext = createContext<PreviewStore | null>(null)
const DemandContext = createContext<Dispatch<SetStateAction<number>> | null>(
  null
)

export function PreviewProvider({
  children,
  store: supplied,
}: {
  children: ReactNode
  store?: PreviewStore
}) {
  const local = useMemo(() => createPreviewStore(), [])
  const store = supplied ?? local
  const [demand, setDemand] = useState(0)
  const doc = useResumeState((s) => s.doc)
  const templateId = useResumeState((s) => s.templateId)
  const options = useResumeState((s) => s.templateOptions)
  const patches = useResumeState((s) => s.previewPatches)
  const input = useMemo(
    () => ({ doc, templateId, options, patches }),
    [doc, templateId, options, patches]
  )
  const queueRef = useRef<PreviewRenderQueue | null>(null)
  useEffect(() => {
    const queue = new PreviewRenderQueue(store, async (value) => {
      const { renderPreview } = await import("./PdfEngine")
      return renderPreview(value)
    })
    queueRef.current = queue
    return () => {
      queue.dispose()
      queueRef.current = null
    }
  }, [store])
  // Recreated queues also need the current input when the store changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: store recreates the queue above
  useEffect(() => {
    queueRef.current?.update(input, demand > 0)
  }, [input, demand, store])
  return (
    <PreviewContext value={store}>
      <DemandContext value={setDemand}>{children}</DemandContext>
    </PreviewContext>
  )
}

export function usePreviewDemand(): void {
  const setDemand = use(DemandContext)
  useEffect(() => {
    if (!setDemand) return
    setDemand((count) => count + 1)
    return () => setDemand((count) => count - 1)
  }, [setDemand])
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
