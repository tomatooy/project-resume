import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect, type ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const listSkills = vi.fn()
const navigate = vi.fn()

vi.mock("@/lib/api", () => ({
  listSkills: (...args: unknown[]) => listSkills(...args),
}))

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ skillId: "usr_b" }),
  useNavigate: () => navigate,
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

import { SkillTabs } from "./SkillTabs"
import { SkillsWorkspaceProvider, useSkillsWorkspace } from "./workspace"

/**
 * Tabs are how a skill is looked at while the library stays put, and the one
 * thing that can go wrong is closing the tab you are standing on: it has to
 * leave the strip somewhere real.
 */

type Row = Awaited<ReturnType<typeof listSkills>>[number]

function row(id: string, name: string): Row {
  return {
    id,
    category: "editor",
    name,
    description: "Make sentences shorter.",
    whenToUse: "When it applies.",
    notFor: undefined,
    starter: undefined,
    source: "custom",
    enabled: true,
    deleted: false,
  }
}

/** Opens tabs the way the route does: the id arrives, the strip keeps it. */
function Open({ ids }: { ids: string[] }) {
  const { ensure } = useSkillsWorkspace()
  useEffect(() => {
    for (const id of ids) ensure(id)
  }, [ids, ensure])
  return null
}

function renderTabs(ids: string[]) {
  listSkills.mockResolvedValue([
    row("usr_a", "Alpha"),
    row("usr_b", "Beta"),
    row("usr_c", "Gamma"),
  ])
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SkillsWorkspaceProvider>
        <Open ids={ids} />
        <SkillTabs />
      </SkillsWorkspaceProvider>
    </QueryClientProvider>
  )
}

describe("SkillTabs", () => {
  it("names every open tab and marks the one the URL is on", async () => {
    renderTabs(["usr_a", "usr_b"])

    expect(screen.getByText("All skills")).toBeInTheDocument()
    expect(await screen.findByText("Alpha")).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "Beta" })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("closing the tab it is standing on shows the next one", async () => {
    const user = userEvent.setup()
    renderTabs(["usr_a", "usr_b", "usr_c"])

    await user.click(await screen.findByRole("button", { name: "Close Beta" }))

    expect(navigate).toHaveBeenCalledWith({
      to: "/skills/$skillId",
      params: { skillId: "usr_c" },
    })
  })

  it("closing the last tab left goes back to the library", async () => {
    const user = userEvent.setup()
    renderTabs(["usr_b"])

    await user.click(await screen.findByRole("button", { name: "Close Beta" }))

    expect(navigate).toHaveBeenCalledWith({ to: "/skills" })
  })
})
