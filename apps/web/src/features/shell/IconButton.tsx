import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import type { ComponentProps } from "react"

/**
 * The icon-only control the rail, the tab strip and the two side panes share:
 * a ghost 24px Button whose tooltip is also its accessible name, so a control
 * cannot end up with one and not the other. Every other Button prop, `ref`,
 * `disabled` and `aria-*` included, passes straight through.
 */
export function IconButton({
  label,
  variant = "ghost",
  size = "icon-xs",
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant={variant} size={size} aria-label={label} {...props}>
            {children}
          </Button>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
