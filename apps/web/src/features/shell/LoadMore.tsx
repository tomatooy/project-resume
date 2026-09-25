import { Button } from "@workspace/ui/components/button"
export function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
}: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => Promise<object>
}) {
  if (!hasNextPage) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-2 w-full"
      disabled={isFetchingNextPage}
      onClick={() => void fetchNextPage()}
    >
      {isFetchingNextPage
        ? "Loading…"
        : isFetchNextPageError
          ? "Retry loading more"
          : "Load more"}
    </Button>
  )
}
