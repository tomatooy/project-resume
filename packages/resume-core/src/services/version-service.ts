import { contentHash, type Resume } from "@workspace/resume-schema"

import { AppError } from "../domain/errors"
import type { CreatedByKind, VersionSummary } from "../domain/version"
import type { ResumeRepository } from "../ports/resume-repository"
import type { VersionRepository } from "../ports/version-repository"

export type SnapshotOptions = {
  label?: string
  createdBy: CreatedByKind
  agentRunId?: string | null
}

export type RestoreResult = {
  head: Resume
  revision: number
  updatedAt: string
  version: VersionSummary
}

const DEFAULT_LABEL = "Saved version"

export class VersionService {
  constructor(
    private readonly resumes: ResumeRepository,
    private readonly versions: VersionRepository
  ) {}

  list(resumeId: string): Promise<VersionSummary[]> {
    return this.versions.list(resumeId)
  }

  page(resumeId: string, cursor?: number) {
    return this.versions.page(resumeId, cursor)
  }

  async getContent(versionId: string): Promise<{ content: Resume }> {
    const version = await this.versions.findById(versionId)
    if (!version) throw new AppError("NOT_FOUND", "Version not found")
    return { content: version.content }
  }

  /**
   * Writes the current head as a version. Deduping against the current version
   * happens in the database, so two clients pressing "Save version" at once
   * cannot both win.
   */
  async snapshot(
    resumeId: string,
    options: SnapshotOptions
  ): Promise<VersionSummary> {
    const resume = await this.resumes.findById(resumeId)
    if (!resume) throw new AppError("NOT_FOUND", "Resume not found")

    const result = await this.versions.create({
      resumeId,
      content: resume.data,
      schemaVersion: resume.schemaVersion,
      contentHash: await contentHash(resume.data),
      label: options.label ?? DEFAULT_LABEL,
      createdBy: options.createdBy,
      agentRunId: options.agentRunId ?? null,
    })
    return result.version
  }

  async restore(resumeId: string, versionId: string): Promise<RestoreResult> {
    const version = await this.versions.findById(versionId)
    // A version id from another resume is not a permission problem to explain,
    // it is simply not found on this one.
    if (!version || version.resumeId !== resumeId) {
      throw new AppError("NOT_FOUND", "Version not found")
    }

    const result = await this.versions.create({
      resumeId,
      content: version.content,
      schemaVersion: version.content.schemaVersion,
      contentHash: version.contentHash,
      label: `Restored from v${version.versionNo}`,
      createdBy: "user",
      agentRunId: null,
      // A restore is worth a row even when it brings back what the current
      // version already holds; History should show that it happened.
      dedupe: false,
    })

    return {
      head: version.content,
      revision: result.revision,
      updatedAt: result.updatedAt,
      version: result.version,
    }
  }
}
