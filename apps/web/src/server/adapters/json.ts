import type { Database } from "@workspace/supabase"

type Json = Database["public"]["Tables"]["resumes"]["Row"]["data"]

/**
 * Widens a domain object into the generated `Json` type for a `jsonb` column.
 *
 * A plain cast would do it, but this is a real boundary: `Resume` carries
 * `undefined` on its optional fields and `Json` does not, and the round-trip
 * drops them exactly the way PostgREST's own serialization would. Doing it here
 * means what is stored is what was checked, rather than what a cast promised.
 */
export function toJson(value: object): Json {
  return JSON.parse(JSON.stringify(value))
}
