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
  ResumePage,
  ResumePageInput,
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
  page(input: ResumePageInput): Promise<ResumePage>
  summary(id: string): Promise<ResumeSummary | null>
  count(): Promise<number>
  searchCandidates(
    tokens: string[],
    phase: "title" | "body",
    cursor?: string
  ): Promise<{ records: ResumeRecord[]; nextCursor: string | null }>
  /**
   * The same rows as `list()`, with their documents, for the rail search.
   *
   * Deliberately a thin read: the matching lives in the service, so both
   * adapters stay dumb and the tests drive one copy of the walk.
   */
  listRecords(): Promise<ResumeRecord[]>
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
