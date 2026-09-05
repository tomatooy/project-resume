import { Link, useParams } from "@tanstack/react-router"

import { ModeSwitcher } from "./ModeSwitcher"
import { UserMenu } from "./UserMenu"

/** The 56px bar across the top of every screen. */
export function AppHeader({ email }: { email: string }) {
  // Loose params: the header sits above every screen, and only the ones under
  // /r/$resumeId carry a resume to switch modes on.
  const { resumeId } = useParams({ strict: false })

  return (
    <header className="relative z-30 flex h-14 flex-none items-center gap-4 border-b border-border bg-paper px-[18px]">
      <Link to="/dashboard" className="flex items-center gap-[9px]">
        <span className="flex size-[26px] items-center justify-center rounded-[7px] bg-primary font-heading text-[13px] font-bold text-primary-foreground">
          R
        </span>
        <span className="font-heading text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">
          Résumé Studio
        </span>
      </Link>

      <div className="flex-1" />

      {resumeId ? <ModeSwitcher resumeId={resumeId} /> : null}
      <UserMenu email={email} />
    </header>
  )
}
