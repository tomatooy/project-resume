import { useMemo, type ReactNode } from "react"
import {
  PreviewProvider as SharedPreviewProvider,
  type PreviewStore,
} from "@workspace/resume-preview"
import { useResumeState } from "../session-context"

export {
  usePreview,
  usePreviewDemand,
  usePreviewStore,
} from "@workspace/resume-preview"

export function PreviewProvider({
  children,
  store,
}: {
  children: ReactNode
  store?: PreviewStore
}) {
  const doc = useResumeState((s) => s.doc)
  const templateId = useResumeState((s) => s.templateId)
  const options = useResumeState((s) => s.templateOptions)
  const patches = useResumeState((s) => s.previewPatches)
  const input = useMemo(
    () => ({ doc, templateId, options, patches }),
    [doc, templateId, options, patches]
  )
  return (
    <SharedPreviewProvider input={input} store={store}>
      {children}
    </SharedPreviewProvider>
  )
}
