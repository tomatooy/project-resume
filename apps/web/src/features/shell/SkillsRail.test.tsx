import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const listSkills = vi.fn()
const setSkillEnabled = vi.fn()

vi.mock("@/lib/api", () => ({
  listSkills: (...args: unknown[]) => listSkills(...args),
  setSkillEnabled: (...args: unknown[]) => setSkillEnabled(...args),
}))

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({}),
  // The real Link resolves the route tree; the href is all these tests read.
  Link: ({
    to,
    params,
    children,
    ...rest
  }: ComponentProps<"a"> & { to: string; params?: Record<string, string> }) => (
    <a
      href={to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? "")}
      {...rest}
    >
      {children}
    </a>
  ),
}))

import { SkillsRail } from "./SkillsRail"

/**
 * The rail's skills list is the library's only index, so what it has to get
 * right is where a skill lands: the group it is filed under, the tier it came
 * from, and whether it is on.
 */

type Row = Awaited<ReturnType<typeof listSkills>>[number]

function row(overrides: Partial<Row> & Pick<Row, "id" | "name">): Row {
  return {
    category: "editor",
    description: "Make sentences shorter.",
    whenToUse: "When it applies.",
    notFor: undefined,
    starter: undefined,
    source: "builtin",
    enabled: true,
    deleted: false,
    ...overrides,
  }
}

function renderRail(rows: Row[]) {
  listSkills.mockResolvedValue(rows)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SkillsRail />
    </QueryClientProvider>
  )
}

/** The rail's rows, in the order they are drawn. */
function rowLabels(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent?.trim() ?? "")
    .filter((text) => text.length > 0)
}

describe("SkillsRail", () => {
  it("files a skill under its group, its tier and its switch", async () => {
    renderRail([
      row({ id: "bullet_rewrite", name: "Impact bullets" }),
      row({
        id: "usr_1",
        name: "Terse sentences",
        source: "custom",
        enabled: false,
      }),
      row({
        id: "tell_me",
        name: "Tell me about yourself",
        category: "interview",
      }),
    ])

    for (const heading of ["Editor", "Default", "Custom", "Interview"]) {
      expect(
        await screen.findByRole("heading", { name: heading })
      ).toBeInTheDocument()
    }
    // Built-ins first inside Editor, then the user's own, then the other group.
    expect(rowLabels()).toEqual([
      "Impact bullets",
      "Terse sentences",
      "Tell me about yourself",
    ])
    expect(
      screen.queryByText("No interview skills yet.")
    ).not.toBeInTheDocument()

    // A switched-off skill is off where it is listed, not only in the editor.
    expect(
      screen.getByRole("switch", { name: "Enable Terse sentences" })
    ).toHaveAttribute("data-unchecked")
  })

  it("says so when a group is empty rather than dropping it", async () => {
    renderRail([row({ id: "bullet_rewrite", name: "Impact bullets" })])

    expect(
      await screen.findByText("Nothing of your own yet.")
    ).toBeInTheDocument()
    expect(screen.getByText("No interview skills yet.")).toBeInTheDocument()
  })

  it("turns a skill off from its row", async () => {
    const user = userEvent.setup()
    renderRail([row({ id: "bullet_rewrite", name: "Impact bullets" })])

    await user.click(
      await screen.findByRole("switch", { name: "Disable Impact bullets" })
    )

    expect(setSkillEnabled).toHaveBeenCalledWith({
      skillId: "bullet_rewrite",
      disabled: true,
    })
  })
})
