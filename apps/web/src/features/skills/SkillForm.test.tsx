import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { parseSkillMarkdown, type SkillDraft } from "@workspace/resume-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const createUserSkill = vi.fn()
const updateUserSkill = vi.fn()

vi.mock("@/lib/api", () => ({
  createUserSkill: (input: object) => createUserSkill(input),
  updateUserSkill: (input: object) => updateUserSkill(input),
  listSkills: () => Promise.resolve([]),
}))

import { BLANK_SKILL, SkillForm } from "./SkillForm"

beforeEach(() => {
  createUserSkill.mockReset().mockResolvedValue({ id: "usr_new" })
  updateUserSkill.mockReset().mockResolvedValue({ id: "usr_existing" })
})

function renderForm(initial: SkillDraft, skillId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onSaved = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <SkillForm
        initial={initial}
        skillId={skillId}
        onSaved={onSaved}
        onCancel={() => undefined}
      />
    </QueryClientProvider>
  )
  return { onSaved }
}

const markdown =
  "---\nname: Terse\ndescription: |\n  Make sentences shorter.\n---\n\nPrefer one clause."

describe("SkillForm", () => {
  it("saves an imported standard skill with no when-to-use field", async () => {
    const user = userEvent.setup()
    const { onSaved } = renderForm(parseSkillMarkdown(markdown))

    expect(screen.getByLabelText("Description")).toHaveValue(
      "Make sentences shorter."
    )
    expect(screen.getByLabelText("Body")).toHaveValue("Prefer one clause.")
    expect(screen.getByLabelText(/When to use it/)).toHaveValue("")
    await user.click(screen.getByRole("button", { name: "Add skill" }))

    await waitFor(() =>
      expect(createUserSkill).toHaveBeenCalledWith({
        category: "editor",
        name: "Terse",
        description: "Make sentences shorter.",
        body: "Prefer one clause.",
        whenToUse: undefined,
        notFor: undefined,
        starter: undefined,
      })
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("usr_new"))
  })

  it("keeps an oversized import intact and validates when Add skill is clicked", async () => {
    const user = userEvent.setup()
    const body = "x".repeat(60_000)
    renderForm(parseSkillMarkdown(markdown.replace("Prefer one clause.", body)))

    expect(screen.getByLabelText("Body")).toHaveValue(body)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add skill" }))
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Body must be 50,000 characters or fewer."
    )
    expect(createUserSkill).not.toHaveBeenCalled()

    const correctedBody = "x".repeat(50_000)
    fireEvent.change(screen.getByLabelText("Body"), {
      target: { value: correctedBody },
    })
    expect(screen.getByText("50,000 / 50,000")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add skill" }))
    await waitFor(() =>
      expect(createUserSkill).toHaveBeenCalledWith(
        expect.objectContaining({ body: correctedBody })
      )
    )
  })

  it("shows required field errors on Add skill without saving an empty draft", async () => {
    const user = userEvent.setup()
    renderForm(BLANK_SKILL)
    await user.click(screen.getByRole("button", { name: "Add skill" }))
    expect(screen.getByText("Name is required.")).toBeInTheDocument()
    expect(screen.getByText("Description is required.")).toBeInTheDocument()
    expect(screen.getByText("Body is required.")).toBeInTheDocument()
    expect(createUserSkill).not.toHaveBeenCalled()
  })

  it("allows removing when to use from an existing skill", async () => {
    const user = userEvent.setup()
    renderForm(
      { ...parseSkillMarkdown(markdown), whenToUse: "When prose is wordy." },
      "usr_existing"
    )
    await user.clear(screen.getByLabelText(/When to use it/))
    await user.click(screen.getByRole("button", { name: "Save skill" }))
    await waitFor(() =>
      expect(updateUserSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "usr_existing",
          description: "Make sentences shorter.",
          whenToUse: undefined,
        })
      )
    )
  })
})
