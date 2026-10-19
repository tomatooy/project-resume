import {
  companiesMatch,
  missingAnswers,
  resumeFileName,
  ruleFills,
} from "@workspace/autofill"

import type {
  AutofillPage,
  JobMatch,
  PlanInput,
  PlanResult,
  ResumeChoice,
  StartInput,
  StartResult,
} from "../domain/autofill"
import type { JobIdentity } from "../domain/job-identity"
import type { JobBrief, ResumeRecord } from "../domain/resume"
import type { AutofillApplicationRepository } from "../ports/autofill-application-repository"
import type { AutofillModels } from "../ports/autofill-models"
import type { JobTargetRepository } from "../ports/job-target-repository"
import type { ResumeRepository } from "../ports/resume-repository"
import type { TailorOperationRepository } from "../ports/tailor-operation-repository"
import type { AutofillNotesService } from "./autofill-notes-service"
import type { AutofillProfileService } from "./autofill-profile-service"
import type { RunService } from "./run-service"
import type { VersionService } from "./version-service"

/** How many recent origin links the company rule looks through. */
const ORIGINS_SCANNED = 50

export type AutofillDeps = {
  resumes: ResumeRepository
  versions: VersionService
  runs: RunService
  jobTargets: JobTargetRepository
  operations: TailorOperationRepository
  profiles: AutofillProfileService
  notes: AutofillNotesService
  applications: AutofillApplicationRepository
  models: AutofillModels
  clock: () => Date
}

type Chosen = { record: ResumeRecord; choice: ResumeChoice }

/**
 * The server side of an autofill session: the free `plan` and `start`, and
 * the metered AI calls that follow them.
 */
export class AutofillService {
  constructor(private readonly deps: AutofillDeps) {}

  /**
   * Rule fills, the default resume and its job, the earlier fill, missing
   * Profile answers and the quota. Free, so it records no run (spec 13).
   */
  async plan(input: PlanInput): Promise<PlanResult> {
    const { page } = input
    const chosen = await this.chooseResume(input)
    const record = chosen?.record ?? null
    const origin = record
      ? await this.deps.jobTargets.findOrigin(record.id)
      : null
    const job = origin ? { company: origin.company, title: origin.title } : null
    const { profile } = await this.deps.profiles.get()
    const rules = ruleFills(input.fields, {
      vendor: page.vendor,
      profile,
      resume: record?.data ?? null,
      linkedin: input.linkedin !== null,
      today: this.deps.clock(),
    })
    const earlier = await this.deps.applications.find(
      page.vendor,
      page.postingKey
    )
    return {
      resumeId: record?.id ?? null,
      resumeChoice: chosen?.choice ?? null,
      job,
      jobMatch: jobMatch(job, page),
      fills: rules.fills,
      overwrites: rules.overwrites,
      classes: rules.classes,
      earlier: earlier
        ? { at: earlier.updatedAt, resumeTitle: earlier.resumeTitle }
        : null,
      missing: missingAnswers(profile, record?.data.basics ?? null),
      quota: await this.deps.runs.quotaStatus("autofill"),
    }
  }

  /**
   * Snapshots the resume the session fills with and records the application
   * (spec 14.4). The snapshot dedupes against the current version, so
   * starting again with an unchanged resume makes no new version.
   */
  async start(input: StartInput): Promise<StartResult> {
    const { page } = input
    const named = [page.company, page.title].filter(Boolean).join(" · ")
    const { version, resume } = await this.deps.versions.snapshotHead(
      input.resumeId,
      { label: `Autofill: ${named || "application"}`, createdBy: "system" }
    )
    // The job target is kept only when its description reaches AI.
    const origin = input.useJob
      ? await this.deps.jobTargets.findOrigin(resume.id)
      : null
    const { id } = await this.deps.applications.upsert({
      vendor: page.vendor,
      postingKey: page.postingKey,
      orgSlug: page.postingKey.split(":")[1] || null,
      url: page.url,
      company: page.company,
      title: page.title,
      resumeId: resume.id,
      resumeVersionId: version.id,
      jobTargetId: origin?.id ?? null,
    })
    return {
      applicationId: id,
      versionId: version.id,
      fileName: resumeFileName(resume.data.basics.name),
      document: {
        data: resume.data,
        templateId: resume.templateId,
        templateOptions: resume.templateOptions,
      },
    }
  }

  /**
   * The user's pick while it exists, else the first default rule (spec 6.2)
   * whose resume still exists.
   */
  private async chooseResume(input: PlanInput): Promise<Chosen | null> {
    if (input.resumeId) {
      const record = await this.deps.resumes.findById(input.resumeId)
      if (record) return { record, choice: "user" }
    }
    const rules: [ResumeChoice, () => Promise<string | null>][] = [
      ["linkedin", () => this.linkedinResume(input.linkedin)],
      ["company", () => this.companyResume(input.page)],
      ["last", () => this.deps.applications.latestResumeId()],
      ["recent", () => this.recentResume()],
    ]
    for (const [choice, find] of rules) {
      const id = await find()
      const record = id ? await this.deps.resumes.findById(id) : null
      if (record) return { record, choice }
    }
    return null
  }

  private async linkedinResume(
    identity: JobIdentity | null
  ): Promise<string | null> {
    if (!identity) return null
    const found = await this.deps.operations.lookup(identity)
    return found.kind === "bound" ? found.resumeId : null
  }

  /** The newest resume tailored for the page's company; never a weak guess. */
  private async companyResume(page: AutofillPage): Promise<string | null> {
    const company = page.companyWeak ? null : page.company
    if (!company) return null
    const origins = await this.deps.jobTargets.listOrigins(ORIGINS_SCANNED)
    return (
      origins.find((row) => companiesMatch(row.company, company))?.resumeId ??
      null
    )
  }

  private async recentResume(): Promise<string | null> {
    return (await this.deps.resumes.page({})).items[0]?.id ?? null
  }
}

/** A weak or unknown page company cannot contradict the job (spec 6.3). */
function jobMatch(job: JobBrief | null, page: AutofillPage): JobMatch {
  if (!job) return "none"
  if (!page.company || page.companyWeak) return "unknown"
  return companiesMatch(job.company, page.company) ? "match" : "mismatch"
}
