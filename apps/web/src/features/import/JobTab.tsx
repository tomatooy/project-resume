import { SparkleIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
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

import { resumesQuery } from "@/lib/queries"
import type { TailorFromJobResult } from "@/lib/types"
import { JobProgressPanel } from "./JobProgress"
import { useTailor } from "./use-tailor"

/** Below this the posting is a job title, and tailoring has nothing to work from. */
const MIN_CHARS = 200

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
  const { data: resumes } = useQuery(resumesQuery())
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [source, setSource] = useState(sourceResumeId ?? "")
  const { progress, failure, fetching, busy, fetchPosting, run, cancel } =
    useTailor(onDone)

  if (progress) return <JobProgressPanel stage={progress} onCancel={cancel} />

  const ready = source !== "" && text.trim().length >= MIN_CHARS

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
            placeholder="https://www.linkedin.com/jobs/view/..."
            className="text-[12.5px]"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={url.trim() === "" || fetching}
            onClick={() => {
              void fetchPosting(url).then((result) => {
                if (result) setText(result.text)
              })
            }}
          >
            {fetching ? "Fetching" : "Fetch"}
          </Button>
        </div>
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
          value={source}
          onValueChange={(value) => setSource(value ?? "")}
        >
          <SelectTrigger
            id="job-source"
            className="mt-1.5 w-full text-[12.5px]"
          >
            <SelectValue placeholder="Choose a resume" />
          </SelectTrigger>
          <SelectContent>
            {(resumes ?? []).map((resume) => (
              <SelectItem key={resume.id} value={resume.id}>
                {resume.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
