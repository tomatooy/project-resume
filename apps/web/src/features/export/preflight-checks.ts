import { templates, type TemplateId } from "@workspace/resume-render"
import type { Resume } from "@workspace/resume-schema"

import { pluralize } from "@/lib/format"
import { documentFlagCount } from "../resume/flags"

export type PreflightCheck = {
  level: "ok" | "warn"
  title: string
  detail: string
}

/**
 * Every check here is computed from the document or the rendered PDF. Nothing
 * is estimated, and there is no overall score, because any single number for
 * "how good is this resume" would be one we cannot defend.
 *
 * The Export screen's panel and the status bar's popover both read this, so a
 * check cannot exist in one and be missing from the other.
 */
export function preflightChecks(input: {
  doc: Resume
  templateId: TemplateId
  pageCount: number | null
  error: string | null
}): PreflightCheck[] {
  const { doc, pageCount, error } = input
  const template = templates[input.templateId]
  const flags = documentFlagCount(doc)
  const emptySections = doc.sections.filter((s) => s.items.length === 0)

  return [
    template.twoColumn
      ? {
          level: "warn",
          title: "Two-column layout",
          detail: `${template.name} puts skills and education in a sidebar. Some parsers read the columns out of order. Lisbon or Plainsong are safer if the posting mentions an ATS.`,
        }
      : {
          level: "ok",
          title: "Single-column layout",
          detail:
            "No tables, text boxes or side-by-side blocks for a parser to misread.",
        },
    {
      level: "ok",
      title: "Fonts embedded as real text",
      detail: `${template.name} embeds its typefaces and the text stays selectable, so a parser reads characters rather than an image.`,
    },
    flags > 0
      ? {
          level: "warn",
          title: `${pluralize(flags, "bullet")} without a number`,
          detail:
            "Export anyway, or fix them in the editor first. Bullets carrying a figure survive a skim; bullets that do not, usually do not.",
        }
      : {
          level: "ok",
          title: "Every bullet carries a figure",
          detail: "Nothing reads as an unmeasured claim.",
        },
    doc.basics.email
      ? {
          level: "ok",
          title: "Reachable",
          detail: `${doc.basics.email}${doc.basics.phone ? ` · ${doc.basics.phone}` : ""}`,
        }
      : {
          level: "warn",
          title: "No email address",
          detail:
            "Add one in Contact. A resume with no way to reply is a dead end.",
        },
    pageCount
      ? {
          level: pageCount <= 2 ? "ok" : "warn",
          title: `${pluralize(pageCount, "page")} at the current settings`,
          detail:
            pageCount <= 2
              ? "Within the length most reviewers will read."
              : "Past two pages, later pages are rarely read. Try the Ledger template or cut the oldest role.",
        }
      : {
          level: "warn",
          title: "Page count not measured yet",
          detail:
            "Open the editor with the preview panel on to render the document.",
        },
    ...(emptySections.length > 0
      ? [
          {
            level: "warn" as const,
            title: pluralize(emptySections.length, "empty section"),
            detail: `${emptySections.map((s) => s.title).join(", ")} will not appear on the page. Fill or remove ${emptySections.length === 1 ? "it" : "them"}.`,
          },
        ]
      : []),
    ...(error
      ? [
          {
            level: "warn" as const,
            title: "The last render failed",
            detail: error,
          },
        ]
      : []),
  ]
}

/** What the status bar's triangle counts: the checks that want attention. */
export function preflightWarnCount(checks: PreflightCheck[]): number {
  return checks.filter((check) => check.level === "warn").length
}
