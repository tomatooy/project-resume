import { ResourceFailure } from "@/features/workspace/ResourceFailure"
import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/skills")({
  component: SkillsLayout,
  errorComponent: ResourceFailure,
})

/**
 * Every skill page is a document surface, on the card colour rather than the
 * app canvas: the library and the skill a row opens read the same white as the
 * editor column. The strip, the rail and the status bar stay on the canvas.
 */
function SkillsLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <Outlet />
    </div>
  )
}
