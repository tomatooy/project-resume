import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, expect, it, vi } from "vitest"
import type {
  RemoveSavedAnswer,
  SaveSavedAnswer,
  SavedAnswer,
} from "@workspace/resume-core"
import { ApiError } from "@/lib/types"
import { SavedQuestionAnswers } from "./SavedQuestionAnswers"

const api = vi.hoisted(() => ({
  listSavedAnswers: vi.fn<() => Promise<SavedAnswer[]>>(),
  saveSavedAnswer: vi.fn<(input: SaveSavedAnswer) => Promise<SavedAnswer>>(),
  removeSavedAnswer: vi.fn<(input: RemoveSavedAnswer) => Promise<void>>(),
}))
vi.mock("@/lib/api", () => api)

const notice: SavedAnswer = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  revision: 1,
  question: {
    key: "6a8003b548b10e39",
    text: "How much notice do you need to give your current employer?",
    kind: "short_text",
    scope: [{ dimension: "employer", value: "Acme" }],
    options: [],
  },
  value: { type: "text", text: "Four weeks" },
  confirmedAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
}

const workAuthorization: SavedAnswer = {
  id: "660e8400-e29b-41d4-a716-446655440001",
  revision: 1,
  question: {
    key: "9f1c2d3e4a5b6c7d",
    text: "Are you authorized to work in the United States?",
    kind: "yes_no",
    scope: [
      { dimension: "country", value: "US" },
      { dimension: "time", value: "2026-10-14" },
    ],
    options: [],
  },
  value: { type: "boolean", state: "yes" },
  confirmedAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
}

let current: SavedAnswer[]

beforeEach(() => {
  vi.resetAllMocks()
  current = [structuredClone(notice), structuredClone(workAuthorization)]
  api.listSavedAnswers.mockImplementation(async () => current)
  api.saveSavedAnswer.mockImplementation(async (input) => {
    const saved: SavedAnswer = {
      id: input.id ?? crypto.randomUUID(),
      revision: input.expectedRevision + 1,
      question: { ...input.question, key: "0123456789abcdef" },
      value: input.value,
      confirmedAt: "2026-10-14T00:00:00Z",
      updatedAt: "2026-10-14T00:00:00Z",
    }
    current = [...current.filter((row) => row.id !== saved.id), saved]
    return saved
  })
  api.removeSavedAnswer.mockImplementation(async (input) => {
    current = current.filter((row) => row.id !== input.id)
  })
})

function show() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SavedQuestionAnswers userId="user" />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "Manage kept answers" }))
  return client
}

/**
 * The card holding this text. Scoped rather than indexed, so the test does not
 * depend on the order the server happened to return the rows in.
 */
function cardFor(text: RegExp): HTMLElement {
  const card = screen.getByText(text).closest("article")
  if (!card) throw new Error("expected a kept answer card")
  return card
}

it("keeps, reloads, edits and removes an answer with no vocabulary in the path", async () => {
  const client = show()
  // Reloaded: the question's own wording, not a label built from a vocabulary.
  expect(
    await screen.findByText(/How much notice do you need/)
  ).toBeInTheDocument()

  // Created.
  fireEvent.click(screen.getByRole("button", { name: "Add a kept answer" }))
  fireEvent.change(screen.getByLabelText("The question as the page asks it"), {
    target: { value: "Which office do you prefer working from?" },
  })
  fireEvent.change(screen.getByLabelText("The answer"), {
    target: { value: "Lisbon" },
  })
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "Acme" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Keep this answer" }))
  await waitFor(() => expect(api.saveSavedAnswer).toHaveBeenCalledOnce())
  // The whole input, asserted exactly: no concept and no key are sent, and the
  // identity is derived from the question on the server.
  expect(api.saveSavedAnswer.mock.calls[0]?.[0]).toEqual({
    expectedRevision: 0,
    question: {
      text: "Which office do you prefer working from?",
      kind: "short_text",
      scope: [{ dimension: "employer", value: "Acme" }],
      options: [],
    },
    value: { type: "text", text: "Lisbon" },
    confirmed: true,
  })

  // Edited: the value changes, the question identity does not.
  fireEvent.click(
    within(cardFor(/How much notice do you need/)).getByRole("button", {
      name: "Edit answer",
    })
  )
  fireEvent.change(screen.getByLabelText("The answer"), {
    target: { value: "Six weeks" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }))
  await waitFor(() => expect(api.saveSavedAnswer).toHaveBeenCalledTimes(2))
  const edit = api.saveSavedAnswer.mock.calls[1]?.[0]
  expect(edit?.id).toBe(notice.id)
  expect(edit?.expectedRevision).toBe(1)
  expect(edit?.value).toEqual({ type: "text", text: "Six weeks" })
  await screen.findByText("Six weeks")

  // Removed, with the revision the user is looking at.
  fireEvent.click(
    within(cardFor(/Six weeks/)).getByRole("button", { name: "Remove" })
  )
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove kept answer" })
  )
  await waitFor(() => expect(api.removeSavedAnswer).toHaveBeenCalledOnce())
  expect(api.removeSavedAnswer.mock.calls[0]?.[0]).toEqual({
    id: notice.id,
    expectedRevision: 2,
  })
  client.clear()
})

it("sends a typed value for a yes or no question", async () => {
  const client = show()
  fireEvent.click(screen.getByRole("button", { name: "Add a kept answer" }))
  fireEvent.change(screen.getByLabelText("The question as the page asks it"), {
    target: { value: "Do you have a non-compete agreement?" },
  })
  const kind = screen.getByLabelText("Answer kind")
  kind.focus()
  fireEvent.change(kind, { target: { value: "yes_no" } })
  await waitFor(() => expect(screen.getByLabelText("The answer")).toBeTruthy())
  client.clear()
})

it("shows the country and time an authorization answer holds for", async () => {
  const client = show()
  await screen.findByText(/Are you authorized to work/)
  expect(screen.getByText("Country:")).toBeInTheDocument()
  expect(screen.getByText("US")).toBeInTheDocument()
  expect(screen.getByText("Time:")).toBeInTheDocument()
  expect(screen.getByText("2026-10-14")).toBeInTheDocument()
  expect(screen.getByText("yes")).toBeInTheDocument()
  client.clear()
})

it("says why when the server refuses to keep an answer", async () => {
  const client = show()
  api.saveSavedAnswer.mockRejectedValue(
    new ApiError(
      "VALIDATION",
      "Choose the scope this answer may be reused in",
      400
    )
  )
  fireEvent.click(screen.getByRole("button", { name: "Add a kept answer" }))
  fireEvent.change(screen.getByLabelText("The question as the page asks it"), {
    target: { value: "Which office do you prefer working from?" },
  })
  fireEvent.change(screen.getByLabelText("The answer"), {
    target: { value: "Lisbon" },
  })
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "Acme" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Keep this answer" }))
  expect(
    await screen.findByText("Choose the scope this answer may be reused in")
  ).toBeInTheDocument()
  client.clear()
})
