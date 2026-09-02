import type { Resume } from "@workspace/resume-schema"

export type CreatedByKind = "user" | "agent" | "system"

export type VersionSummary = {
  id: string
  versionNo: number
  label: string
  createdBy: CreatedByKind
  createdAt: string
}

export type VersionRecord = VersionSummary & {
  resumeId: string
  content: Resume
  /** sha256 of the canonical JSON, used to dedupe identical snapshots. */
  contentHash: string
}
