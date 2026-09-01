import { breadcrumb, type Resume } from "@workspace/resume-schema"

/** Safe wrapper: an id that has been deleted returns an empty label, not a throw. */
export function breadcrumbOf(resume: Resume, nodeId: string | null): string {
  if (!nodeId) return ""
  try {
    return breadcrumb(resume, nodeId)
  } catch {
    return ""
  }
}
