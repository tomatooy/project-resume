import { DotsSixVerticalIcon } from "@phosphor-icons/react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

/**
 * Vertical reordering for one list. Every level of the editor (items within a
 * section, bullets within an item) uses this, and a drop reports the new index
 * so the caller can dispatch a `move` patch.
 */
export function SortableList({
  ids,
  onReorder,
  children,
  className,
}: {
  ids: string[]
  onReorder: (id: string, toIndex: number) => void
  children: ReactNode
  className?: string
}) {
  const sensors = useSensors(
    // A small distance keeps a click on the card from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={(event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const toIndex = ids.indexOf(String(over.id))
        if (toIndex >= 0) onReorder(String(active.id), toIndex)
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  )
}

export function SortableRow({
  id,
  children,
  className,
  handleClassName,
  handleLabel,
}: {
  id: string
  children: (handle: ReactNode) => ReactNode
  className?: string
  handleClassName?: string
  handleLabel: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const handle = (
    <button
      type="button"
      aria-label={handleLabel}
      className={cn(
        "flex size-5 flex-none cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing",
        handleClassName
      )}
      {...attributes}
      {...listeners}
    >
      <DotsSixVerticalIcon className="size-3.5" weight="bold" />
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-90", className)}
    >
      {children(handle)}
    </div>
  )
}
