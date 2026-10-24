import { Link } from "@tanstack/react-router"

import { Brand } from "./Brand"
import { RouteIndicator } from "./RouteIndicator"
import { UserMenu } from "./UserMenu"

export function AppHeader({ email }: { email: string }) {
  return (
    <header className="surface-metal relative z-30 flex h-8 flex-none items-center gap-2 border-b bg-card px-3">
      <Link
        to="/dashboard"
        aria-label="VS:Résumé home"
        className="flex shrink-0 items-center"
      >
        <Brand showName={false} logoClassName="size-5" />
      </Link>

      <RouteIndicator />

      <div className="flex shrink-0 items-center">
        <UserMenu email={email} />
      </div>
    </header>
  )
}
