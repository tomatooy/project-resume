import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { tailoredLine } from "../../lib/autofill-copy"
import type { Snapshot } from "../../lib/messages"

type Resume = Snapshot["resumes"][number]

/** The resume autofill uses, with each resume's job description (spec 6.2). */
export function ResumePicker({
  value,
  rows,
  more,
  disabled,
  onPick,
}: {
  value: string
  rows: Resume[]
  more: (() => void) | null
  disabled: boolean
  onPick: (resumeId: string) => void
}) {
  const selected = rows.find(({ id }) => id === value)
  return (
    <div className="space-y-1.5">
      <label htmlFor="autofill-resume" className="font-medium text-xs">
        Resume
      </label>
      <Select
        value={value}
        onValueChange={(id) => {
          if (id && id !== value) onPick(id)
        }}
        items={rows.map((row) => ({ value: row.id, label: row.title }))}
      >
        <SelectTrigger
          id="autofill-resume"
          className="w-full"
          disabled={disabled}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {rows.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              <span className="flex flex-col">
                <span>{row.title}</span>
                <span className="text-muted-foreground text-xs">
                  {tailoredLine(row.job)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && <p className="text-xs">{tailoredLine(selected.job)}</p>}
      {more && (
        <Button variant="ghost" size="xs" disabled={disabled} onClick={more}>
          Load more
        </Button>
      )}
    </div>
  )
}
