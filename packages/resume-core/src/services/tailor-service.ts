import {
  assembleResume,
  regenerateIds,
  ResumeSchema,
} from "@workspace/resume-schema"

import { AppError } from "../domain/errors"
import {
  MAX_JOB_CHARS,
  MIN_JOB_CHARS,
  type ParsedJobPosting,
} from "../domain/job-target"
import { normalizeLinkedInJobUrl } from "../domain/linkedin"
import type { ResumeSummary } from "../domain/resume"
import { enforceTailorRules } from "../domain/tailor"
import type { JobFetcher } from "../ports/job-fetcher"
import type { JobParser } from "../ports/job-parser"
import type { JobTargetRepository } from "../ports/job-target-repository"
import type { ResumeTailor } from "../ports/resume-tailor"
import type { MemoryService } from "./memory-service"
import { NEW_SUBTITLE, type ResumeService } from "./resume-service"
import type { RunService } from "./run-service"
import type { VersionService } from "./version-service"

/**
 * Deliberately not a member of the `SKILLS` registry. A skill is something the
 * assistant chooses between mid-conversation and whose patches are checked
 * against an op and field whitelist; this is neither, and adding it to the
 * registry would put a whole-document writer behind a union that promises
 * patch validation.
 */
export const TAILOR_SKILL_ID = "tailor_from_job"

export type TailorFromJobInput = {
  sourceResumeId: string
  jobText: string
  /** The canonical LinkedIn URL, when the text was fetched rather than pasted. */
  sourceUrl?: string
  signal?: AbortSignal
}

export type TailorFromJobResult = {
  resume: ResumeSummary
  jobTargetId: string
  /** False when the writing call failed, timed out, or was cancelled. */
  tailored: boolean
  model: string | null
}

/**
 * Creates a resume from a job posting.
 *
 * The resume row is created before the writing call, which is what makes every
 * failure land on one path. `agent_runs.conversation_id` is not null and a
 * conversation needs a resume, so the ordering was forced; the consequence is
 * that a model failure costs the user a plain duplicate rather than nothing,
 * which is worth having on purpose.
 */
export class TailorService {
  constructor(
    private readonly jobParser: JobParser,
    private readonly resumeTailor: ResumeTailor,
    private readonly jobTargets: JobTargetRepository,
    private readonly resumes: ResumeService,
    private readonly versions: VersionService,
    private readonly runs: RunService,
    private readonly memory: MemoryService,
    private readonly jobFetcher: JobFetcher
  ) {}

  /**
   * Fetches a posting so the user can read it before generating anything.
   *
   * LinkedIn is the only host accepted, because it is the only one whose URL
   * shapes are known well enough to normalise and the only one whose markup
   * this strips correctly. Everything else is a paste.
   */
  async fetchPosting(
    rawUrl: string,
    signal?: AbortSignal
  ): Promise<{ url: string; text: string }> {
    const url = normalizeLinkedInJobUrl(rawUrl)
    if (!url) {
      throw new AppError(
        "VALIDATION",
        "That is not a LinkedIn job link. Paste the description instead."
      )
    }

    const text = await this.jobFetcher.fetch(url, signal)
    const trimmed = text.trim().slice(0, MAX_JOB_CHARS)
    if (trimmed.length < MIN_JOB_CHARS) {
      throw new AppError(
        "NOT_FOUND",
        "That posting could not be read. Open it and paste the description instead."
      )
    }
    return { url, text: trimmed }
  }

  async tailorFromJob(input: TailorFromJobInput): Promise<TailorFromJobResult> {
    const text = input.jobText.trim()
    if (text.length < MIN_JOB_CHARS) {
      throw new AppError(
        "VALIDATION",
        "That is too short to be a job posting. Paste the whole description."
      )
    }
    if (text.length > MAX_JOB_CHARS) {
      throw new AppError(
        "VALIDATION",
        `That is over the ${MAX_JOB_CHARS.toLocaleString()} character limit. Trim it and try again.`
      )
    }

    // Before either model call, so a user who has exhausted the hour is told
    // so rather than being charged for the parse.
    await this.runs.assertWithinHourlyLimit()

    const source = await this.resumes.get(input.sourceResumeId)

    const { parsed: posting, model: parseModel } = await this.jobParser.parse({
      text,
      signal: input.signal,
    })

    const target = await this.jobTargets.create({
      sourceUrl: input.sourceUrl ?? null,
      rawText: text,
      title: posting.title,
      company: posting.company,
      location: posting.location ?? null,
      requirements: {
        mustHaves: posting.mustHaves,
        niceToHaves: posting.niceToHaves,
        keywords: posting.keywords,
      },
    })

    // The neutral subtitle, upgraded only once the document is actually
    // written. A resume that never got tailored must not say that it was.
    const created = await this.resumes.create({
      fromResumeId: source.id,
      title: titleFor(posting, source.title),
      subtitle: NEW_SUBTITLE,
    })

    await this.jobTargets.link({
      resumeId: created.id,
      jobTargetId: target.id,
      isOrigin: true,
    })

    const conversation = await this.memory.openConversation(created.id)
    const run = await this.runs.startForCreation({
      conversationId: conversation.id,
      resumeId: created.id,
      skillId: TAILOR_SKILL_ID,
      model: parseModel,
      // Ids only. `finish` clears this column anyway; the link row is what
      // makes the posting recoverable afterwards.
      input: { jobTargetId: target.id, sourceResumeId: source.id },
    })

    const startedAt = Date.now()
    try {
      const { parsed, model } = await this.resumeTailor.tailor({
        resume: source.data,
        posting,
        signal: input.signal,
      })

      // `assembleResume` mints ids for the model's id-free output; restoring a
      // source item reintroduces the source's ids, so the whole document is
      // renumbered once before it is validated.
      const merged = regenerateIds(
        enforceTailorRules(source.data, assembleResume(parsed))
      )
      const checked = ResumeSchema.safeParse(merged)
      if (!checked.success) {
        throw new AppError(
          "VALIDATION",
          checked.error.issues[0]?.message ?? "The tailored resume was invalid"
        )
      }

      await this.resumes.update({ id: created.id, data: checked.data })
      const subtitle = subtitleFor(posting)
      await this.resumes.setSubtitle(created.id, subtitle)
      await this.runs.finish(run.id, {
        status: "completed",
        latencyMs: Date.now() - startedAt,
      })
      await this.versions.snapshot(created.id, {
        label: labelFor(posting),
        createdBy: "system",
        agentRunId: run.id,
      })

      return {
        resume: { ...created, subtitle },
        jobTargetId: target.id,
        tailored: true,
        model,
      }
    } catch (error) {
      const cancelled = isAbort(error)
      await this.runs.finish(run.id, {
        status: cancelled ? "cancelled" : "failed",
        errorClass: cancelled ? "aborted" : "tailor_failed",
        latencyMs: Date.now() - startedAt,
      })
      // The duplicate stands. One version either way, so History reads the
      // same whichever path ran, and only the label says which.
      await this.versions.snapshot(created.id, {
        label: `Assembled from ${source.title}`,
        createdBy: "system",
        agentRunId: run.id,
      })

      return {
        resume: created,
        jobTargetId: target.id,
        tailored: false,
        model: null,
      }
    }
  }
}

/** Static, set once. Deriving it from a join would rename the resume whenever
 *  the user attached another posting to it. */
function titleFor(posting: ParsedJobPosting, fallback: string): string {
  const company = posting.company.trim()
  const role = posting.title.trim()
  if (company && role) return `${company} - ${role}`
  return company || role || `${fallback} copy`
}

function subtitleFor(posting: ParsedJobPosting): string {
  const company = posting.company.trim()
  return company ? `Tailored for ${company}` : "Tailored for this role"
}

function labelFor(posting: ParsedJobPosting): string {
  const role = posting.title.trim() || "this role"
  const company = posting.company.trim()
  return company ? `Tailored for ${role} at ${company}` : `Tailored for ${role}`
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}
