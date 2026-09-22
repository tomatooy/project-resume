import { cn } from "@workspace/ui/lib/utils"

/**
 * The dot and label a side pane opens its 44px header with. Both panes wear the
 * same strip at the same height, so the dot is the pane marker: it is what
 * tells the row apart from the toolbar the preview puts on the other side of
 * its own header.
 */
export function PaneTitle({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <span className={cn("flex flex-none items-center gap-2.25", className)}>
      <span className="size-1.5 flex-none rounded-full bg-primary" />
      <span className="font-heading text-[12.5px] font-semibold">
        {children}
      </span>
    </span>
  )
}
