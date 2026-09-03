import { z } from "zod"

/**
 * The consolidated layer of conversation memory (over-all design, section
 * 6.4). The model produces the object; the text the next request sees is
 * rendered from it by `renderSummaryText`, so the two can never disagree.
 */
export const MemorySummarySchema = z.object({
  user_goal: z.string().max(300).optional(),
  resume_focus: z.array(z.string().max(60)).max(10),
  preferences: z.array(z.string().max(120)).max(10),
  decisions: z.array(z.string().max(160)).max(20),
  open_tasks: z.array(z.string().max(160)).max(10),
})
export type MemorySummary = z.infer<typeof MemorySummarySchema>

export const EMPTY_SUMMARY: MemorySummary = {
  resume_focus: [],
  preferences: [],
  decisions: [],
  open_tasks: [],
}

export function renderSummaryText(summary: MemorySummary): string {
  const lines: string[] = []
  if (summary.user_goal) lines.push(`Goal: ${summary.user_goal}`)
  const list = (label: string, items: string[]) => {
    if (items.length > 0) lines.push(`${label}: ${items.join("; ")}`)
  }
  list("Focus", summary.resume_focus)
  list("Preferences", summary.preferences)
  list("Decisions", summary.decisions)
  list("Open tasks", summary.open_tasks)
  return lines.join("\n")
}

export type SummaryRecord = {
  id: string
  conversationId: string
  summary: MemorySummary
  summaryText: string
  /** The message range this summary covers, inclusive. */
  sourceFromSeq: number
  sourceToSeq: number
  model: string
  createdAt: string
}

export type NewSummary = Omit<
  SummaryRecord,
  "id" | "conversationId" | "createdAt"
>
