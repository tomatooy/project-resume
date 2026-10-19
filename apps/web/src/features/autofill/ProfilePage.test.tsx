import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen, waitFor } from "@testing-library/react"
import { emptyProfile } from "@workspace/autofill"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as api from "@/lib/api"

const server = vi.hoisted(() => ({
  getAutofillProfile: vi.fn<typeof api.getAutofillProfile>(),
  getAutofillNotes: vi.fn<typeof api.getAutofillNotes>(),
}))
vi.mock("@/lib/api", () => server)

import { ProfilePage } from "./ProfilePage"

type ProfileState = Awaited<ReturnType<typeof api.getAutofillProfile>>

/** jsdom has no scrolling, so the page's one scroll call is recorded instead. */
const scrolled: string[] = []
beforeEach(() => {
  scrolled.length = 0
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value(this: Element) {
      scrolled.push(this.id)
    },
  })
  server.getAutofillNotes.mockResolvedValue({
    content: "",
    revision: 0,
    updatedAt: null,
  })
})
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView")
  vi.resetAllMocks()
})

async function renderPage(initial: string) {
  const root = createRootRoute()
  const autofill = createRoute({
    getParentRoute: () => root,
    path: "/autofill",
    component: ProfilePage,
  })
  const router = createRouter({
    routeTree: root.addChildren([autofill]),
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
}

describe("ProfilePage", () => {
  it("opens at the section in the hash once the sections are drawn", async () => {
    let resolve: (state: ProfileState) => void = () => undefined
    server.getAutofillProfile.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    await renderPage("/autofill#eeo")
    expect(screen.queryAllByRole("region")).toEqual([])
    expect(scrolled).toEqual([])

    await act(async () => {
      resolve({
        profile: emptyProfile,
        revision: 0,
        updatedAt: null,
        exists: false,
      })
    })

    await waitFor(() => expect(scrolled).toEqual(["eeo"]))
    expect(screen.getAllByRole("region").map((region) => region.id)).toEqual([
      "personal",
      "contact",
      "links",
      "work-authorization",
      "preferences",
      "eeo",
      "other",
      "notes",
    ])
  })
})
