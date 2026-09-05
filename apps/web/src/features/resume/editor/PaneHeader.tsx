import type { ReactNode } from "react"

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
  return (
    <header className="mb-4.5">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-[17px] font-semibold tracking-[-0.015em]">
          {title}
        </h2>
        {meta ? (
          <span className="text-[11.5px] text-muted-foreground">{meta}</span>
        ) : null}
        <div className="flex-1" />
        {actions}
      </div>
      {hint ? (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </header>
  )
}
