import { createFileRoute } from "@tanstack/react-router"

import { ProfilePage } from "@/features/autofill/ProfilePage"
import { ResourceFailure } from "@/features/workspace/ResourceFailure"

export const Route = createFileRoute("/_app/autofill")({
  component: AutofillLayout,
  errorComponent: ResourceFailure,
})

/**
 * A document surface like the skill pages: the profile reads on the card
 * colour, and the strip, the rail and the status bar stay on the canvas.
 */
function AutofillLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <ProfilePage />
    </div>
  )
}
