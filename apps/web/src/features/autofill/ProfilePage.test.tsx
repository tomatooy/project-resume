import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { emptyProfile, profileFromResume } from "@workspace/autofill"
import { defaultTemplateOptions } from "@workspace/resume-schema"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as api from "@/lib/api"
import type { ResumeRecord } from "@/lib/types"

const server = vi.hoisted(() => ({
  getAutofillProfile: vi.fn<typeof api.getAutofillProfile>(),
  getAutofillNotes: vi.fn<typeof api.getAutofillNotes>(),
  saveAutofillProfile: vi.fn<typeof api.saveAutofillProfile>(),
  listResumePage: vi.fn<typeof api.listResumePage>(),
  getResume: vi.fn<typeof api.getResume>(),
}))
vi.mock("@/lib/api", () => server)

import { ProfilePage } from "./ProfilePage"

type ProfileState = Awaited<ReturnType<typeof api.getAutofillProfile>>

const ANCHORS = [
  "personal",
  "contact",
  "links",
  "experience",
  "education",
  "skills",
  "work-authorization",
  "preferences",
  "eeo",
  "other",
  "notes",
]
const FIRST_SAVE = { revision: 1, updatedAt: "2026-10-19T10:00:00.000Z" }
const unsaved: ProfileState = {
  profile: emptyProfile,
  revision: 0,
  updatedAt: null,
  exists: false,
}
const saved: ProfileState = {
  profile: emptyProfile,
  revision: 1,
  updatedAt: "2026-10-19T09:00:00.000Z",
  exists: true,
}
const resume: ResumeRecord = {
  id: "r1",
  title: "Backend resume",
  subtitle: "",
  templateId: "lisbon",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  revision: 3,
  currentVersionId: null,
  schemaVersion: 1,
  templateOptions: defaultTemplateOptions,
  data: {
    schemaVersion: 1,
    basics: {
      id: "basics",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "(415) 555-0100",
      location: "San Francisco, CA",
      links: [],
    },
    sections: [],
  },
}

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

/** The profile's status line, not the one the notes editor has below it. */
function profileStatus() {
  const notes = screen.getByRole("region", { name: "Notes" })
  return screen.getAllByRole("status").find((status) => !notes.contains(status))
}

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
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { user: userEvent.setup(), unmount: view.unmount }
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
      resolve(saved)
    })

    await waitFor(() => expect(scrolled).toEqual(["eeo"]))
    expect(screen.getAllByRole("region").map((region) => region.id)).toEqual(
      ANCHORS
    )
  })

  it("offers an import or a blank start before the first save", async () => {
    server.getAutofillProfile.mockResolvedValue(unsaved)
    await renderPage("/autofill")

    expect(
      await screen.findByRole("button", { name: "Import from resume" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Start blank" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "Legal first name" })
    ).not.toBeInTheDocument()
  })

  it("shows the notes editor before the first save", async () => {
    server.getAutofillProfile.mockResolvedValue(unsaved)
    server.getAutofillNotes.mockResolvedValue({
      content: "- Prefers remote work",
      revision: 2,
      updatedAt: "2026-10-19T09:00:00.000Z",
    })
    await renderPage("/autofill")

    const notes = await screen.findByRole("region", { name: "Notes" })
    expect(within(notes).getByRole("textbox", { name: "Notes" })).toHaveValue(
      "- Prefers remote work"
    )
    expect(within(notes).getByText("21 / 10,000")).toBeInTheDocument()
  })

  it("starts blank and then shows every section", async () => {
    server.getAutofillProfile.mockResolvedValue(unsaved)
    server.saveAutofillProfile.mockResolvedValue(FIRST_SAVE)
    const { user } = await renderPage("/autofill#eeo")
    await user.click(await screen.findByRole("button", { name: "Start blank" }))

    expect(
      await screen.findByRole("textbox", { name: "Legal first name" })
    ).toHaveValue("")
    expect(server.saveAutofillProfile).toHaveBeenCalledWith({
      profile: emptyProfile,
      expectedRevision: 0,
    })
    expect(screen.getAllByRole("region").map((region) => region.id)).toEqual(
      ANCHORS
    )
    await waitFor(() => expect(scrolled).toEqual(["eeo"]))
  })

  it("imports the basics of the resume the user picks", async () => {
    server.getAutofillProfile.mockResolvedValue(unsaved)
    server.listResumePage.mockResolvedValue({
      items: [
        {
          id: resume.id,
          title: resume.title,
          subtitle: "",
          templateId: "lisbon",
          createdAt: resume.createdAt,
          updatedAt: resume.updatedAt,
          job: null,
        },
      ],
      nextCursor: null,
      total: 1,
    })
    server.getResume.mockResolvedValue(resume)
    server.saveAutofillProfile.mockResolvedValue(FIRST_SAVE)
    const { user } = await renderPage("/autofill")

    await user.click(
      await screen.findByRole("button", { name: "Import from resume" })
    )
    await user.click(
      await screen.findByRole("button", { name: "Backend resume" })
    )

    expect(
      await screen.findByRole("textbox", { name: "Legal first name" })
    ).toHaveValue("Ada")
    expect(server.getResume).toHaveBeenCalledWith({ id: "r1" })
    expect(server.saveAutofillProfile).toHaveBeenCalledWith({
      profile: profileFromResume(emptyProfile, resume.data),
      expectedRevision: 0,
    })
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(
      "ada@example.com"
    )
  })

  it("keeps Decline alone among the race answers", async () => {
    server.getAutofillProfile.mockResolvedValue(saved)
    const { user } = await renderPage("/autofill")
    const asian = await screen.findByRole("checkbox", { name: "Asian" })
    const decline = screen.getByRole("checkbox", {
      name: "Decline to self-identify",
    })
    expect(decline).toBeChecked()

    await user.click(asian)
    expect(asian).toBeChecked()
    expect(decline).not.toBeChecked()

    await user.click(decline)
    expect(decline).toBeChecked()
    expect(asian).not.toBeChecked()
  })

  it("clears one race category and keeps the others", async () => {
    server.getAutofillProfile.mockResolvedValue(saved)
    const { user } = await renderPage("/autofill")
    const asian = await screen.findByRole("checkbox", { name: "Asian" })
    const white = screen.getByRole("checkbox", { name: "White" })

    await user.click(asian)
    await user.click(white)
    await user.click(asian)

    expect(asian).not.toBeChecked()
    expect(white).toBeChecked()
  })

  it("points at a field the profile cannot save once the user leaves it", async () => {
    server.getAutofillProfile.mockResolvedValue(saved)
    const { user } = await renderPage("/autofill")
    const email = await screen.findByRole("textbox", { name: "Email" })

    await user.type(email, "ada@")
    expect(email).not.toHaveAttribute("aria-invalid", "true")
    await user.tab()

    expect(email).toHaveAttribute("aria-invalid", "true")
    expect(email).toHaveAccessibleDescription(
      "Enter an email address, like ada@example.com."
    )
    expect(profileStatus()).toHaveTextContent(
      "Fix the highlighted fields to save your changes."
    )

    await user.type(email, "example.com")
    expect(email).not.toHaveAttribute("aria-invalid", "true")
    expect(profileStatus()).toBeEmptyDOMElement()
  })

  it("stores the phone with its country code", async () => {
    server.getAutofillProfile.mockResolvedValue(saved)
    server.saveAutofillProfile.mockResolvedValue({
      revision: 2,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    const { user, unmount } = await renderPage("/autofill")
    const phone = await screen.findByRole("textbox", { name: "Phone" })

    await user.type(phone, "(415) 555-0100")
    expect(phone).toHaveValue("4155550100")
    unmount()

    await waitFor(() =>
      expect(server.saveAutofillProfile).toHaveBeenCalledWith({
        profile: {
          ...emptyProfile,
          contact: { ...emptyProfile.contact, phone: "+14155550100" },
        },
        expectedRevision: 1,
      })
    )
  })
})
