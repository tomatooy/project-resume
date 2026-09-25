import {
  PAGE_SIZE,
  parseResumeCursor,
  resumeCursor,
  type ResumePageInput,
} from "../domain/resume"
import { matchTokens } from "../domain/search"
import { migrateResume } from "@workspace/resume-schema"
import type { TemplateId, TemplateOptions } from "@workspace/resume-schema"

import type { NewResume, ResumeRecord, ResumeSummary } from "../domain/resume"
import type {
  ResumeRepository,
  UpdateDataInput,
  UpdateDataResult,
} from "../ports/resume-repository"
import { type InMemoryDb, nowIso } from "./db"

/**
 * Mirrors the Supabase adapter's observable behaviour, including the parts that
 * live in Postgres: `revision` moves only when `data` changes, `updated_at`
 * moves on every write, and soft-deleted rows disappear from `list`.
 */
export class InMemoryResumeRepository implements ResumeRepository {
  constructor(private readonly db: InMemoryDb) {}

  async list(): Promise<ResumeSummary[]> {
    return this.db.resumes
      .filter((r) => !r.deletedAt)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
      )
      .map(toSummary)
  }

  async listRecords(): Promise<ResumeRecord[]> {
    return this.db.resumes
      .filter((r) => !r.deletedAt)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
      )
      .map(toRecord)
  }

  async page(input: ResumePageInput) {
    const all = await this.list()
    const cursor = input.cursor ? parseResumeCursor(input.cursor) : null
    const rows = all.filter(
      (row) =>
        !cursor ||
        row.updatedAt < cursor.updatedAt ||
        (row.updatedAt === cursor.updatedAt && row.id < cursor.id)
    )
    const items = rows.slice(0, PAGE_SIZE)
    const last = items.at(-1)
    return {
      items,
      nextCursor: rows.length > PAGE_SIZE && last ? resumeCursor(last) : null,
      ...(!cursor ? { total: all.length } : {}),
    }
  }
  async summary(id: string) {
    return (await this.list()).find((row) => row.id === id) ?? null
  }
  async count() {
    return (await this.list()).length
  }
  async searchCandidates(
    tokens: string[],
    phase: "title" | "body",
    after?: string
  ) {
    const cursor = after ? parseResumeCursor(after) : null
    const rows = (await this.listRecords()).filter(
      (row) =>
        (!cursor ||
          row.updatedAt < cursor.updatedAt ||
          (row.updatedAt === cursor.updatedAt && row.id < cursor.id)) &&
        (phase === "body" || matchTokens(row.title, tokens).length > 0)
    )
    const records = rows.slice(0, 50)
    const last = records.at(-1)
    return {
      records,
      nextCursor: rows.length > 50 && last ? resumeCursor(last) : null,
    }
  }

  async findById(id: string): Promise<ResumeRecord | null> {
    const row = this.db.resumes.find((r) => r.id === id && !r.deletedAt)
    return row ? toRecord(row) : null
  }

  async create(input: NewResume): Promise<ResumeRecord> {
    const row = {
      id: this.db.uuid(),
      ...input,
      currentVersionId: null,
      revision: 1,
      updatedAt: nowIso(this.db),
      deletedAt: null as string | null,
    }
    this.db.resumes.push(row)
    return toRecord(row)
  }

  async updateData(input: UpdateDataInput): Promise<UpdateDataResult> {
    const row = this.db.resumes.find((r) => r.id === input.id && !r.deletedAt)
    if (!row) return { ok: false, reason: "not_found" }
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== row.revision
    ) {
      return { ok: false, reason: "conflict" }
    }

    const changed = JSON.stringify(row.data) !== JSON.stringify(input.data)
    row.data = input.data
    row.schemaVersion = input.schemaVersion
    if (changed) row.revision += 1
    row.updatedAt = nowIso(this.db)
    return { ok: true, revision: row.revision, updatedAt: row.updatedAt }
  }

  async rename(id: string, title: string): Promise<boolean> {
    const row = this.db.resumes.find((r) => r.id === id && !r.deletedAt)
    if (!row) return false
    row.title = title
    // Deliberately not `revision`: renaming must not invalidate an in-flight
    // autosave's token.
    row.updatedAt = nowIso(this.db)
    return true
  }

  async setSubtitle(id: string, subtitle: string): Promise<boolean> {
    const row = this.db.resumes.find((r) => r.id === id && !r.deletedAt)
    if (!row) return false
    row.subtitle = subtitle
    // The line under the title is not the document, so it must not move
    // `revision` either.
    row.updatedAt = nowIso(this.db)
    return true
  }

  async setTemplate(
    id: string,
    templateId: TemplateId,
    options: TemplateOptions
  ): Promise<boolean> {
    const row = this.db.resumes.find((r) => r.id === id && !r.deletedAt)
    if (!row) return false
    row.templateId = templateId
    row.templateOptions = options
    row.updatedAt = nowIso(this.db)
    return true
  }

  async softDelete(id: string): Promise<boolean> {
    const row = this.db.resumes.find((r) => r.id === id && !r.deletedAt)
    if (!row) return false
    row.deletedAt = nowIso(this.db)
    return true
  }
}

type Row = InMemoryDb["resumes"][number]

function toSummary(row: Row): ResumeSummary {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    templateId: row.templateId,
    updatedAt: row.updatedAt,
  }
}

function toRecord(row: Row): ResumeRecord {
  return {
    ...toSummary(row),
    data: migrateResume(row.data),
    schemaVersion: row.schemaVersion,
    templateOptions: row.templateOptions,
    currentVersionId: row.currentVersionId,
    revision: row.revision,
  }
}
