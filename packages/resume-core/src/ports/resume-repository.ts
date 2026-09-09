import type {
  Resume,
  TemplateId,
  TemplateOptions,
} from "@workspace/resume-schema"

import type {
  HeadWrite,
  NewResume,
  ResumeRecord,
  ResumeSummary,
} from "../domain/resume"

/**
 * Why this is a result union rather than `HeadWrite | null`: a guarded update
 * that touches no rows means either the resume is gone or someone else moved
 * the head, and the caller must tell a 404 from a 409. Collapsing both to null
 * pushes that question back to every call site.
 */
export type UpdateDataResult =
  | ({ ok: true } & HeadWrite)
  | { ok: false; reason: "not_found" | "conflict" }

export type UpdateDataInput = {
  id: string
  data: Resume
  schemaVersion: number
  /** Omitted by the conflict-recovery overwrite, which means "take mine". */
  expectedRevision?: number
}

export interface ResumeRepository {
  /** Newest first, excluding soft-deleted rows. */
  list(): Promise<ResumeSummary[]>
  findById(id: string): Promise<ResumeRecord | null>
  create(input: NewResume): Promise<ResumeRecord>
  updateData(input: UpdateDataInput): Promise<UpdateDataResult>
  /** Neither of these moves `revision`; only document writes do. */
  rename(id: string, title: string): Promise<boolean>
  setSubtitle(id: string, subtitle: string): Promise<boolean>
  setTemplate(
    id: string,
    templateId: TemplateId,
    options: TemplateOptions
  ): Promise<boolean>
  softDelete(id: string): Promise<boolean>
}
