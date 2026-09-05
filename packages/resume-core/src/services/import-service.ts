import {
  ResumeSchema,
  assembleResume,
  importTitle,
} from "@workspace/resume-schema"

import { AppError } from "../domain/errors"
import type { ResumeSummary } from "../domain/resume"
import type { ResumeParser } from "../ports/resume-parser"
import type { ResumeService } from "./resume-service"
import type { VersionService } from "./version-service"

/** Same ceiling as a pasted job description, so there is one number to know. */
export const MAX_IMPORT_CHARS = 20_000
const MIN_IMPORT_CHARS = 40

export type ImportResumeInput = {
  text: string
  signal?: AbortSignal
}

export type ImportResumeResult = {
  resume: ResumeSummary
  model: string
}

/**
 * Read text, write a resume.
 *
 * The row is written only once a valid document exists, so a failed import
 * leaves nothing behind to clean up. The one thing it does that blank creation
 * does not is snapshot a version: an import is the only resume whose starting
 * content the user cannot reproduce, so "restore the original import" has to
 * survive the first hour of editing.
 */
export class ImportService {
  constructor(
    private readonly parser: ResumeParser,
    private readonly resumes: ResumeService,
    private readonly versions: VersionService
  ) {}

  async import(input: ImportResumeInput): Promise<ImportResumeResult> {
    const text = input.text.trim()
    if (text.length < MIN_IMPORT_CHARS) {
      throw new AppError(
        "VALIDATION",
        "There is not enough text here to read as a resume."
      )
    }
    if (text.length > MAX_IMPORT_CHARS) {
      throw new AppError(
        "VALIDATION",
        "That is too long to import. Trim it to 20,000 characters."
      )
    }

    const { parsed, model } = await this.parser.parse({
      text,
      signal: input.signal,
    })

    const document = assembleResume(parsed)
    const valid = ResumeSchema.safeParse(document)
    // Assembly is meant to make this unreachable; if it ever is reached, the
    // bug is here rather than in the model, and the user gets no half resume.
    if (!valid.success) {
      throw new AppError("INTERNAL", "We could not turn that into a resume.")
    }
    if (valid.data.sections.length === 0) {
      throw new AppError(
        "VALIDATION",
        "We could not find any resume sections in that text."
      )
    }

    const resume = await this.resumes.create({
      title: importTitle(valid.data),
      document: valid.data,
    })
    await this.versions.snapshot(resume.id, {
      label: "Imported",
      createdBy: "system",
    })

    return { resume, model }
  }
}
