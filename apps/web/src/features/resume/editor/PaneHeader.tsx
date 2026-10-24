import { CaretDownIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { ReactNode } from "react"

import { useResumeState } from "../session-context"
import { useResumeWorkspace } from "../workspace"

export function PaneHeader({
  title,
  meta,
  hint,
  actions,
}: {
  title: string
  meta?: string
  hint?: string
  actions?: ReactNode
}) {
  const sections = useResumeState((s) => s.doc.sections)
  const { pane, setPane } = useResumeWorkspace()
  const entries = [
    { key: "contact", label: "Contact details" },
    { key: "summary", label: "Professional summary" },
    ...sections.map((section) => ({
      key: section.id,
      label: section.title,
    })),
  ]

  return (
    <header className="mb-4.5">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`editor/${title}, navigate resume sections`}
                  title={`editor/${title}`}
                  className="-ml-1.5 max-w-full justify-start gap-0 rounded-sm px-1.5 font-heading text-[13px]"
                />
              }
            >
              <span className="shrink-0 font-normal text-muted-foreground">
                editor/
              </span>
              <span className="truncate text-foreground">{title}</span>
              <CaretDownIcon
                aria-hidden="true"
                className="ml-1.5 size-3 text-muted-foreground"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 max-w-[calc(100vw-2rem)] rounded-md"
            >
              <DropdownMenuRadioGroup
                aria-label="Resume sections"
                value={pane}
                onValueChange={setPane}
              >
                {entries.map((entry) => (
                  <DropdownMenuRadioItem
                    key={entry.key}
                    value={entry.key}
                    label={entry.label}
                    title={entry.label}
                    closeOnClick
                    className="rounded-sm py-1.5 text-[12.5px] data-checked:bg-accent"
                  >
                    <span className="truncate">{entry.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </h2>
        {meta ? (
          <span className="shrink-0 text-[11.5px] text-muted-foreground">
            {meta}
          </span>
        ) : null}
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {hint ? (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </header>
  )
}
