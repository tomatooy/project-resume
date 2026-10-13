import { createFileRoute } from "@tanstack/react-router"
import { ProfileSectionSchema } from "@workspace/resume-core/contracts"
import { AutofillProfileScreen } from "@/features/autofill-profile/AutofillProfileScreen"

export const Route = createFileRoute("/_app/autofill-profile")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: ProfileSectionSchema.catch("identity").parse(
      search.section === "work-authorization"
        ? "workAuthorization"
        : search.section
    ),
  }),
  component: () => (
    <AutofillProfileScreen
      userId={Route.useRouteContext().session.userId}
      section={Route.useSearch().section}
    />
  ),
})
