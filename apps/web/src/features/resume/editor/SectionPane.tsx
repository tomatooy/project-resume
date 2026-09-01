import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import type { Section } from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { useState } from "react"

import { addItem, moveNode, removeNode, setText } from "../actions"
import { sectionFlagCount } from "../flags"
import { useSession } from "../session-context"
import { ItemCard } from "./ItemCard"
import { PaneHeader } from "./PaneHeader"
import { SaveBar } from "./SaveBar"
import { SortableList, SortableRow } from "./SortableRow"
import { TextInput } from "./fields"

const NOUN: Record<Section["type"], [one: string, many: string]> = {
  experience: ["role", "roles"],
  education: ["entry", "entries"],
  projects: ["project", "projects"],
  skills: ["group", "groups"],
  custom: ["entry", "entries"],
}

const ADD_LABEL: Record<Section["type"], string> = {
  experience: "Add role",
  education: "Add education",
  projects: "Add project",
  skills: "Add skill group",
  custom: "Add entry",
}

export function SectionPane({ section }: { section: Section }) {
  const session = useSession()
  const [openId, setOpenId] = useState<string | null>(
    section.items[0]?.id ?? null
  )
  const [renaming, setRenaming] = useState(false)

  const flags = sectionFlagCount(section)
  const [one, many] = NOUN[section.type]
  const count = section.items.length

  return (
    <>
      {renaming ? (
        <div className="mb-[18px] flex items-end gap-2">
          <TextInput
            label="Section title"
            className="flex-1"
            value={section.title}
            onCommit={(value) => setText(session, section.id, "title", value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRenaming(false)}
          >
            Done
          </Button>
        </div>
      ) : (
        <PaneHeader
          title={section.title}
          meta={`${count} ${count === 1 ? one : many}`}
          hint={
            flags > 0
              ? "Bullets flagged in amber have no measurable outcome yet."
              : "Recruiters scan this block first. Keep each line to one idea."
          }
          actions={<SaveBar />}
        />
      )}

      <div className="mb-3 flex items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setRenaming((r) => !r)}
        >
          Rename section
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => removeNode(session, section.id)}
        >
          <TrashIcon />
          Delete section
        </Button>
      </div>

      {count === 0 ? (
        <Empty className="rounded-[10px] border border-dashed border-border py-10">
          <EmptyHeader>
            <EmptyTitle className="text-[13.5px]">Nothing here yet</EmptyTitle>
            <EmptyDescription className="text-[12px]">
              Add your first {one} to see it in the preview.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            size="sm"
            onClick={() => addItem(session, section.id, section.type)}
          >
            <PlusIcon />
            {ADD_LABEL[section.type]}
          </Button>
        </Empty>
      ) : (
        <>
          <SortableList
            ids={section.items.map((i) => i.id)}
            onReorder={(id, toIndex) => moveNode(session, id, toIndex)}
            className="flex flex-col gap-3"
          >
            {section.items.map((item) => (
              <SortableRow
                key={item.id}
                id={item.id}
                handleLabel="Reorder entry"
              >
                {(handle) => (
                  <ItemCard
                    item={item}
                    handle={handle}
                    open={openId === item.id}
                    onToggle={() =>
                      setOpenId(openId === item.id ? null : item.id)
                    }
                  />
                )}
              </SortableRow>
            ))}
          </SortableList>

          <button
            type="button"
            onClick={() => addItem(session, section.id, section.type)}
            className="mt-3 h-[38px] w-full rounded-[9px] border border-dashed border-border text-[12px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            + {ADD_LABEL[section.type]}
          </button>
        </>
      )}
    </>
  )
}
