import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AutofillProfileService } from "@workspace/resume-core"
import { InMemoryAutofillProfileRepository } from "@workspace/resume-core/testing"
import { AutofillProfileScreen } from "./AutofillProfileScreen"
import { ProfileEditor } from "./editor"

const mock = vi.hoisted(() => {
  const workspace: { profile: ProfileEditor | null } = { profile: null }
  return { workspace }
})
vi.mock("@/features/workspace/context", () => ({
  useWorkspace: () => mock.workspace,
}))
vi.mock("@/lib/api", () => ({
  getAutofillProfile: vi.fn(),
  updateAutofillProfile: vi.fn(),
  getResume: vi.fn(),
}))
vi.mock("@/lib/queries", () => ({
  autofillProfileQuery: (id: string) => ({
    queryKey: ["profile", id],
    queryFn: async () => mock.workspace.profile?.store.state.saved,
  }),
  useResumes: () => ({ data: [] }),
}))
let service: AutofillProfileService
beforeEach(async () => {
  service = new AutofillProfileService(new InMemoryAutofillProfileRepository())
  mock.workspace.profile = new ProfileEditor(
    await service.get(),
    (v) => service.update(v),
    () => service.get()
  )
})
afterEach(() => {
  mock.workspace.profile = null
})
it("edits and saves independently of resumes while keeping unsaved values private", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AutofillProfileScreen userId="account" section="identity" />
    </QueryClientProvider>
  )
  expect(screen.getByLabelText("Display name")).toHaveValue("")
  expect(screen.getByLabelText("Contact email")).toHaveValue("")
  expect(screen.getByLabelText("Phone number")).toHaveValue("")
  fireEvent.change(screen.getByLabelText("Legal given name"), {
    target: { value: "Synthetic person" },
  })
  expect((await service.get()).revision).toBe(0)
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }))
  await waitFor(() =>
    expect(mock.workspace.profile?.store.state.saved.revision).toBe(1)
  )
  expect((await service.get()).data.identity.legalGivenName).toBe(
    "Synthetic person"
  )
})
it("hides EEO answers until explicitly revealed", async () => {
  const profile = await service.update({
    expectedRevision: 0,
    section: "eeo",
    data: {
      responses: [
        {
          countryCode: "US",
          questionKey: "gender",
          definitionVersion: "vs-us-1",
          answer: {
            state: "answered",
            code: "self_described",
            text: "Private identity",
          },
        },
      ],
    },
  })
  mock.workspace.profile = new ProfileEditor(
    profile,
    (v) => service.update(v),
    () => service.get()
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AutofillProfileScreen userId="account" section="eeo" />
    </QueryClientProvider>
  )
  expect(screen.queryByDisplayValue("Private identity")).toBeNull()
  fireEvent.click(
    screen.getByRole("button", { name: /edit us self-identification answers/i })
  )
  expect(screen.getByDisplayValue("Private identity")).toBeInTheDocument()
})
