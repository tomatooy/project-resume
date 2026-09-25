import { createClient } from "@supabase/supabase-js"
import type { Database } from "@workspace/supabase"
import { AppError } from "@workspace/resume-core"
import { connection } from "./supabase"

export function createSupabaseForBearer(accessToken: string) {
  const { url, key } = connection()
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
export async function verifyBearer(accessToken: string) {
  const db = createSupabaseForBearer(accessToken)
  const { data, error } = await db.auth.getClaims(accessToken)
  if (
    error ||
    !data?.claims.sub ||
    typeof data.claims.exp !== "number" ||
    data.claims.exp * 1000 <= Date.now()
  )
    throw new AppError("UNAUTHENTICATED", "Sign in again")
  return {
    db,
    userId: data.claims.sub,
    accessToken,
    expiresAt: data.claims.exp,
  }
}
