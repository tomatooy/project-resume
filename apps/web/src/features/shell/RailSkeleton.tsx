import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { SKELETON_KEYS } from "@/lib/format"

export function RailSkeleton() {
  return (
    <div role="status" className="flex flex-none flex-col gap-px">
      <span className="sr-only">Loading</span>
      {SKELETON_KEYS.map((key, index) => (
        <div
          key={key}
          aria-hidden="true"
          className="flex h-[26px] items-center gap-1.5 pr-1.5 pl-2"
        >
          <Skeleton className="size-3.5 flex-none rounded-sm bg-foreground/10 motion-reduce:animate-none" />
          <Skeleton
            className={cn(
              "h-2.5 rounded-sm bg-foreground/10 motion-reduce:animate-none",
              index % 2 === 0 ? "w-3/5" : "w-2/5"
            )}
          />
          <Skeleton className="ml-auto h-2.5 w-5 flex-none bg-foreground/10 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}
