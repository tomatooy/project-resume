import { cn } from "@workspace/ui/lib/utils"
import { useId } from "react"

export function Brand({
  className,
  engraved = false,
}: {
  className?: string
  engraved?: boolean
}) {
  const engravingId = useId()

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-heading text-[13.5px] font-semibold tracking-[-0.01em] text-foreground",
        className
      )}
    >
      <img
        src="/logo.webp"
        alt=""
        width={192}
        height={192}
        className="size-6 shrink-0 object-contain"
      />
      {engraved ? (
        <svg
          aria-hidden="true"
          focusable="false"
          width="0"
          height="0"
          className="absolute text-foreground dark:text-background"
        >
          <defs>
            <filter id={engravingId} colorInterpolationFilters="sRGB">
              <feGaussianBlur
                in="SourceAlpha"
                stdDeviation="0.4"
                result="blur"
              />
              <feOffset in="blur" dx="0.35" dy="0.7" result="offset" />
              <feComposite
                in="SourceAlpha"
                in2="offset"
                operator="out"
                result="inset"
              />
              <feFlood floodColor="currentColor" floodOpacity="0.35" />
              <feComposite in2="inset" operator="in" />
              <feComposite in2="SourceGraphic" operator="atop" />
            </filter>
          </defs>
        </svg>
      ) : null}
      <span
        className={engraved ? "text-engraved" : undefined}
        style={engraved ? { filter: `url("#${engravingId}")` } : undefined}
      >
        VS:Résumé
      </span>
    </span>
  )
}
