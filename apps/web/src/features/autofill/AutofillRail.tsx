import {
  DotsThreeCircleIcon,
  EnvelopeSimpleIcon,
  IdentificationBadgeIcon,
  LinkSimpleIcon,
  NotePencilIcon,
  type Icon,
  SlidersHorizontalIcon,
  UserIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import type { ProfileSection } from "@workspace/autofill"

/**
 * The page's sections, in the order a form asks for them. The anchors are the
 * ones the extension's "Set in Profile" links open, so they are fixed.
 */
export const SECTIONS: readonly { anchor: ProfileSection; title: string }[] = [
  { anchor: "personal", title: "Personal" },
  { anchor: "contact", title: "Contact" },
  { anchor: "links", title: "Links" },
  { anchor: "work-authorization", title: "Work authorization" },
  { anchor: "preferences", title: "Preferences" },
  { anchor: "eeo", title: "EEO" },
  { anchor: "other", title: "Other" },
  { anchor: "notes", title: "Notes" },
]

const ICONS: Record<ProfileSection, Icon> = {
  personal: UserIcon,
  contact: EnvelopeSimpleIcon,
  links: LinkSimpleIcon,
  "work-authorization": IdentificationBadgeIcon,
  preferences: SlidersHorizontalIcon,
  eeo: UsersThreeIcon,
  other: DotsThreeCircleIcon,
  notes: NotePencilIcon,
}

/**
 * The profile's outline, in the rail where the resume list usually is. Each
 * row opens the page at its section, from whichever tab is in front.
 */
export function AutofillRail() {
  return (
    <>
      <div className="flex h-[42px] flex-none items-center px-2.5">
        <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
          Autofill profile
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pb-3">
        {SECTIONS.map(({ anchor, title }) => {
          const Glyph = ICONS[anchor]
          return (
            <Link
              key={anchor}
              to="/autofill"
              hash={anchor}
              className="flex h-[26px] w-full items-center gap-1.5 rounded-[6px] px-2 text-[12.5px] text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Glyph className="size-3.5 flex-none opacity-70" />
              <span className="min-w-0 flex-1 truncate">{title}</span>
            </Link>
          )
        })}
      </div>
    </>
  )
}
