import {
  DEFAULT_TEMPLATE_ID,
  defaultTemplateOptions,
  migrateResume,
  regenerateIds,
  ResumeSchema,
  type Resume,
  type TemplateId,
  type TemplateOptions,
} from "@workspace/resume-schema"
import { starter } from "@workspace/resume-schema/fixtures"

import { AppError } from "../domain/errors"
import type { HeadWrite, ResumeRecord, ResumeSummary } from "../domain/resume"
import {
  HITS_PER_RESUME,
  MAX_SEARCH_RESULTS,
  MIN_SEARCH_LENGTH,
  matchDocument,
  matchTokens,
  type ResumeSearch,
  type ResumeSearchGroup,
  tokenize,
} from "../domain/search"
import type { ResumeRepository } from "../ports/resume-repository"

const UNTITLED = "Untitled resume"
export const NEW_SUBTITLE = "Draft · not tailored"
const IMPORTED_SUBTITLE = "Imported · not tailored"

export type CreateResumeInput = {
  title?: string
  /**
   * Forces the line under the title. Without it a copy inherits the source's,
   * which would let a resume claim it was tailored for a company it has never
   * been near, because its source once was.
   */
  subtitle?: string
  /** When set, the new resume is a deep copy with every node id regenerated. */
  fromResumeId?: string
  /**
   * Seed content, currently only from import. Takes precedence over the
   * starter fixture; ids are regenerated like any other seed.
   */
  document?: Resume
}

export type UpdateResumeInput = {
  id: string
  data: Resume
  expectedRevision?: number
}

export class ResumeService {
  constructor(private readonly resumes: ResumeRepository) {}

  list(): Promise<ResumeSummary[]> {
    return this.resumes.list()
  }

  /**
   * Title and body search across every resume, for the rail.
   *
   * Records arrive migrated (both adapters do that on read), so the walk sees
   * the same document `get` would return. A query that cannot match anything
   * yet returns an empty result rather than an error: the caller is a search
   * box, and a one-letter query is a normal state, not a fault.
   */
  async search(query: string): Promise<ResumeSearch> {
    const tokens = tokenize(query)
    if (query.trim().length < MIN_SEARCH_LENGTH || tokens.length === 0) {
      return { groups: [], scanned: 0 }
    }

    const records = await this.resumes.listRecords()
    const groups: ResumeSearchGroup[] = []
    for (const record of records) {
      const hits = matchDocument(record.data, tokens)
      const titleRanges = matchTokens(record.title, tokens)
      if (hits.length === 0 && titleRanges.length === 0) continue
      groups.push({
        resume: toSummary(record),
        titleRanges,
        hits: hits.slice(0, HITS_PER_RESUME),
        totalHits: hits.length,
      })
    }

    // A title hit is a stronger signal than a body hit, so those resumes come
    // first; inside a tier the order stays the rail's own, newest first.
    groups.sort(
      (a, b) =>
        titleTier(a) - titleTier(b) ||
        b.resume.updatedAt.localeCompare(a.resume.updatedAt)
    )

    return {
      groups: groups.slice(0, MAX_SEARCH_RESULTS),
      scanned: records.length,
    }
  }

  async get(id: string): Promise<ResumeRecord> {
    const record = await this.resumes.findById(id)
    if (!record) throw new AppError("NOT_FOUND", "Resume not found")
    // Migrating on read means a document written by an older release is
    // upgraded before anything downstream sees it, and validated on the way.
    return { ...record, data: migrateResume(record.data) }
  }

  async create(input: CreateResumeInput = {}): Promise<ResumeSummary> {
    const source = input.fromResumeId
      ? await this.resumes.findById(input.fromResumeId)
      : null
    if (input.fromResumeId && !source) {
      throw new AppError("NOT_FOUND", "Resume not found")
    }

    const data = regenerateIds(input.document ?? source?.data ?? starter)

    return this.resumes.create({
      title: input.title ?? (source ? `${source.title} copy` : UNTITLED),
      subtitle:
        input.subtitle ??
        (source
          ? source.subtitle
          : input.document
            ? IMPORTED_SUBTITLE
            : NEW_SUBTITLE),
      data,
      schemaVersion: data.schemaVersion,
      templateId: source?.templateId ?? DEFAULT_TEMPLATE_ID,
      templateOptions: source?.templateOptions ?? defaultTemplateOptions,
    })
  }

  duplicate(id: string): Promise<ResumeSummary> {
    return this.create({ fromResumeId: id })
  }

  async update(input: UpdateResumeInput): Promise<HeadWrite> {
    const parsed = ResumeSchema.safeParse(input.data)
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION",
        parsed.error.issues[0]?.message ?? "Invalid resume"
      )
    }

    const result = await this.resumes.updateData({
      id: input.id,
      data: parsed.data,
      schemaVersion: parsed.data.schemaVersion,
      expectedRevision: input.expectedRevision,
    })

    if (result.ok)
      return { revision: result.revision, updatedAt: result.updatedAt }
    if (result.reason === "not_found") {
      throw new AppError("NOT_FOUND", "Resume not found")
    }
    throw new AppError("CONFLICT", "This resume changed in another tab")
  }

  async rename(id: string, title: string): Promise<void> {
    const next = title.trim() || UNTITLED
    if (!(await this.resumes.rename(id, next))) {
      throw new AppError("NOT_FOUND", "Resume not found")
    }
  }

  async setSubtitle(id: string, subtitle: string): Promise<void> {
    if (!(await this.resumes.setSubtitle(id, subtitle))) {
      throw new AppError("NOT_FOUND", "Resume not found")
    }
  }

  async setTemplate(
    id: string,
    templateId: TemplateId,
    options: TemplateOptions
  ): Promise<void> {
    if (!(await this.resumes.setTemplate(id, templateId, options))) {
      throw new AppError("NOT_FOUND", "Resume not found")
    }
  }

  async remove(id: string): Promise<void> {
    if (!(await this.resumes.softDelete(id))) {
      throw new AppError("NOT_FOUND", "Resume not found")
    }
  }
}

/** The rail's card fields, off a record the search already holds. */
function toSummary(record: ResumeRecord): ResumeSummary {
  const { id, title, subtitle, templateId, updatedAt } = record
  return { id, title, subtitle, templateId, updatedAt }
}

/** 0 for a resume whose title matched, 1 for body-only. */
function titleTier(group: ResumeSearchGroup): number {
  return group.titleRanges.length > 0 ? 0 : 1
}
