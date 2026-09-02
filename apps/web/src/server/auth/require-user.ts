import { AppError } from "@workspace/resume-core"

import type { Db } from "./supabase"

export type SessionUser = {
  userId: string
  email: string
}

/**
 * `getClaims()` rather than `getSession()`: it verifies the JWT signature and
 * refreshes the cookie when the token is close to expiry. `getSession()` only
 * decodes whatever the cookie says, which a client can write.
 */
export async function readUser(db: Db): Promise<SessionUser | null> {
  const { data, error } = await db.auth.getClaims()
  if (error || !data?.claims?.sub) return null

  const claims = data.claims
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
  }
}

export async function requireUser(db: Db): Promise<SessionUser> {
  const user = await readUser(db)
  if (!user) throw new AppError("UNAUTHENTICATED", "Not signed in")
  return user
}
