import { SortDescendingIcon } from "@phosphor-icons/react"
import { ResumeSortSchema, type ResumeSort } from "@workspace/resume-core"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { IconButton } from "./IconButton"

const LABELS: Record<ResumeSort, string> = {
  updatedAt: "Last edited",
  createdAt: "Created date",
}

export function ResumeViewMenu({
  value,
  onValueChange,
}: {
  value: ResumeSort
  onValueChange: (value: ResumeSort) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton label="View by">
            <SortDescendingIcon weight="bold" />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-40 rounded-md">
        <DropdownMenuRadioGroup
          aria-label="View resumes by"
          value={value}
          onValueChange={(next) => {
            const parsed = ResumeSortSchema.safeParse(next)
            if (parsed.success) onValueChange(parsed.data)
          }}
        >
          {ResumeSortSchema.options.map((sortBy) => (
            <DropdownMenuRadioItem
              key={sortBy}
              value={sortBy}
              closeOnClick
              className="rounded-sm py-1.5 text-[12.5px] data-checked:bg-accent"
            >
              {LABELS[sortBy]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
