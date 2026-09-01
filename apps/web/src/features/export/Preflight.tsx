import { templates } from "@workspace/resume-render"
import { cn } from "@workspace/ui/lib/utils"

import { pluralize } from "@/lib/format"
import { documentFlagCount } from "../resume/flags"
import { usePreview } from "../resume/preview/preview-context"
import { useResumeState } from "../resume/session-context"

type Check = { level: "ok" | "warn"; title: string; detail: string }

/**
 * Every check here is computed from the document or the rendered PDF. Nothing
 * is estimated, and there is no overall score, because any single number for
 * "how good is this resume" would be one we cannot defend.
 */
export function Preflight() {
  const doc = useResumeState((s) => s.doc)
  const templateId = useResumeState((s) => s.templateId)
  const pageCount = usePreview((s) => s.pageCount)
  const error = usePreview((s) => s.error)

  const template = templates[templateId]
  const flags = documentFlagCount(doc)
  const emptySections = doc.sections.filter((s) => s.items.length === 0)

  const checks: Check[] = [
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
            title: `${pluralize(emptySections.length, "empty section")}`,
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

  return (
    <div className="rounded-[10px] border border-border bg-paper p-4">
      <div className="mb-3 text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
        Preflight
      </div>
      <div className="flex flex-col gap-3">
        {checks.map((check) => (
          <div key={check.title} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-[5px] size-2 flex-none rounded-full",
                check.level === "warn" ? "bg-flag" : "bg-ok"
              )}
            />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold">{check.title}</div>
              <div className="mt-0.5 text-[11.5px] leading-[1.45] text-pretty text-muted-foreground">
                {check.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
