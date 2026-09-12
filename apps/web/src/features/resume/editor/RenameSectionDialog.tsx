import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useEffect, useState } from "react"

/**
 * Renames a section. The heading belongs to the document, so this commits
 * through the store and autosave picks it up, rather than a server call.
 */
export function RenameSectionDialog({
  target,
  onClose,
  onRename,
}: {
  target: { id: string; title: string } | null
  onClose: () => void
  onRename: (id: string, title: string) => void
}) {
  const [title, setTitle] = useState("")

  useEffect(() => {
    if (target) setTitle(target.title)
  }, [target])

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const next = title.trim()
            if (!target || !next) return
            onRename(target.id, next)
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename section</DialogTitle>
            <DialogDescription>
              The heading shows in the editor and on the PDF. Its entries stay
              as they are.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="section-heading">Heading</Label>
            <Input
              id="section-heading"
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={!title.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
