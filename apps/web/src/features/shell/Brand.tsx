import { cn } from "@workspace/ui/lib/utils"
import { useId } from "react"

export function Brand({
  className,
  logoClassName,
  engraved = false,
  showName = true,
}: {
  className?: string
  logoClassName?: string
  engraved?: boolean
  showName?: boolean
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
        src="/logo.svg"
        alt=""
        width={512}
        height={512}
        className={cn(
          "size-6 shrink-0 object-contain dark:invert",
          logoClassName
        )}
      />
      {engraved && showName ? (
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
      {showName ? (
        <span
          className={engraved ? "text-engraved" : undefined}
          style={engraved ? { filter: `url("#${engravingId}")` } : undefined}
        >
          VS:Résumé
        </span>
      ) : null}
    </span>
  )
}
