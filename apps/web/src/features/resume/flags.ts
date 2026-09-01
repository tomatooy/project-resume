import { hasBullets, type Resume, type Section } from "@workspace/resume-schema"

/**
 * The one automated judgement the console makes about a resume: a bullet with
 * no number in it has no measurable outcome. This is deliberately the whole of
 * it. Anything resembling a score would be a number we cannot justify.
 */
const HAS_NUMBER = /\d/

export function bulletNeedsMetric(text: string): boolean {
  return text.trim().length > 0 && !HAS_NUMBER.test(text)
}

export function sectionFlagCount(section: Section): number {
  return section.items.reduce((count, item) => {
    if (!hasBullets(item)) return count
    return count + item.bullets.filter((b) => bulletNeedsMetric(b.text)).length
  }, 0)
}

export function documentFlagCount(resume: Resume): number {
  return resume.sections.reduce((total, s) => total + sectionFlagCount(s), 0)
}

export function itemFlagCount(
  item: Resume["sections"][number]["items"][number]
): number {
  if (!hasBullets(item)) return 0
  return item.bullets.filter((b) => bulletNeedsMetric(b.text)).length
}
