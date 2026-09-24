import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkspaceProvider } from "./context"
import { WorkspaceTabs } from "./WorkspaceTabs"

vi.mock("@/lib/api", () => ({
  listResumes: async () => [
    { id: "a", title: "Alpha" },
    { id: "b", title: "Beta" },
  ],
  listSkills: async () => [],
}))

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    clear: () => data.clear(),
  })
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
})

afterEach(() => vi.unstubAllGlobals())

async function setup(initial = "/r/a/edit") {
  function Page() {
    const router = useRouter()
    return (
      <>
        <p>Page content</p>
        <button
          type="button"
          onClick={() => {
            void router.navigate({
              to: "/r/$resumeId/edit",
              params: { resumeId: "b" },
            })
          }}
        >
          Open Beta
        </button>
        <button
          type="button"
          onClick={() => {
            void router.navigate({ to: "/skills" })
          }}
        >
          Open library
        </button>
      </>
    )
  }
  const root = createRootRoute({
    component: () => (
      <WorkspaceProvider userId="test">
        <WorkspaceTabs>
          <Outlet />
        </WorkspaceTabs>
      </WorkspaceProvider>
    ),
  })
  const resume = createRoute({
    getParentRoute: () => root,
    path: "/r/$resumeId/$view",
    component: Page,
  })
  const skills = createRoute({
    getParentRoute: () => root,
    path: "/skills",
    component: Page,
  })
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: "/dashboard",
    component: () => <p>Dashboard empty workspace</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([resume, skills, dashboard]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  await act(async () => {
    await router.load()
  })
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByText("Page content")
  return { router, user: userEvent.setup(), ...rendered }
}

describe("workspace tabs with a memory router", () => {
  it("opens resource pages, closes the active tab, and reopens a closed history entry", async () => {
    const { user, router } = await setup()
    await screen.findByRole("tab", { name: /Alpha/ })
    await user.click(screen.getByRole("button", { name: "Open Beta" }))
    await screen.findByRole("tab", { name: /Beta/ })
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    await user.click(
      screen.getByRole("button", { name: "Close Editor · Beta" })
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/r/a/edit")
    )
    expect(screen.queryByRole("tab", { name: /Beta/ })).not.toBeInTheDocument()
    await act(async () => {
      await router.navigate({
        to: "/r/$resumeId/edit",
        params: { resumeId: "b" },
      })
    })
    await screen.findByRole("tab", { name: /Beta/ })
    await act(async () => {
      router.history.back()
    })
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Alpha/ })).toHaveAttribute(
        "aria-selected",
        "true"
      )
    )
  })
  it("mixes skills with resumes and closes all tabs to an empty dashboard", async () => {
    const { user, router } = await setup()
    await user.click(screen.getByRole("button", { name: "Open library" }))
    await screen.findByRole("tab", { name: "All skills" })
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: "Tab actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Close all tabs" })
    )
    await screen.findByText("Dashboard empty workspace")
    expect(router.state.location.pathname).toBe("/dashboard")
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
  })
  it("supports keyboard ordering without changing the active page", async () => {
    const { user, router } = await setup()
    await user.click(screen.getByRole("button", { name: "Open Beta" }))
    const beta = await screen.findByRole("tab", { name: /Beta/ })
    await act(async () => {
      fireEvent.keyDown(beta, {
        key: "ArrowLeft",
        altKey: true,
        shiftKey: true,
      })
    })
    expect(screen.getAllByRole("tab")[0]).toHaveTextContent("Beta")
    expect(router.state.location.pathname).toBe("/r/b/edit")
    const stored = JSON.parse(
      window.localStorage.getItem("resume-studio.workspace.v1:test") ?? "null"
    )
    expect(stored.tabs[0].resumeId).toBe("b")
  })

  it("does not open a tab for a preloaded route", async () => {
    const { router } = await setup()
    await screen.findByRole("tab", { name: /Alpha/ })
    await act(async () => {
      await router.preloadRoute({
        to: "/r/$resumeId/$view",
        params: { resumeId: "b", view: "edit" },
      })
    })
    expect(screen.getAllByRole("tab")).toHaveLength(1)
    expect(router.state.location.pathname).toBe("/r/a/edit")
  })
})
