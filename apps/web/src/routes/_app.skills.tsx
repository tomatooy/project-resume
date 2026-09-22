import { createFileRoute, Outlet } from "@tanstack/react-router"

import { SkillTabs } from "@/features/skills/SkillTabs"
import { SkillsWorkspaceProvider } from "@/features/skills/workspace"

/**
 * The playbook library, and the tabs it opens.
 *
 * A layout rather than a screen: the strip has to outlive the tab it is
 * showing, and the workspace state (which tabs are open) belongs above both
 * the list and the editor. It sits under `_app`, so the rail and the auth
 * guard are already around it.
 */
export const Route = createFileRoute("/_app/skills")({
  component: SkillsShell,
})

function SkillsShell() {
  return (
    <SkillsWorkspaceProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
        <SkillTabs />
        <Outlet />
      </div>
    </SkillsWorkspaceProvider>
  )
}
