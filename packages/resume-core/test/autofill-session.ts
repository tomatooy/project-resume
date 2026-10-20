import type { Control, FieldDescriptor } from "@workspace/autofill"

import type { AutofillModels, AutofillPage } from "../src"
import { stubAutofillModels } from "../src/testing/index"
import { harness } from "./harness"

export const PAGE: AutofillPage = {
  vendor: "greenhouse",
  postingKey: "greenhouse:stripe:7206421",
  url: "https://job-boards.greenhouse.io/stripe/jobs/7206421",
  company: "Stripe",
  companyWeak: false,
  title: "Software Engineer",
}

export const COUNTS = { fields: 9, rules: 4, ai: 0, asked: 0, drafted: 0 }
export const USAGE = { inputTokens: 10, outputTokens: 5 }

export function field(
  id: string,
  label: string,
  control: Control = "text",
  extra: Partial<FieldDescriptor> = {}
): FieldDescriptor {
  return { id, label, control, required: true, hasValue: false, ...extra }
}

export const YES_NO = [
  { id: "#1", label: "Yes" },
  { id: "#2", label: "No" },
]

/** A harness with a started session whose models are the stub with `models`. */
export async function session(models: Partial<AutofillModels> = {}) {
  const h = harness()
  h.autofillModels = stubAutofillModels(models)
  const resume = await h.resumeService.create({ title: "Base" })
  const { applicationId } = await h.autofillService.start({
    page: PAGE,
    resumeId: resume.id,
    useJob: false,
  })
  return { h, resumeId: resume.id, applicationId }
}

export type Session = Awaited<ReturnType<typeof session>>

export const failing = async (): Promise<never> => {
  throw new Error("Model unavailable")
}

/** Waits for its signal, then rejects with its reason, as a fetch does. */
export function hang<T>(input: { signal: AbortSignal }): Promise<T> {
  return new Promise((_, reject) => {
    input.signal.addEventListener("abort", () => reject(input.signal.reason))
  })
}

/** Never settles, whatever its signal does. */
export function stall<T>(): Promise<T> {
  return new Promise(() => undefined)
}

/** Resolves with `value` after `ms` on the test clock. */
export function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** Gives the session's resume an origin job and returns it. */
export async function originJob(s: Session) {
  const target = await s.h.jobTargets.create({
    platform: null,
    externalJobId: null,
    sourceUrl: null,
    rawText: "Stripe builds the economic infrastructure of the internet.",
    title: "Software Engineer",
    company: "Stripe",
    location: null,
    requirements: { mustHaves: ["TypeScript"], niceToHaves: [], keywords: [] },
  })
  await s.h.jobTargets.link({
    resumeId: s.resumeId,
    jobTargetId: target.id,
    isOrigin: true,
  })
  return target
}

/** Spends the hour's 60 autofill runs. */
export async function exhaust(s: Session): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await s.h.runService.startAutofill({
      resumeId: s.resumeId,
      procedure: "autofill.infer",
      model: "stub-model",
    })
  }
}
