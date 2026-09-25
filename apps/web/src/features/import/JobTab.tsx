import { SparkleIcon } from "@phosphor-icons/react"
import { normalizeLinkedInJobUrl } from "@workspace/resume-core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { useState } from "react"
import { z } from "zod"

import { LoadMore } from "@/features/shell/LoadMore"
import { useResumes, useResumeSummaries } from "@/lib/queries"
import type { TailorFromJobResult } from "@/lib/types"
import { useLocalStorage } from "@/lib/use-local-storage"
import { JobProgressPanel } from "./JobProgress"
import { useTailor } from "./use-tailor"

/** Below this the posting is a job title, and tailoring has nothing to work from. */
const MIN_CHARS = 200

/**
 * The base resume last picked here. A habit rather than a document, so it
 * stays in the browser with the panel and split preferences; only a resume id
 * is ever stored.
 */
const LastSource = z.string().max(64)
const LAST_SOURCE_KEY = "resume-studio.tailor-source"

/**
 * One pane, not a wizard. The link and the description are the same field in
 * two steps: fetching fills the textarea, and the textarea is what gets sent,
 * so the user always reads the posting before anything is generated.
 */
export function JobTab({
  sourceResumeId,
  onDone,
}: {
  sourceResumeId?: string
  onDone: (result: TailorFromJobResult) => void
}) {
  const resumeList = useResumes()
  const resumes = resumeList.data
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const [lastSource, rememberSource] = useLocalStorage(
    LAST_SOURCE_KEY,
    LastSource,
    ""
  )
  const selectedId = picked ?? sourceResumeId ?? lastSource
  const [selected] = useResumeSummaries(selectedId ? [selectedId] : [])
  const available = [
    ...new Map(
      [...(resumes ?? []), ...(selected?.data ? [selected.data] : [])].map(
        (row) => [row.id, row]
      )
    ).values(),
  ]
  const [touched, setTouched] = useState(false)
  const { progress, failure, fetching, busy, fetchPosting, run, cancel } =
    useTailor(onDone)

  // The rule the Worker applies before it fetches, run here too so the button
  // can answer for it. It is cheap and offline, which is the point: no request
  // is spent to find out the link was never going to be fetched.
  const target = normalizeLinkedInJobUrl(url)
  // Held back while the link is being typed, the way a field error is: half an
  // address is invalid for a moment, and saying so is nagging. A paste or a
  // step away from the field is the answer the user is asking for.
  const badLink = touched && url.trim() !== "" && target === null

  if (progress) return <JobProgressPanel stage={progress} onCancel={cancel} />

  // Item children are only rendered inside the popup. Without `items` on the
  // root, the trigger falls back to printing the raw value, which is an id.
  const options = available.map((resume) => ({
    label: resume.title,
    value: resume.id,
  }))

  // The base resume to build from, in order: what was picked in this dialog,
  // the resume it was opened from, then the one remembered from last time. A
  // remembered id missing from the list was deleted, so it is ignored rather
  // than cleared: the list is the authority.
  const remembered = available.some((resume) => resume.id === lastSource)
    ? lastSource
    : ""
  const source = picked ?? sourceResumeId ?? remembered

  const ready =
    available.some((row) => row.id === source) &&
    text.trim().length >= MIN_CHARS

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <label
          htmlFor="job-url"
          className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
        >
          LinkedIn job link
        </label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="job-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => setTouched(true)}
            onPaste={() => setTouched(true)}
            placeholder="https://www.linkedin.com/jobs/view/..."
            className="text-[12.5px]"
            aria-invalid={badLink}
            aria-describedby={badLink ? "job-url-error" : undefined}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={target === null || fetching}
            onClick={() => {
              void fetchPosting(url).then((result) => {
                if (result) setText(result.text)
              })
            }}
          >
            {fetching ? "Fetching" : "Fetch"}
          </Button>
        </div>
        {badLink ? (
          <p id="job-url-error" className="mt-1 text-[11px] text-destructive">
            That is not a LinkedIn job link. Paste the description instead.
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="job-text"
          className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
        >
          Job description
        </label>
        <Textarea
          id="job-text"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste the description, or fetch it from the link above."
          className="mt-1.5 max-h-48 text-[12.5px]"
        />
      </div>

      <div>
        <label
          htmlFor="job-source"
          className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
        >
          Build it from
        </label>
        <Select
          items={options}
          value={source}
          onValueChange={(value) => {
            const next = value ?? ""
            setPicked(next)
            // Picked here, so this is what the next dialog opens with. The
            // dialog opened from a resume's own menu is not a pick.
            if (next) rememberSource(next)
          }}
        >
          <SelectTrigger
            id="job-source"
            className="mt-1.5 w-full text-[12.5px]"
          >
            <SelectValue placeholder="Choose a resume" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LoadMore {...resumeList} />
      </div>

      {failure ? (
        <p className="text-[12px] leading-[1.5] text-destructive">{failure}</p>
      ) : null}

      <p className="text-[11.5px] leading-[1.5] text-muted-foreground">
        The assistant rewrites your resume against this posting. Read the result
        before you send it anywhere: check the wording is still true of you, and
        that nothing has been added that you would not say yourself.
      </p>

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() =>
            void run({
              sourceResumeId: source,
              jobText: text,
              sourceUrl: url.trim() || undefined,
            })
          }
        >
          <SparkleIcon />
          Create resume
        </Button>
      </div>
    </div>
  )
}
