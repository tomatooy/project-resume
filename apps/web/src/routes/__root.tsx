import type { QueryClient } from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import appCss from "@workspace/ui/globals.css?url"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Résumé Studio" },
        {
          name: "description",
          content: "Write, tailor and export a resume with an AI assistant.",
        },
      ],
      links: [{ rel: "stylesheet", href: appCss }],
    }),
    notFoundComponent: NotFound,
    errorComponent: ErrorScreen,
    shellComponent: RootDocument,
  }
)

function RootDocument({ children }: { children: React.ReactNode }) {
  const { queryClient } = Route.useRouteContext()

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delay={400}>{children}</TooltipProvider>
        </QueryClientProvider>
        <Toaster position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <CentredMessage
      title="Page not found"
      description="The page you were looking for has moved or never existed."
    />
  )
}

function ErrorScreen({ error }: { error: Error }) {
  return (
    <CentredMessage
      title="Something went wrong"
      description={
        error.message || "An unexpected error stopped this screen loading."
      }
    />
  )
}

function CentredMessage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Empty className="max-w-sm">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <Button render={<Link to="/dashboard">Back to my resumes</Link>} />
      </Empty>
    </main>
  )
}
