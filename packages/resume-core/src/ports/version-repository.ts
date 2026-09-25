import type { Resume } from "@workspace/resume-schema"

import type {
  CreatedByKind,
  VersionRecord,
  VersionSummary,
  VersionPage,
} from "../domain/version"

export type CreateVersionInput = {
  resumeId: string
  content: Resume
  schemaVersion: number
  contentHash: string
  label: string
  createdBy: CreatedByKind
  agentRunId?: string | null
  /**
   * Skip writing a row when the content already matches the current version.
   * On by default so pressing "Save version" twice is a no-op. Restore turns
   * it off: restoring is an event worth recording even when the content it
   * brings back is what the current version already holds.
   */
  dedupe?: boolean
}

export type CreateVersionResult = {
  version: VersionSummary
  /** The head moved, so the caller's concurrency token has to move with it. */
  revision: number
  updatedAt: string
  /** True when the content matched the current version and nothing was written. */
  deduped: boolean
}

export interface VersionRepository {
  /** Newest first. */
  list(resumeId: string): Promise<VersionSummary[]>
  page(resumeId: string, cursor?: number): Promise<VersionPage>
  findById(id: string): Promise<VersionRecord | null>
  create(input: CreateVersionInput): Promise<CreateVersionResult>
}
