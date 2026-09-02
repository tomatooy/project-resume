import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/supabase"

let client: SupabaseClient<Database> | undefined

/**
 * The browser's Supabase client, used for sign-in only.
 *
 * Data never goes through it: every read and write is a server function, so the
 * session cookie stays the single source of truth and the browser bundle
 * carries no query logic. It exists because the OAuth redirect has to be
 * started from the page the user is looking at.
 */
export function supabaseBrowser(): SupabaseClient<Database> {
  if (!client) {
    client = createBrowserClient<Database>(
      import.meta.env.PUBLIC_SUPABASE_URL,
      import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
    )
  }
  return client
}
