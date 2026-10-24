import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  listResumePage: async () => ({ items: [], nextCursor: null, total: 0 }),
  getResumeSummary: async () => null,
  listSkills: async () => [],
}))

import { ResumeRail } from "./ResumeRail"

async function renderRail(initial: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <ResumeRail />
        <Outlet />
      </>
    ),
  })
  const routes = ["/autofill", "/skills", "/dashboard"].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null })
  )
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  await act(async () => {
    await router.load()
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router, user: userEvent.setup() }
}

describe("ResumeRail", () => {
  it("brings up the profile's sections when the route becomes /autofill", async () => {
    const { router } = await renderRail("/skills")
    expect(
      await screen.findByRole("button", { name: "My resumes" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Personal" })
    ).not.toBeInTheDocument()

    await act(async () => {
      await router.navigate({ to: "/autofill" })
    })

    expect(
      await screen.findByRole("link", { name: "Personal" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "My resumes" })).toBeVisible()
  })

  it("goes back to the resumes from the profile's foot", async () => {
    const { user } = await renderRail("/autofill")
    await user.click(await screen.findByRole("button", { name: "My resumes" }))

    expect(
      screen.queryByRole("link", { name: "Personal" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Skills" })).toBeVisible()
  })
})
