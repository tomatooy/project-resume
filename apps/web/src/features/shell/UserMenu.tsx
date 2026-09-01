import { ArrowCounterClockwiseIcon, SignOutIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "sonner"

import { resetStore } from "@/lib/api"

function initials(email: string): string {
  const [name = ""] = email.split("@")
  const parts = name.split(/[._-]/).filter(Boolean)
  const letters =
    parts.length > 1 ? [parts[0]?.[0], parts[1]?.[0]] : [name[0], name[1]]
  return letters.filter(Boolean).join("").toUpperCase() || "?"
}

export function UserMenu({ email }: { email: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account"
            className="flex size-[29px] items-center justify-center rounded-full border border-border bg-secondary text-[11.5px] font-semibold text-secondary-foreground transition-colors hover:bg-muted"
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
        <DropdownMenuItem
          onClick={() => {
            resetStore()
            void queryClient.invalidateQueries()
            void router.navigate({ to: "/dashboard" })
            toast.success("Demo data reset")
          }}
        >
          <ArrowCounterClockwiseIcon />
          Reset demo data
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <SignOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
