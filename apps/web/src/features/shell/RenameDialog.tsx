import { useMutation, useQueryClient } from "@tanstack/react-query"
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

import { renameResume } from "@/lib/api"
import { qk } from "@/lib/query-keys"

export function RenameDialog({
  target,
  onClose,
}: {
  target: { id: string; title: string } | null
  onClose: () => void
}) {
  const [title, setTitle] = useState("")
  const queryClient = useQueryClient()

  useEffect(() => {
    if (target) setTitle(target.title)
  }, [target])

  const rename = useMutation({
    mutationFn: (next: string) =>
      renameResume({ id: target?.id ?? "", title: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.resumes() })
      onClose()
    },
  })

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) rename.mutate(title.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename resume</DialogTitle>
            <DialogDescription>
              Only you see this name. It does not appear on the PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="resume-title">Name</Label>
            <Input
              id="resume-title"
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
            <Button type="submit" disabled={!title.trim() || rename.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
