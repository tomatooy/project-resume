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
