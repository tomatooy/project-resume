import { createFileRoute, Outlet } from "@tanstack/react-router"

import { ResumeTree } from "@/features/resume/ResumeTree"
import { PreviewProvider } from "@/features/resume/preview/preview-context"
import { ResumeSessionProvider } from "@/features/resume/session-context"
import { ResumeWorkspaceProvider } from "@/features/resume/workspace"
import { RailSlotContent } from "@/features/shell/rail-slot"
import { conversationQuery, resumeQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/r/$resumeId")({
  loader: async ({ params, context }) => {
    const [record, conversation] = await Promise.all([
      context.queryClient.ensureQueryData(resumeQuery(params.resumeId)),
      context.queryClient.ensureQueryData(conversationQuery(params.resumeId)),
    ])
    return { record, conversationId: conversation.id }
  },
  component: ResumeShell,
})

/**
 * Everything scoped to one open resume. The session and the PDF engine live
 * here so both survive switching between Editor, Export and Interview.
 */
function ResumeShell() {
  const { record, conversationId } = Route.useLoaderData()

  return (
    // Keyed so opening a different resume mounts a fresh session rather than
    // mutating the one already open.
    <ResumeSessionProvider
      key={record.id}
      record={record}
      conversationId={conversationId}
    >
      <PreviewProvider>
        <ResumeWorkspaceProvider>
          {/* Hangs the open resume's tree under its row in the rail, which
              the shell drew above this route. */}
          <RailSlotContent>
            <ResumeTree />
          </RailSlotContent>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        </ResumeWorkspaceProvider>
      </PreviewProvider>
    </ResumeSessionProvider>
  )
}
