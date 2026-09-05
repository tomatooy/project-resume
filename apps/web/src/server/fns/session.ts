import { createServerFn } from "@tanstack/react-start"

import { readUser, type SessionUser } from "../auth/require-user"
import { createSupabaseForRequest } from "../auth/supabase"
import { failWith } from "../errors"

/**
 * The one function that does not go through `defineFn`: it is what the route
 * guard calls to find out whether there is a user, so it cannot require one.
 */
export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    try {
      return await readUser(createSupabaseForRequest())
    } catch (error) {
      return failWith(error)
    }
  }
)
