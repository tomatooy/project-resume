import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"

import { NO_ERRORS } from "@workspace/resume-schema"

import { addLink, removeNode, setFields, setText } from "../actions"
import { useResumeState, useSession } from "../session-context"
import { PaneHeader } from "./PaneHeader"
import { SaveBar } from "./SaveBar"
import { SectionPane } from "./SectionPane"
import { TextAreaInput, TextInput } from "./fields"
import type { PaneKey } from "./SectionRail"

export function EditorPane({ pane }: { pane: PaneKey }) {
  const doc = useResumeState((s) => s.doc)

  if (pane === "contact") return <ContactPane />
  if (pane === "summary") return <SummaryPane />

  const section = doc.sections.find((s) => s.id === pane)
  if (!section) return <ContactPane />
  return <SectionPane key={section.id} section={section} />
}

function ContactPane() {
  const session = useSession()
  const basics = useResumeState((s) => s.doc.basics)
  const byNode = useResumeState((s) => s.validity.byNode)
  const errors = byNode.basics ?? NO_ERRORS

  return (
    <>
      <PaneHeader
        title="Contact details"
        hint="Everything here sits in the header of the page. Keep it to one line."
        actions={<SaveBar />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput
          label="Full name"
          value={basics.name}
          error={errors.name}
          onCommit={(v) => setText(session, "basics", "name", v)}
        />
        <TextInput
          label="Headline"
          value={basics.headline ?? ""}
          error={errors.headline}
          placeholder="Senior Product Designer"
          onCommit={(v) => setText(session, "basics", "headline", v)}
        />
        <TextInput
          label="Email"
          value={basics.email ?? ""}
          error={errors.email}
          placeholder="you@example.com"
          onCommit={(v) =>
            setFields(session, "basics", { email: v || undefined })
          }
        />
        <TextInput
          label="Phone"
          value={basics.phone ?? ""}
          error={errors.phone}
          onCommit={(v) => setText(session, "basics", "phone", v)}
        />
        <TextInput
          label="Location"
          className="sm:col-span-2"
          value={basics.location ?? ""}
          error={errors.location}
          placeholder="City, Country"
          onCommit={(v) => setText(session, "basics", "location", v)}
        />
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            Links
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="xs" onClick={() => addLink(session)}>
            <PlusIcon />
            Add link
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {basics.links.map((link) => {
            const linkErrors = byNode[link.id] ?? NO_ERRORS
            return (
              <div
                key={link.id}
                className="flex items-start gap-2 rounded-[9px] border border-border bg-paper p-2"
              >
                <TextInput
                  ariaLabel="Link label"
                  className="w-[38%]"
                  value={link.label}
                  error={linkErrors.label}
                  placeholder="LinkedIn"
                  onCommit={(v) => setText(session, link.id, "label", v)}
                />
                <TextInput
                  ariaLabel="Link URL"
                  className="flex-1"
                  value={link.url}
                  error={linkErrors.url}
                  placeholder="https://"
                  onCommit={(v) => setText(session, link.id, "url", v)}
                />
                <button
                  type="button"
                  aria-label="Remove link"
                  onClick={() => removeNode(session, link.id)}
                  className="mt-[3px] flex size-[34px] flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            )
          })}

          {basics.links.length === 0 ? (
            <p className="rounded-[9px] border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
              No links yet.
            </p>
          ) : null}
        </div>
      </div>
    </>
  )
}

function SummaryPane() {
  const session = useSession()
  const summary = useResumeState((s) => s.doc.basics.summary ?? "")
  const lines = summary.trim() ? summary.trim().split(/(?<=\.)\s+/).length : 0

  return (
    <>
      <PaneHeader
        title="Professional summary"
        hint="Three sentences at most. Lead with scope, close with a number."
        actions={<SaveBar />}
      />

      <TextAreaInput
        label="Summary"
        rows={6}
        value={summary}
        placeholder="What you do, at what scale, and what changed because of you."
        onFocus={() => session.select("basics")}
        onCommit={(v) => setText(session, "basics", "summary", v)}
        hint={`${summary.trim().length} characters · ${lines} ${lines === 1 ? "sentence" : "sentences"}`}
      />

      <p className="mt-4 rounded-[9px] border border-border bg-canvas px-3.5 py-3 text-[12px] leading-[1.55] text-muted-foreground">
        Ask the assistant to rewrite this with the Summary skill. Its
        suggestions arrive as cards you accept or reject, so nothing changes
        until you say so.
      </p>
    </>
  )
}
