import { FileTextIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import {
  emptyProfile,
  type Profile,
  profileFromResume,
} from "@workspace/autofill"
import { Button } from "@workspace/ui/components/button"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"

import { LoadMore } from "@/features/shell/LoadMore"
import {
  resumeQuery,
  useCreateAutofillProfile,
  useResumes,
} from "@/lib/queries"
import { ApiError } from "@/lib/types"
import { CONFLICT_NOTICE } from "./use-profile-autosave"

const NOTE = "text-[12px] leading-[1.55] text-muted-foreground"

/**
 * Before the first save there is no Profile to edit, so the page offers to
 * copy the basics of one resume or to start with empty fields. Either way the
 * first save creates the Profile and the page then shows its sections.
 */
export function ImportFromResume() {
  const client = useQueryClient()
  const [picking, setPicking] = useState(false)
  const create = useCreateAutofillProfile()
  const start = (load: () => Promise<Profile>) =>
    create.mutate(load, {
      onError: (error) => {
        if (error instanceof ApiError && error.code === "CONFLICT")
          // Another tab saved a Profile first; the page reloads that one.
          toast(CONFLICT_NOTICE)
        else toast.error(error.message)
      },
    })

  return (
    <div className="mt-7 rounded-[10px] border border-border bg-background p-4">
      <h3 className="text-[13px] font-semibold">Set up your profile</h3>
      <p className={`mt-1 max-w-[62ch] ${NOTE}`}>
        Copy the name, email, phone, city and links from one of your resumes, or
        start with empty fields. You can change everything afterwards.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          aria-expanded={picking}
          disabled={create.isPending}
          onClick={() => setPicking(!picking)}
        >
          Import from resume
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={create.isPending}
          onClick={() => start(async () => emptyProfile)}
        >
          Start blank
        </Button>
      </div>
      {picking ? (
        <ResumeChoices
          disabled={create.isPending}
          onPick={(id) =>
            start(async () => {
              const resume = await client.fetchQuery(resumeQuery(id))
              return profileFromResume(emptyProfile, resume.data)
            })
          }
        />
      ) : null}
    </div>
  )
}

function ResumeChoices({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (id: string) => void
}) {
  const resumes = useResumes()

  let body: ReactNode
  if (resumes.isPending) {
    body = <p className={NOTE}>Loading your resumes…</p>
  } else if (!resumes.data) {
    body = (
      <div className="flex items-center gap-2">
        <p className={NOTE}>Your resumes didn't load.</p>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void resumes.refetch()}
        >
          Try again
        </Button>
      </div>
    )
  } else if (resumes.data.length === 0) {
    body = <p className={NOTE}>No resumes yet.</p>
  } else {
    body = (
      <>
        <ul className="flex flex-col gap-0.5">
          {resumes.data.map((resume) => (
            <li key={resume.id}>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onPick(resume.id)}
                className="w-full justify-start font-normal"
              >
                <FileTextIcon className="size-3.5 flex-none opacity-70" />
                <span className="truncate">{resume.title}</span>
              </Button>
            </li>
          ))}
        </ul>
        <LoadMore {...resumes} />
      </>
    )
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-1.5 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        Choose a resume
      </p>
      {body}
    </div>
  )
}
