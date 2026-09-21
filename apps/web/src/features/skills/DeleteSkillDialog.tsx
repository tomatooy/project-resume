import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { toast } from "sonner"

import { useDeleteUserSkill } from "@/lib/queries"

/**
 * Confirms removing one custom skill. The list and the open tab both delete
 * through this, so the wording and the soft-delete story live in one place.
 *
 * The row is flagged, not dropped: it leaves the library and the turn's
 * library with it, while its id and name stay readable so a suggestion card it
 * shaped earlier can still say where it came from.
 */
export function DeleteSkillDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: { id: string; name: string } | null
  onClose: () => void
  /** A tab the skill was open in closes on this. */
  onDeleted?: (id: string) => void
}) {
  const remove = useDeleteUserSkill()

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{target?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The assistant stops being offered it. Suggestions it already shaped
            keep its name, so a card you saw earlier still says where it came
            from. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={() => {
              const row = target
              if (!row) return
              remove.mutate(row.id, {
                onSuccess: () => {
                  toast.success(`Deleted ${row.name}`)
                  onDeleted?.(row.id)
                },
                onError: (error) => toast.error(error.message),
              })
              onClose()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
