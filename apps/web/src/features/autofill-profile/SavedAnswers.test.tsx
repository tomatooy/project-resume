import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, expect, it, vi } from "vitest"
import type {
  ScopedAnswer,
  SaveScopedAnswer,
  DeleteScopedAnswer,
} from "@workspace/resume-core/contracts"
import { ApiError } from "@/lib/types"
import { SavedAnswers } from "./SavedAnswers"

const api = vi.hoisted(() => ({
  listAutofillAnswers: vi.fn<() => Promise<ScopedAnswer[]>>(),
  saveAutofillAnswer:
    vi.fn<(input: SaveScopedAnswer) => Promise<ScopedAnswer>>(),
  removeAutofillAnswer: vi.fn<(input: DeleteScopedAnswer) => Promise<void>>(),
}))
vi.mock("@/lib/api", () => api)

const answer: ScopedAnswer = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  revision: 1,
  meaning: { concept: "salary" },
  conditions: {
    countryCode: "US",
    currency: "USD",
    salaryPeriod: "year",
    employerId: "Acme",
  },
  value: "100000",
  provenance: { kind: "user" },
  confirmedAt: "2026-10-13T10:00:00Z",
  updatedAt: "2026-10-13T10:00:00Z",
}
let current: ScopedAnswer
beforeEach(() => {
  vi.resetAllMocks()
  current = structuredClone(answer)
  api.listAutofillAnswers.mockImplementation(async () => [current])
  api.saveAutofillAnswer.mockImplementation(async (input) => {
    if (input.expectedRevision !== current.revision)
      throw new ApiError(
        "CONFLICT",
        "Saved answer changed. Reload it before saving",
        409
      )
    current = {
      ...current,
      ...input,
      revision: current.revision + 1,
      id: current.id,
    }
    return current
  })
})
function show() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SavedAnswers userId="user" />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "Manage saved answers" }))
  return client
}

it("saves only after explicit confirmation with the original conditions and revision", async () => {
  const client = show()
  fireEvent.click(await screen.findByRole("button", { name: "Edit answer" }))
  fireEvent.change(screen.getByLabelText("Answer"), {
    target: { value: "120000" },
  })
  expect(api.saveAutofillAnswer).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm and save answer" })
  )
  await waitFor(() => expect(api.saveAutofillAnswer).toHaveBeenCalledOnce())
  expect(api.saveAutofillAnswer.mock.calls[0]?.[0]).toEqual({
    id: answer.id,
    expectedRevision: 1,
    meaning: answer.meaning,
    conditions: answer.conditions,
    value: "120000",
    provenance: { kind: "user" },
    confirmed: true,
  })
  await screen.findByText("120000")
  client.clear()
})

it("preserves a draft on conflict and requires review before adopting the new revision", async () => {
  const client = show()
  fireEvent.click(await screen.findByRole("button", { name: "Edit answer" }))
  fireEvent.change(screen.getByLabelText("Answer"), {
    target: { value: "120000" },
  })
  current = { ...current, value: "110000", revision: 2 }
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm and save answer" })
  )
  await screen.findByText("110000")
  expect(screen.getByLabelText("Answer")).toHaveValue("120000")
  expect(
    screen.getByRole("button", { name: "Confirm and save answer" })
  ).toBeDisabled()
  expect(api.saveAutofillAnswer).toHaveBeenCalledOnce()
  fireEvent.click(
    screen.getByRole("button", {
      name: "I reviewed the latest answer, keep my draft",
    })
  )
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm and save answer" })
  )
  await waitFor(() => expect(api.saveAutofillAnswer).toHaveBeenCalledTimes(2))
  expect(api.saveAutofillAnswer.mock.calls[1]?.[0].expectedRevision).toBe(2)
  expect(api.saveAutofillAnswer.mock.calls[1]?.[0].conditions).toEqual(
    answer.conditions
  )
  client.clear()
})

it("does not silently adopt changed reuse conditions during conflict recovery", async () => {
  const client = show()
  fireEvent.click(await screen.findByRole("button", { name: "Edit answer" }))
  fireEvent.change(screen.getByLabelText("Answer"), {
    target: { value: "120000" },
  })
  current = { ...current, revision: 2, conditions: { countryCode: "US" } }
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm and save answer" })
  )
  await screen.findByText(
    "The question or reuse conditions also changed. Discard these edits to review the updated answer."
  )
  expect(
    screen.queryByRole("button", {
      name: "I reviewed the latest answer, keep my draft",
    })
  ).toBeNull()
  expect(screen.getByLabelText("Answer")).toHaveValue("120000")
  expect(api.saveAutofillAnswer).toHaveBeenCalledOnce()
  client.clear()
})
