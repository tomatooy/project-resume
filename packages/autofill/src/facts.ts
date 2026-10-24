import type { Resume } from "@workspace/resume-schema"

import { effectiveHistory, type Profile, resumeHistory } from "./profile"

/** Work, education and skill answers shared by the profile and resume. */
export type ResumeFacts = {
  company: string | null
  title: string | null
  school: string | null
  degree: string | null
  major: string | null
  /** YYYY-MM; null while the degree is in progress. */
  graduation: string | null
  years: number | null
  skills: string | null
}

/** Months since year 0 at the start of a YYYY-MM month. */
function monthOf(value: string): number {
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1
}

/**
 * Whole years worked: months covered by any job, each month counted once,
 * none after the current month.
 */
function yearsWorked(
  jobs: readonly { start: string; end: string }[],
  today: Date
): number | null {
  if (jobs.length === 0) return null
  const limit = today.getFullYear() * 12 + today.getMonth() + 1
  const spans = jobs
    .map(({ start, end }): [number, number] => [
      monthOf(start),
      Math.min(end === "present" ? limit : monthOf(end) + 1, limit),
    ])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  let months = 0
  let reached = Number.NEGATIVE_INFINITY
  for (const [start, end] of spans) {
    months += Math.max(0, end - Math.max(start, reached))
    reached = Math.max(reached, end)
  }
  return Math.floor(months / 12)
}

function historyFacts(
  history: Pick<Profile, "experience" | "education" | "skills">,
  today: Date
): ResumeFacts {
  const jobs = history.experience
  const job = jobs[0]
  const school = history.education[0]
  const end = school?.end
  const skills = history.skills.flatMap((group) => group.skills)
  return {
    company: job?.company ?? null,
    title: job?.role ?? null,
    school: school?.school ?? null,
    degree: school?.degree || null,
    major: school?.field || null,
    graduation: end && end !== "present" ? end : null,
    years: yearsWorked(jobs, today),
    skills: skills.length > 0 ? skills.join(", ") : null,
  }
}

export function resumeFacts(resume: Resume, today: Date): ResumeFacts {
  return historyFacts(resumeHistory(resume), today)
}

export function effectiveFacts(
  profile: Profile,
  resume: Resume | null,
  today: Date
): ResumeFacts {
  return historyFacts(effectiveHistory(profile, resume), today)
}
