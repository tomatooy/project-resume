import type { Resume } from "@workspace/resume-schema"

import type { VersionRecord, VersionSummary } from "../domain/version"
import type {
  CreateVersionInput,
  CreateVersionResult,
  VersionRepository,
} from "../ports/version-repository"
import type { InMemoryDb, VersionRow } from "./db"
import { nowIso } from "./db"

export class InMemoryVersionRepository implements VersionRepository {
  constructor(private readonly db: InMemoryDb) {}

  async list(resumeId: string): Promise<VersionSummary[]> {
    return this.db.versions
      .filter((v) => v.resumeId === resumeId)
      .sort((a, b) => b.versionNo - a.versionNo)
      .map(toSummary)
  }

  async page(resumeId: string, cursor?: number) {
    const rows = (await this.list(resumeId)).filter(
      (row) => cursor === undefined || row.versionNo < cursor
    )
    const items = rows.slice(0, 30)
    return {
      items,
      nextCursor: rows.length > 30 ? (items.at(-1)?.versionNo ?? null) : null,
    }
  }

  async findById(id: string): Promise<VersionRecord | null> {
    const row = this.db.versions.find((v) => v.id === id)
    return row
      ? {
          ...toSummary(row),
          resumeId: row.resumeId,
          content: row.content,
          contentHash: row.contentHash,
        }
      : null
  }

  async create(input: CreateVersionInput): Promise<CreateVersionResult> {
    const resume = this.db.resumes.find((r) => r.id === input.resumeId)
    if (!resume) throw new Error(`resume ${input.resumeId} not found`)

    // Dedupe against the current version only, matching the RPC: saving twice
    // with no edit is a no-op, but restoring an old version and saving again
    // is not.
    const current = this.db.versions.find(
      (v) => v.id === resume.currentVersionId
    )
    if (
      input.dedupe !== false &&
      current &&
      current.contentHash === input.contentHash
    ) {
      // The head can sit ahead of the current version, because autosave moves
      // it without creating one. Returning early without writing the content
      // back would make a restore onto the current version do nothing at all.
      moveHead(resume, input.content, input.schemaVersion, this.db)
      return {
        version: toSummary(current),
        revision: resume.revision,
        updatedAt: resume.updatedAt,
        deduped: true,
      }
    }

    const versionNo =
      this.db.versions
        .filter((v) => v.resumeId === input.resumeId)
        .reduce((max, v) => Math.max(max, v.versionNo), 0) + 1

    const row: VersionRow = {
      id: this.db.uuid(),
      resumeId: input.resumeId,
      versionNo,
      content: structuredClone(input.content),
      schemaVersion: input.schemaVersion,
      contentHash: input.contentHash,
      label: input.label,
      createdBy: input.createdBy,
      agentRunId: input.agentRunId ?? null,
      createdAt: nowIso(this.db),
    }
    this.db.versions.push(row)

    // Same as the RPC: the head moves onto the new version, which the trigger
    // turns into a revision bump.
    moveHead(resume, input.content, input.schemaVersion, this.db)
    resume.currentVersionId = row.id

    return {
      version: toSummary(row),
      revision: resume.revision,
      updatedAt: resume.updatedAt,
      deduped: false,
    }
  }
}

function moveHead(
  resume: InMemoryDb["resumes"][number],
  content: Resume,
  schemaVersion: number,
  db: InMemoryDb
): void {
  const changed = JSON.stringify(resume.data) !== JSON.stringify(content)
  resume.data = structuredClone(content)
  resume.schemaVersion = schemaVersion
  if (changed) resume.revision += 1
  resume.updatedAt = nowIso(db)
}

function toSummary(row: VersionRow): VersionSummary {
  return {
    id: row.id,
    versionNo: row.versionNo,
    label: row.label,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}
