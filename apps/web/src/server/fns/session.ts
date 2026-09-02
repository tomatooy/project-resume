import { createServerFn } from "@tanstack/react-start"

import { readUser, type SessionUser } from "../auth/require-user"
import { createSupabaseForRequest } from "../auth/supabase"

/**
 * The one function that does not require a user: it is what the route guard
 * calls to find out whether there is one.
 */
export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    return readUser(createSupabaseForRequest())
  }
)
