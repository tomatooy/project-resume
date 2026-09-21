import { BooksIcon, SignOutIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

function initials(email: string): string {
  const [name = ""] = email.split("@")
  const parts = name.split(/[._-]/).filter(Boolean)
  const letters =
    parts.length > 1 ? [parts[0]?.[0], parts[1]?.[0]] : [name[0], name[1]]
  return letters.filter(Boolean).join("").toUpperCase() || "?"
}

export function UserMenu({ email }: { email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account"
            className="flex size-[26px] items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-semibold text-secondary-foreground transition-colors hover:bg-muted"
          >
            {initials(email)}
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/skills" />}>
          <BooksIcon />
          Skills
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
          A real form POST rather than a fetch. Signing out has to be a POST so
          a prefetched link cannot end the session, and letting the browser
          navigate is what guarantees every cached query and open editor session
          is gone rather than left holding the previous user's document.
        */}
        <form method="post" action="/logout">
          <DropdownMenuItem
            render={<button type="submit" className="w-full" />}
          >
            <SignOutIcon />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
