import { createFileRoute, Outlet } from "@tanstack/react-router"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"

import { AssistantPanel } from "@/features/chat/AssistantPanel"
import { PreflightIndicator } from "@/features/export/PreflightIndicator"
import { ResumeTree } from "@/features/resume/ResumeTree"
import { PreviewPane } from "@/features/resume/preview/PreviewPane"
import { PreviewProvider } from "@/features/resume/preview/preview-context"
import { ResumeSessionProvider } from "@/features/resume/session-context"
import { useWorkspaceLayout } from "@/features/resume/use-workspace-layout"
import { ResumeWorkspaceProvider } from "@/features/resume/workspace"
import { RailSlotContent } from "@/features/shell/rail-slot"
import { ResumeTabs } from "@/features/shell/ResumeTabs"
import { useResumeTab } from "@/features/shell/resume-tabs"
import { StatusBarExtra } from "@/features/shell/StatusBar"
import { conversationQuery, resumeQuery, skillsQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/r/$resumeId")({
  loader: async ({ params, context }) => {
    const [record, conversation] = await Promise.all([
      context.queryClient.ensureQueryData(resumeQuery(params.resumeId)),
      context.queryClient.ensureQueryData(conversationQuery(params.resumeId)),
      // The assistant's chips are one of the first things this screen paints;
      // having them cached already is what stops a flash of an empty row.
      context.queryClient.ensureQueryData(skillsQuery()),
    ])
    return { record, conversationId: conversation.id }
  },
  component: ResumeShell,
})

/**
 * Everything scoped to one open resume: the session and the PDF engine, the
 * tree under the resume's row in the rail, and the middle/side split every tab
 * sits in. The four tabs differ only in what the middle column renders, so the
 * strip and the split live here rather than in each screen: switching tabs
 * swaps one column and leaves the rest standing.
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
          {/* The status bar is rendered above this route, so the preflight
              control reaches it through the bar's portal host. It is true of
              every tab, so it is mounted once, here. */}
          <StatusBarExtra>
            <PreflightIndicator />
          </StatusBarExtra>
          <ResumeColumns resumeId={record.id} />
        </ResumeWorkspaceProvider>
      </PreviewProvider>
    </ResumeSessionProvider>
  )
}

/** The tab strip and the two columns that hold still under it. */
function ResumeColumns({ resumeId }: { resumeId: string }) {
  const tab = useResumeTab(resumeId)
  const layout = useWorkspaceLayout({ tab })
  const { panels, maximized, toggleMaximize, togglePanel } = layout

  // A pane lands in three layouts, so its props are written once here rather
  // than three times in the branches below.
  const preview = (compact: boolean) => (
    <PreviewPane
      compact={compact}
      maximized={maximized === "preview"}
      onToggleMaximize={() => toggleMaximize("preview")}
      onClose={() => togglePanel("preview")}
    />
  )
  const assistant = (
    <AssistantPanel
      maximized={maximized === "assistant"}
      onToggleMaximize={() => toggleMaximize("assistant")}
      onClose={() => togglePanel("assistant")}
    />
  )

  const side = layout.splitBoth ? (
    <ResizablePanelGroup orientation="vertical" {...layout.side}>
      {/* Sizes are strings so they are read as percentages; a bare
          number would be interpreted as pixels. */}
      <ResizablePanel id="preview" defaultSize="60" minSize="28">
        {preview(true)}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="assistant" defaultSize="40" minSize="25">
        {assistant}
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : panels.preview ? (
    preview(false)
  ) : (
    assistant
  )

  // Like the panes, the strip lands in every layout, so it is written once.
  const tabs = (
    <ResumeTabs
      resumeId={resumeId}
      fullWidth={layout.fullWidth}
      onToggleFullWidth={layout.toggleFullWidth}
    />
  )

  // Maximizing hands the pane the whole row right of the resume rail: the tab
  // strip, the middle column and the other pane stand down until it is
  // restored. What is hidden stays switched on, so restoring brings back the
  // arrangement that was there before.
  if (maximized) {
    return (
      <div ref={layout.ref} className="relative flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
          {maximized === "preview" ? preview(false) : assistant}
        </div>
      </div>
    )
  }

  // The middle column's own full width, asked for from the strip: the side
  // panes stand down but stay switched on, so restoring brings back the
  // arrangement that was there before.
  if (layout.fullWidth) {
    return (
      <div ref={layout.ref} className="relative flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-paper">
          {tabs}
          <Outlet />
        </div>
      </div>
    )
  }

  return (
    <div ref={layout.ref} className="relative flex h-full min-h-0">
      {layout.centerOpen && layout.rightOpen ? (
        <ResizablePanelGroup orientation="horizontal" {...layout.columns}>
          {/* Bare numbers are pixels: the middle column keeps its old floor and
              the side column opens at its old fixed width. */}
          <ResizablePanel
            id="editor"
            minSize={300}
            className="overflow-hidden bg-paper"
          >
            {tabs}
            <Outlet />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="side"
            defaultSize={panels.preview ? 520 : 400}
            minSize={panels.preview ? 360 : 320}
            maxSize="70"
            className="overflow-hidden bg-canvas"
          >
            {side}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : layout.centerOpen ? (
        <div className="flex min-w-[300px] flex-1 flex-col overflow-hidden bg-paper">
          {tabs}
          <Outlet />
        </div>
      ) : (
        // No room for both: the strip goes full width and the side panels get
        // the rest, so the tab that owns the column can still be seen.
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
          {tabs}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {side}
          </div>
        </div>
      )}
    </div>
  )
}
