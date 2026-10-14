import { z } from "zod"
import {
  ResumeSchema,
  canonicalJson,
  contentHash,
  type Resume,
} from "@workspace/resume-schema"
import {
  ProfileUpdateSchema,
  type AutofillProfile,
} from "../autofill-profile/schema"
import { countryName } from "../autofill-profile/countries"
import type { AutofillProfileService } from "../autofill-profile/service"
import type { ScopedAnswer } from "../autofill/contract"
import { AppError } from "../domain/errors"
import type { ResumeRepository } from "../ports/resume-repository"
import type { VersionRepository } from "../ports/version-repository"
import { fingerprint } from "./fingerprint"
import type { ScopeEntry } from "./primitives"
import {
  ReviewAnswerSchema,
  StoredAnswerSchema,
  answerDestination,
  profileFieldValue,
  reviewFromStoredAnswer,
  type AnswerDestination,
  type DestinationChoice,
  type ProfileTarget,
  type ReviewAnswer,
} from "./saved-answer"
import {
  RenderConfigSchema,
  SourceBundleSchema,
  pdfIdentity,
  sourceBundleId,
  type Fact,
  type FactValue,
  type RenderConfig,
  type SourceVersion,
} from "./source"
import { factFromSavedAnswer } from "../saved-answers/service"
import { savedAnswersId, type SavedAnswer } from "../saved-answers/schema"

/**
 * Rendering and font asset version. It is part of a PDF's identity, not of the
 * document: the same resume rendered by different template assets is different
 * bytes, and attaching stale bytes is worse than rendering again.
 */
export const RENDER_ASSET_VERSION = "resume-render@1"

export type SourceDeps = {
  resumes: Pick<ResumeRepository, "findById">
  versions: Pick<VersionRepository, "findById">
  profiles: Pick<AutofillProfileService, "get" | "update">
  /** Rows in the retired concept vocabulary, read into facts where they can be. */
  answers: { list(): Promise<ScopedAnswer[]> }
  /** Rows in the question's own identity-first shape. */
  savedAnswers: { list(): Promise<SavedAnswer[]> }
  renderVersion?: string
}

/**
 * What a page run asks for. It names ids only: a caller cannot send its own
 * sources, facts or hash, so nothing a client writes can become authority.
 */
export const PrepareSourcesInputSchema = z.strictObject({
  resumeId: z.uuid(),
  versionId: z.uuid().nullable().optional(),
  /**
   * The bundle the caller believes it holds, as an integrity and staleness
   * check. A client-provided hash is never an authorization grant, and a match
   * never means the server echoes the client's copy: every field below is
   * derived here from the stores.
   */
  expectedBundleId: z.string().min(1).max(64).nullable().optional(),
})

export const SourcePreparationSchema = z.strictObject({
  bundle: SourceBundleSchema,
  /** Stored answers without a question identity, for the user to resolve. */
  review: z.array(ReviewAnswerSchema).max(500),
})
export type SourcePreparation = z.infer<typeof SourcePreparationSchema>

export const PdfDocumentInputSchema = z.strictObject({
  resumeId: z.uuid(),
  versionId: z.uuid().nullable().optional(),
  /** The pinned bundle this PDF belongs to. Also a check, never a grant. */
  bundleId: z.string().min(1).max(64),
})

export const PdfDocumentSchema = z.strictObject({
  bundleId: z.string().min(1).max(64),
  /** Resume content, template, options, locale and render assets together. */
  pdfId: z.string().min(1).max(64),
  resume: ResumeSchema,
  render: RenderConfigSchema,
})
export type PdfDocument = z.infer<typeof PdfDocumentSchema>

/**
 * Load and fix the sources one application is answered from.
 *
 * The bundle is derived, never carried: every caller that names the same source
 * revisions gets the same bundle, and a later edit in the main app produces a
 * different one instead of changing a bundle a run already holds. Pinning is
 * the caller's job: the extension keeps the bundle it was handed for the life
 * of the application, and only an explicit source change asks for another.
 */
export class SourceService {
  constructor(private readonly deps: SourceDeps) {}

  async prepare(raw: unknown): Promise<SourcePreparation> {
    const input = PrepareSourcesInputSchema.safeParse(raw)
    if (!input.success)
      throw new AppError("VALIDATION", "Choose a resume to fill from")
    const { resumeId, versionId } = input.data
    const resume = await this.resume(resumeId)
    const doc = await this.document_(resume, versionId ?? null)
    const profile = await this.deps.profiles.get()
    const stored = await this.storedAnswers()
    const kept = await this.savedAnswers()

    const review: ReviewAnswer[] = []
    const facts = [
      ...resumeFacts(doc, resumeId, versionId ?? null),
      ...profileFacts(profile),
    ]
    // Every legacy row is a review, so nothing here adds a fact. The reader
    // says why at its own doc comment.
    for (const row of stored)
      review.push(reviewFromStoredAnswer(StoredAnswerSchema.parse(row)))
    // Both readers feed one bundle and one review list: a row in the concept
    // vocabulary and a row in the question's own shape are answered from the
    // same facts, and a row either reader refuses stays visible to the user.
    for (const answer of kept) {
      const outcome = factFromSavedAnswer(answer)
      if (outcome.kind === "fact") facts.push(outcome.fact)
      else review.push(outcome.answer)
    }

    const sources = await this.contributingSources(
      resume,
      doc,
      profile,
      stored,
      kept,
      versionId ?? null
    )
    const id = sourceBundleId(sources)
    if (input.data.expectedBundleId && input.data.expectedBundleId !== id)
      throw new AppError(
        "CONFLICT",
        "Sources changed. Reload before filling.",
        undefined,
        undefined,
        "source_changed"
      )
    return SourcePreparationSchema.parse({
      bundle: {
        id,
        resumeId,
        resumeVersionId: versionId ?? null,
        sources,
        facts: facts.slice(0, 400),
        render: this.renderConfig(resume),
      },
      review,
    })
  }

  /**
   * The document a PDF is rendered from, pinned to one bundle. The identity
   * covers the template, its options, the locale and the render assets, which
   * the retired source stamp did not.
   */
  async document(raw: unknown): Promise<PdfDocument> {
    const input = PdfDocumentInputSchema.safeParse(raw)
    if (!input.success) throw new AppError("VALIDATION", "Invalid PDF request")
    const resume = await this.resume(input.data.resumeId)
    const versionId = input.data.versionId ?? null
    const doc = await this.document_(resume, versionId)
    const profile = await this.deps.profiles.get()
    const stored = await this.storedAnswers()
    const kept = await this.savedAnswers()
    const sources = await this.contributingSources(
      resume,
      doc,
      profile,
      stored,
      kept,
      versionId
    )
    const bundleId = sourceBundleId(sources)
    if (bundleId !== input.data.bundleId)
      throw new AppError(
        "CONFLICT",
        "Sources changed. Render again.",
        undefined,
        undefined,
        "source_changed"
      )
    const render = this.renderConfig(resume)
    return PdfDocumentSchema.parse({
      bundleId,
      pdfId: pdfIdentity(bundleId, render),
      resume: doc,
      render,
    })
  }

  /**
   * Where a confirmed answer is kept. Applying the choice is separate from
   * making it, so the panel can show a destination before anything is written.
   */
  destination(choice: DestinationChoice = {}): AnswerDestination {
    return answerDestination(choice)
  }

  /**
   * Save one answer into the Profile, which requires a field the Profile
   * actually declares. Written through the same revision compare-and-swap as
   * every other Profile change; the caller's revision is a concurrency token,
   * not a permission.
   */
  async saveToProfile(input: {
    target: ProfileTarget
    value: FactValue
    expectedRevision: number
  }): Promise<AutofillProfile> {
    const profile = await this.deps.profiles.get()
    if (input.target.kind === "salary") return this.saveSalary(profile, input)
    const data = {
      ...profile.data[input.target.section],
      ...profileFieldValue(input.value, {
        section: input.target.section,
        field: input.target.field,
      }),
    }
    // The Profile schema is the authority on what a field may hold, so the
    // write is validated here rather than coerced into place.
    const update = ProfileUpdateSchema.safeParse({
      expectedRevision: input.expectedRevision,
      section: input.target.section,
      data,
    })
    if (!update.success)
      throw new AppError(
        "VALIDATION",
        "That Profile field cannot hold this answer"
      )
    return this.deps.profiles.update(update.data)
  }

  private async saveSalary(
    profile: AutofillProfile,
    input: { value: FactValue; expectedRevision: number }
  ): Promise<AutofillProfile> {
    if (input.value.type !== "money")
      throw new AppError(
        "VALIDATION",
        "Profile salary keeps an amount, a currency and a period together"
      )
    return this.deps.profiles.update({
      expectedRevision: input.expectedRevision,
      section: "preferences",
      data: {
        ...profile.data.preferences,
        salaryAmount: input.value.amount,
        salaryCurrency: input.value.currency,
        salaryPeriod: input.value.period,
      },
    })
  }

  private renderConfig(resume: ResumeRecord): RenderConfig {
    return {
      templateId: resume.templateId,
      templateOptions: resume.templateOptions,
      locale: null,
      renderVersion: this.deps.renderVersion ?? RENDER_ASSET_VERSION,
    }
  }

  /** Every input that can change an answer, so a bundle is identifiable. */
  private async contributingSources(
    resume: ResumeRecord,
    doc: Resume,
    profile: AutofillProfile,
    answers: ScopedAnswer[],
    savedAnswers: SavedAnswer[],
    versionId: string | null
  ): Promise<SourceVersion[]> {
    return [
      {
        kind: "resume",
        id: versionId ?? resume.id,
        revision: versionId ? 0 : resume.revision,
        contentHash: await contentHash(doc),
      },
      {
        kind: "profile",
        id: "profile",
        revision: profile.revision,
        contentHash: valueHash(profile.data),
      },
      {
        kind: "saved_answers",
        id: "saved_answers",
        revision: Math.max(
          highestRevision(answers),
          highestRevision(savedAnswers)
        ),
        // Both shapes of stored answer belong to this one identity, including
        // a row the reader refuses: the set the account keeps is what the
        // bundle was derived from. The identity-first half hashes by its own
        // keys, so the hash does not depend on the order a query returned.
        contentHash: valueHash({
          legacy: answers,
          identity: savedAnswersId(savedAnswers),
        }),
      },
    ]
  }

  private async resume(resumeId: string): Promise<ResumeRecord> {
    const record = await this.deps.resumes.findById(resumeId)
    if (!record) throw new AppError("NOT_FOUND", "Source unavailable")
    return record
  }

  private async document_(
    resume: ResumeRecord,
    versionId: string | null
  ): Promise<Resume> {
    if (!versionId) return resume.data
    const version = await this.deps.versions.findById(versionId)
    if (!version || version.resumeId !== resume.id)
      throw new AppError("NOT_FOUND", "Source unavailable")
    return version.content
  }

  private async storedAnswers(): Promise<ScopedAnswer[]> {
    return this.deps.answers.list()
  }

  private async savedAnswers(): Promise<SavedAnswer[]> {
    return this.deps.savedAnswers.list()
  }
}

type ResumeRecord = NonNullable<
  Awaited<ReturnType<ResumeRepository["findById"]>>
>

/** Highest revision in a set of rows, so one identity covers both shapes. */
function highestRevision(rows: readonly { revision: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.revision), 0)
}

/** Stable hash of a stored value, so an unchanged source keeps its identity. */
function valueHash(value: unknown): string {
  return fingerprint(canonicalJson(value))
}

const resumeOrigin = (resumeId: string, versionId: string | null) => ({
  kind: "resume" as const,
  resumeId,
  versionId,
})

const text = (text: string): FactValue => ({ type: "text", text })

function dateValue(value: string): FactValue | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim())
  if (!match?.[1] || !match[2]) return null
  return {
    type: "date",
    year: Number(match[1]),
    month: Number(match[2]),
    day: match[3] ? Number(match[3]) : null,
  }
}

function answer(value: string): FactValue | null {
  if (value === "yes" || value === "no" || value === "unknown")
    return { type: "boolean", state: value }
  return null
}

/** `FactSchema.display` stops here, so a longer value is previewed instead. */
const DISPLAY_LIMIT = 500

/**
 * The display a fact shows when its source text may run past the limit.
 *
 * A display is a preview and the value carries the whole text, so cutting here
 * costs nothing a reader or the model needs: the document allows a summary to
 * run to 2000 characters and a Profile link to 2000, while a display stops at
 * 500, and one long source must not fail the bundle every other source is read
 * into. This is not the saved-answer rule: this is the person's own resume
 * being previewed into a bundle, not a stored answer of theirs being changed.
 */
function preview(text: string): string {
  return text.slice(0, DISPLAY_LIMIT)
}

/**
 * The resume's own text as facts. Reading it authorizes no edit. Module-private:
 * the service composes facts, and nothing outside this file consumes them
 * separately.
 */
function resumeFacts(
  doc: Resume,
  resumeId: string,
  versionId: string | null
): Fact[] {
  const facts: Fact[] = []
  const source = resumeOrigin(resumeId, versionId)
  const basics: [string, string, string | undefined][] = [
    ["display name", "name", doc.basics.name],
    ["email address", "email", doc.basics.email],
    ["phone number", "phone", doc.basics.phone],
    ["summary", "summary", doc.basics.summary],
  ]
  for (const [meaning, field, value] of basics) {
    if (!value?.trim()) continue
    facts.push({
      id: `resume:basics.${field}`,
      meaning,
      display: preview(value),
      value: text(value),
      scope: [],
      source: { ...source, nodeId: "basics", field },
    })
  }
  for (const link of doc.basics.links) {
    const kind = linkKind(link.url, link.label)
    if (!kind) continue
    facts.push({
      id: `resume:link.${link.id}`,
      meaning: kind,
      display: link.url,
      value: text(link.url),
      scope: [],
      source: { ...source, nodeId: link.id, field: "url" },
    })
  }
  for (const item of doc.sections.flatMap((section) => section.items)) {
    if (item.kind !== "experience" && item.kind !== "education") continue
    const fields: [string, string, string | undefined][] =
      item.kind === "experience"
        ? [
            ["employer name", "company", item.company],
            ["job title", "role", item.role],
            ["start date", "start", item.start],
            ["end date", "end", item.end],
          ]
        : [
            ["school name", "school", item.school],
            ["degree", "degree", item.degree],
            ["field of study", "field", item.field],
            ["start date", "start", item.start],
            ["end date", "end", item.end],
          ]
    for (const [meaning, field, value] of fields) {
      const converted =
        field.startsWith("start") || field === "end"
          ? value
            ? dateValue(value)
            : null
          : value?.trim()
            ? text(value)
            : null
      if (!converted) continue
      facts.push({
        id: `resume:${item.id}.${field}`,
        meaning,
        display: value ?? "",
        value: converted,
        scope: [{ dimension: "record", value: item.id }],
        source: { ...source, nodeId: item.id, field },
      })
    }
  }
  return facts
}

function linkKind(url: string, label: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase()
    if (host === "linkedin.com" && parsed.pathname.startsWith("/in/"))
      return "LinkedIn profile"
    if (host === "github.com") return "GitHub profile"
    const name = label.trim().toLowerCase()
    if (name === "portfolio") return "portfolio URL"
    if (name === "website" || name === "personal website") return "website URL"
    return null
  } catch {
    return null
  }
}

/**
 * Facts from the confirmed Profile. EEO is excluded outright: a confirmed EEO
 * answer is the user's own, so no EEO question may be answered from the bundle,
 * whether by defaulting or from a stored answer.
 */
function profileFacts(profile: AutofillProfile): Fact[] {
  const facts: Fact[] = []
  const data = profile.data
  const add = (
    id: string,
    meaning: string,
    field: string,
    value: FactValue,
    display: string,
    scope: ScopeEntry[] = [],
    section = id.split(".")[0] ?? "profile"
  ) => {
    facts.push({
      id: `profile:${id}`,
      meaning,
      display,
      value,
      scope,
      source: { kind: "profile", section, field },
    })
  }
  const simple: [string, string, string][] = [
    ["display name", "identity.displayName", data.identity.displayName ?? ""],
    ["email address", "identity.email", data.identity.email ?? ""],
    ["phone number", "identity.phone", data.identity.phone ?? ""],
    [
      "legal given name",
      "identity.legalGivenName",
      data.identity.legalGivenName,
    ],
    [
      "legal middle name",
      "identity.legalMiddleName",
      data.identity.legalMiddleName,
    ],
    [
      "legal family name",
      "identity.legalFamilyName",
      data.identity.legalFamilyName,
    ],
    ["preferred name", "identity.preferredName", data.identity.preferredName],
    ["LinkedIn profile", "links.linkedinUrl", data.links.linkedinUrl],
    ["GitHub profile", "links.githubUrl", data.links.githubUrl],
    ["portfolio URL", "links.portfolioUrl", data.links.portfolioUrl],
    ["website URL", "links.websiteUrl", data.links.websiteUrl],
    ["address line 1", "address.addressLine1", data.address.addressLine1],
    ["address line 2", "address.addressLine2", data.address.addressLine2],
    ["city", "address.city", data.address.city],
    [
      "state or region",
      "address.administrativeArea",
      data.address.administrativeArea,
    ],
    ["postal code", "address.postalCode", data.address.postalCode],
  ]
  for (const [meaning, key, value] of simple) {
    if (!value.trim()) continue
    // The four link URLs are the reason this previews: the Profile allows them
    // to run to 2000 characters where a display stops at 500.
    add(key, meaning, key.split(".")[1] ?? key, text(value), preview(value))
  }
  if (data.address.countryCode)
    add(
      "address.countryCode",
      "country",
      "countryCode",
      text(data.address.countryCode),
      countryName(data.address.countryCode),
      [{ dimension: "country", value: data.address.countryCode }]
    )
  for (const row of data.workAuthorization) {
    const scope: ScopeEntry[] = [
      { dimension: "country", value: row.countryCode },
    ]
    const rows: [string, string, string][] = [
      [
        "workAuthorization.authorizedToWork",
        "work authorized in",
        row.authorizedToWork,
      ],
      [
        "workAuthorization.requiresSponsorshipNow",
        "needs sponsorship now in",
        row.requiresSponsorshipNow,
      ],
      [
        "workAuthorization.requiresSponsorshipFuture",
        "needs future sponsorship in",
        row.requiresSponsorshipFuture,
      ],
    ]
    for (const [field, meaning, raw] of rows) {
      const converted = answer(String(raw))
      if (!converted) continue
      add(
        `${field}.${row.countryCode}`,
        `${meaning} ${countryName(row.countryCode)}`,
        field.split(".")[1] ?? field,
        converted,
        String(raw),
        scope,
        "workAuthorization"
      )
    }
  }
  if (data.preferences.availableFrom)
    add(
      "preferences.availableFrom",
      "available from",
      "availableFrom",
      dateValue(data.preferences.availableFrom) ??
        text(data.preferences.availableFrom),
      data.preferences.availableFrom,
      data.preferences.countryCode
        ? [{ dimension: "country", value: data.preferences.countryCode }]
        : [],
      "preferences"
    )
  const relocate = answer(data.preferences.willingToRelocate)
  if (relocate && data.preferences.willingToRelocate !== "unknown")
    add(
      "preferences.willingToRelocate",
      "willing to relocate",
      "willingToRelocate",
      relocate,
      data.preferences.willingToRelocate,
      data.preferences.countryCode
        ? [{ dimension: "country", value: data.preferences.countryCode }]
        : [],
      "preferences"
    )
  const { salaryAmount, salaryCurrency, salaryPeriod } = data.preferences
  if (salaryAmount !== null && salaryCurrency && salaryPeriod !== "unknown")
    add(
      "preferences.salary",
      "salary expectation",
      "salaryAmount",
      {
        type: "money",
        amount: salaryAmount,
        currency: salaryCurrency,
        period: salaryPeriod,
      },
      `${salaryAmount} ${salaryCurrency} / ${salaryPeriod}`,
      data.preferences.countryCode
        ? [{ dimension: "country", value: data.preferences.countryCode }]
        : [],
      "preferences"
    )
  return facts
}
