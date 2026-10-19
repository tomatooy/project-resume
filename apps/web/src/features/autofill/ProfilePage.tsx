import { useQuery } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useEffect } from "react"

import { ResourceFailure } from "@/features/workspace/ResourceFailure"
import { useTabScroll } from "@/features/workspace/use-tab-scroll"
import { autofillNotesQuery, autofillProfileQuery } from "@/lib/queries"
import { ImportFromResume } from "./ImportFromResume"
import { PageSection, ProfileForm } from "./sections"

/**
 * The Autofill profile: the answers the extension fills into job
 * applications, one section per part of a form, then the Notes.
 *
 * Every section is an anchor that the rail and the extension's "Set in
 * Profile" links open. The sections only exist once the data is in, and
 * before the first save only Notes does, so the page scrolls to the hash
 * itself each time more of it is drawn, rather than leaving it to the router,
 * which looks for the anchor before it is drawn.
 */
export function ProfilePage() {
  const scroll = useTabScroll("autofill")
  const profile = useQuery(autofillProfileQuery())
  const notes = useQuery(autofillNotesQuery())
  const hash = useLocation({ select: (location) => location.hash })
  const state = profile.data
  // Drawn once there is data, so a failed refetch keeps the form in place.
  const drawn = !state || !notes.data ? null : state.exists ? "all" : "notes"

  useEffect(() => {
    if (drawn && hash) document.getElementById(hash)?.scrollIntoView()
  }, [drawn, hash])

  const error = profile.error ?? notes.error
  if (error && !drawn)
    return (
      <ResourceFailure
        error={error}
        reset={() => {
          void profile.refetch()
          void notes.refetch()
        }}
      />
    )

  return (
    <div ref={scroll} className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[720px] px-[26px] pt-[26px] pb-[110px]">
        <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
          Autofill profile
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[12.5px] text-muted-foreground">
          The answers the browser extension fills into job applications.
        </p>

        {state && notes.data ? (
          <>
            {state.exists ? (
              <ProfileForm state={state} />
            ) : (
              <ImportFromResume />
            )}
            <PageSection anchor="notes" title="Notes" />
          </>
        ) : (
          <div className="mt-7 flex flex-col gap-3">
            <Skeleton className="h-[120px] rounded-[10px]" />
            <Skeleton className="h-[120px] rounded-[10px]" />
          </div>
        )}
      </div>
    </div>
  )
}
