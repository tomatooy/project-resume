import { createFileRoute } from "@tanstack/react-router"

import { safeNextPath } from "@/lib/next-path"
import { createSupabaseForRequest } from "@/server/auth/supabase"

/**
 * Where Google sends the user back to.
 *
 * The `code` is exchanged for a session here, on the server, so the tokens are
 * written straight into HttpOnly cookies and never pass through client
 * JavaScript. `createSupabaseForRequest` sets them through the same cookie
 * bridge every server function uses.
 */
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get("code")
        const next = safeNextPath(url.searchParams.get("next"))

        if (!code) {
          return redirectTo(url, "/login?error=missing_code")
        }

        const db = createSupabaseForRequest()
        const { error } = await db.auth.exchangeCodeForSession(code)
        if (error) {
          // The reason is deliberately not passed on: it can name the provider
          // account, and a failed exchange is a failed exchange to the user.
          return redirectTo(url, "/login?error=exchange_failed")
        }

        return redirectTo(url, next)
      },
    },
  },
})

function redirectTo(base: URL, path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(path, base.origin).toString() },
  })
}
