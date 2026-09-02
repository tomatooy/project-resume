import type {
  Resume,
  ResumePatch,
  TemplateId,
  TemplateOptions,
} from "@workspace/resume-schema"

import type { AgentRun, SuggestionStatus } from "../domain/suggestion"
import type { CreatedByKind } from "../domain/version"

export type ResumeRow = {
  id: string
  title: string
  subtitle: string
  data: Resume
  schemaVersion: number
  templateId: TemplateId
  templateOptions: TemplateOptions
  currentVersionId: string | null
  revision: number
  updatedAt: string
  deletedAt: string | null
}

export type VersionRow = {
  id: string
  resumeId: string
  versionNo: number
  content: Resume
  schemaVersion: number
  contentHash: string
  label: string
  createdBy: CreatedByKind
  agentRunId: string | null
  createdAt: string
}

export type SuggestionRow = {
  id: string
  runId: string
  resumeId: string
  ordinal: number
  patch: ResumePatch
  targetNodeId: string
  status: SuggestionStatus
}

/**
 * The shared store the in-memory repositories read and write, standing in for
 * one Postgres database. Time and ids are injectable so tests can assert on
 * ordering without sleeping.
 */
export class InMemoryDb {
  resumes: ResumeRow[] = []
  versions: VersionRow[] = []
  conversations: { id: string; resumeId: string }[] = []
  runs: AgentRun[] = []
  suggestions: SuggestionRow[] = []

  private seq = 0
  private tick = 0

  uuid(): string {
    this.seq += 1
    // Shaped like a uuid so anything that pattern-matches on one still works.
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`
  }

  /** Monotonic, so `updatedAt` ordering is deterministic across fast writes. */
  advance(): number {
    this.tick += 1
    return this.tick
  }
}

const EPOCH = Date.UTC(2026, 0, 1)

export function nowIso(db: InMemoryDb): string {
  return new Date(EPOCH + db.advance() * 1000).toISOString()
}
