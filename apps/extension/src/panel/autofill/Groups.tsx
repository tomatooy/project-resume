import { useState } from "react"
import type { ProfileSection } from "@workspace/autofill/fields"
import { Button } from "@workspace/ui/components/button"
import { groupTitle, SET_IN_PROFILE } from "../../lib/autofill-copy"
import type {
  AutofillAction,
  AutofillGroup,
  AutofillView,
  Item,
} from "../../lib/autofill-view"

const ORDER: AutofillGroup[] = ["page", "write", "ai", "filled", "already"]
/** These list their fields; the others expand on request (spec 6.1). */
const LISTED: ReadonlySet<AutofillGroup> = new Set(["page", "write"])

type Props = {
  groups: AutofillView["groups"]
  disabled: boolean
  onAction: (action: AutofillAction) => void
  onOpenProfile: (section: ProfileSection) => void
}

/** The run's fields in spec order (6.4); clicking one focuses it on the page. */
export function Groups(props: Props) {
  const shown = ORDER.filter((group) => props.groups[group].length > 0)
  if (shown.length === 0) return null
  return (
    <div className="space-y-3">
      {shown.map((group) => (
        <Group
          key={group}
          group={group}
          items={props.groups[group]}
          {...props}
        />
      ))}
    </div>
  )
}

function Group({
  group,
  items,
  disabled,
  onAction,
  onOpenProfile,
}: Props & { group: AutofillGroup; items: Item[] }) {
  const listed = LISTED.has(group)
  const [open, setOpen] = useState(listed)
  const title = groupTitle(group, items.length)
  return (
    <section className="space-y-1.5">
      {listed ? (
        <h2 className="font-medium text-sm">{title}</h2>
      ) : (
        <Button
          variant="link"
          size="xs"
          aria-expanded={open}
          className="h-auto p-0 text-foreground text-sm"
          onClick={() => setOpen(!open)}
        >
          {title}
          <span
            aria-hidden="true"
            className={open ? "inline-block rotate-90" : "inline-block"}
          >
            ›
          </span>
        </Button>
      )}
      {open && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.fieldId}
              className="flex items-center justify-between gap-2"
            >
              <Button
                variant="link"
                size="xs"
                className="h-auto min-w-0 justify-start p-0 font-normal text-muted-foreground text-sm hover:text-foreground"
                onClick={() =>
                  onAction({ kind: "focus", fieldId: item.fieldId })
                }
              >
                <span className="truncate">{item.label}</span>
                <span aria-hidden="true">›</span>
              </Button>
              <span className="flex shrink-0 gap-1">
                {group === "page" && item.anchor !== null && (
                  <Button
                    size="xs"
                    variant="link"
                    onClick={() => {
                      if (item.anchor) onOpenProfile(item.anchor)
                    }}
                  >
                    {SET_IN_PROFILE}
                  </Button>
                )}
                {group === "ai" && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      onAction({ kind: "clear", fieldId: item.fieldId })
                    }
                  >
                    Clear
                  </Button>
                )}
                {group === "already" && item.overwrite && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      onAction({ kind: "overwrite", fieldId: item.fieldId })
                    }
                  >
                    Overwrite
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
