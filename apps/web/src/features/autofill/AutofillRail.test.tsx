import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AutofillRail } from "./AutofillRail"

/** A real router, so the hrefs are the ones the app's links would carry. */
async function renderRail() {
  const root = createRootRoute({ component: AutofillRail })
  const autofill = createRoute({
    getParentRoute: () => root,
    path: "/autofill",
    component: () => null,
  })
  const router = createRouter({
    routeTree: root.addChildren([autofill]),
    history: createMemoryHistory({ initialEntries: ["/autofill"] }),
  })
  await act(async () => {
    await router.load()
  })
  render(<RouterProvider router={router} />)
}

describe("AutofillRail", () => {
  it("links every section to its anchor", async () => {
    await renderRail()
    const links = await screen.findAllByRole("link")
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")])
    ).toEqual([
      ["Personal", "/autofill#personal"],
      ["Contact", "/autofill#contact"],
      ["Links", "/autofill#links"],
      ["Work experience", "/autofill#experience"],
      ["Education", "/autofill#education"],
      ["Skills", "/autofill#skills"],
      ["Work authorization", "/autofill#work-authorization"],
      ["Preferences", "/autofill#preferences"],
      ["EEO", "/autofill#eeo"],
      ["Other", "/autofill#other"],
      ["Notes", "/autofill#notes"],
    ])
  })
})
