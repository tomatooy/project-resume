import { Link } from "@tanstack/react-router"

import { UserMenu } from "./UserMenu"

/** The 44px bar across the top of every screen. Matches the preview toolbar. */
export function AppHeader({ email }: { email: string }) {
  return (
    <header className="relative z-30 flex h-11 flex-none items-center gap-3 border-b border-border bg-paper px-4">
      <Link to="/dashboard" className="flex items-center gap-2">
        <span className="flex size-[22px] items-center justify-center rounded-[6px] bg-primary font-heading text-[12px] font-bold text-primary-foreground">
          R
        </span>
        <span className="font-heading text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">
          Résumé Studio
        </span>
      </Link>

      <div className="flex-1" />

      <UserMenu email={email} />
    </header>
  )
}
