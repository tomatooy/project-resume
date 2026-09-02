import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getCookies,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server"

import type { Database } from "@workspace/supabase"
import { supabasePublishableKey, supabaseUrl } from "../env"

/** Every adapter takes this, and nothing else, as its connection. */
export type Db = SupabaseClient<Database>

/**
 * One client per request, carrying that request's cookies.
 *
 * It must never be hoisted to a module-level singleton: the client holds the
 * session it read from the cookie header, so a shared one would hand the first
 * caller's identity to everybody who arrived after them.
 */
export function createSupabaseForRequest(): Db {
  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
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
