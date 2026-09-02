import { createFileRoute } from "@tanstack/react-router"

import { createSupabaseForRequest } from "@/server/auth/supabase"

/**
 * POST, not GET: a link a page can be tricked into prefetching should not be
 * able to sign somebody out.
 */
export const Route = createFileRoute("/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const db = createSupabaseForRequest()
        // `signOut` clears the session cookies through the same bridge that set
        // them, so nothing has to be expired by hand here.
        await db.auth.signOut()

        return new Response(null, {
          status: 303,
          headers: {
            Location: new URL("/login", new URL(request.url).origin).toString(),
          },
        })
      },
    },
  },
})
