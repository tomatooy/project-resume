import { Link } from "@tanstack/react-router"

import { Brand } from "./Brand"
import { UserMenu } from "./UserMenu"

/** The 44px bar across the top of every screen. Matches the preview toolbar. */
export function AppHeader({ email }: { email: string }) {
  return (
    <header className="surface-metal relative z-30 flex h-11 flex-none items-center gap-3 border-b bg-card px-4">
      <Link to="/dashboard" className="flex items-center gap-2">
        <Brand engraved />
      </Link>

      <div className="flex-1" />

      <UserMenu email={email} />
    </header>
  )
}
