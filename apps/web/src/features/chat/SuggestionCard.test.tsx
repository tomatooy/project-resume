import type { Resume, ResumePatch } from "@workspace/resume-schema"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { Suggestion, SuggestionStatus } from "@/lib/types"
import { SuggestionCard } from "./SuggestionCard"

/**
 * The estimate note is the only place a figure the resume does not state is
 * called out. It has to appear on a pending card and stay away from a patch
 * that only restates what the document already says, or the note becomes
 * wallpaper the user learns to skip.
 */

const BULLET_ID = "bul_aaaaaaaaaa"

const resume: Resume = {
  schemaVersion: 1,
  basics: { id: "basics", name: "Jo Rivera", links: [] },
  sections: [
    {
      id: "sec_aaaaaaaaaa",
      type: "experience",
      title: "Experience",
      items: [
        {
          id: "exp_aaaaaaaaaa",
          kind: "experience",
          company: "Acme",
          role: "Engineer",
          start: "2020-01",
          end: "present",
          bullets: [{ id: BULLET_ID, text: "Shipped 3 things" }],
        },
      ],
    },
  ],
}

const rewrite: ResumePatch = {
  op: "replace_text",
  targetNodeId: BULLET_ID,
  field: "text",
  before: "Shipped 3 things",
  after: "Shipped 18 services",
  reason: "Adds the size.",
}

function show(patch: ResumePatch, status: SuggestionStatus = "pending") {
  const suggestion: Suggestion = {
    id: "s1",
    runId: "r1",
    ordinal: 0,
    patch,
    status,
  }
  render(
    // The card resolves its attribution from the skills query; the wrapper is
    // here for that lookup, not for anything the estimate note needs.
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SuggestionCard
        suggestion={suggestion}
        resume={resume}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onHover={vi.fn()}
        busy={false}
      />
    </QueryClientProvider>
  )
}

describe("the estimate note", () => {
  it("names a figure the resume does not state", () => {
    show(rewrite)
    expect(screen.getByText(/Not in the resume: 18\./)).toBeDefined()
  })

  it("stays away when the patch restates a figure the resume has", () => {
    show({ ...rewrite, after: "Shipped the 3 things twice as fast" })
    expect(screen.queryByText(/Not in the resume:/)).toBeNull()
  })

  it("is not shown once the card is decided", () => {
    show(rewrite, "rejected")
    expect(screen.queryByText(/Not in the resume:/)).toBeNull()
  })
})
