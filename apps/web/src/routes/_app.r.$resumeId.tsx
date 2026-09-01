import { createFileRoute, Outlet } from "@tanstack/react-router"

import { ModePill } from "@/features/shell/ModePill"
import { PreviewProvider } from "@/features/resume/preview/preview-context"
import { ResumeSessionProvider } from "@/features/resume/session-context"
import { getOrCreateConversation, getResume } from "@/lib/api"
import { qk } from "@/lib/query-keys"

export const Route = createFileRoute("/_app/r/$resumeId")({
  loader: async ({ params, context }) => {
    const [record, conversation] = await Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: qk.resume(params.resumeId),
        queryFn: () => getResume({ id: params.resumeId }),
      }),
      getOrCreateConversation({ resumeId: params.resumeId }),
    ])
    return { record, conversationId: conversation.id }
  },
  component: ResumeShell,
})

/**
 * Everything scoped to one open resume. The session and the PDF engine live
 * here so both survive switching between Editor, Export, Interview and History.
 */
function ResumeShell() {
  const { record } = Route.useLoaderData()
  const { resumeId } = Route.useParams()

  return (
    // Keyed so opening a different resume mounts a fresh session rather than
    // mutating the one already open.
    <ResumeSessionProvider key={record.id} record={record}>
      <PreviewProvider>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
        <ModePill resumeId={resumeId} />
      </PreviewProvider>
    </ResumeSessionProvider>
  )
}
