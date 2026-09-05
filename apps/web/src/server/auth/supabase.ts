import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getCookies,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server"

import type { Database } from "@workspace/supabase"

/** Every adapter takes this, and nothing else, as its connection. */
export type Db = SupabaseClient<Database>

/**
 * Where the connection details come from.
 *
 * Both values are public by design. The publishable key identifies the project
 * and nothing else: it carries no privileges of its own, and every request is
 * authorized by the user's JWT against RLS. That is the whole reason this
 * application issues no service-role key anywhere.
 *
 * Because they are public, the server reads the same `PUBLIC_` variables the
 * browser does, through `import.meta.env`, rather than a second pair of
 * server-only names. One value, one name, and no chance of the two clients
 * pointing at different projects. Vite inlines them at build time, so they
 * must be present when `vite build` runs, not only when the Worker starts.
 *
 * Read on call rather than at module scope: a missing variable should fail
 * the request that needed it, not the import graph.
 */
function connection(): { url: string; key: string } {
  return {
    url: required("PUBLIC_SUPABASE_URL", import.meta.env.PUBLIC_SUPABASE_URL),
    key: required(
      "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.local.example to .env.local and fill it in from \`supabase status\`.`
    )
  }
  return value
}

/**
 * One client per request, carrying that request's cookies.
 *
 * It must never be hoisted to a module-level singleton: the client holds the
 * session it read from the cookie header, so a shared one would hand the first
 * caller's identity to everybody who arrived after them.
 */
export function createSupabaseForRequest(): Db {
  const { url, key } = connection()
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({
          name,
          value,
        }))
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, options)
        }
        // These are the no-store headers the library asks for alongside a
        // refreshed session cookie. Skipping them lets a CDN cache a response
        // that carries one user's token and serve it to the next visitor.
        for (const [name, value] of Object.entries(headers)) {
          setResponseHeader(name, value)
        }
      },
    },
  })
}
