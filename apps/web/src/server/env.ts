/**
 * Where the Supabase connection details come from.
 *
 * Both values are public by design. The publishable key identifies the project
 * and nothing else: it carries no privileges of its own, and every request is
 * authorized by the user's JWT against RLS. That is the whole reason this
 * application issues no service-role key anywhere.
 *
 * Because they are public, the server reads the same `PUBLIC_` variables the
 * browser does, through `import.meta.env`, rather than a second pair of
 * server-only names. One value, one name, and no chance of the two clients
 * pointing at different projects.
 *
 * Consequence worth knowing: Vite inlines these at build time, so they must be
 * present when `vite build` runs, not only when the Worker starts. Real secrets
 * arrive later and differently, through `wrangler secret` and `process.env`.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.local.example to .env.local and fill it in from \`supabase status\`.`
    )
  }
  return value
}

/**
 * Read on call rather than at module scope. A missing variable should fail the
 * request that needed it, not the import graph: a module-level throw here would
 * take down anything that transitively imports a server function.
 */
export function supabaseUrl(): string {
  return required("PUBLIC_SUPABASE_URL", import.meta.env.PUBLIC_SUPABASE_URL)
}

export function supabasePublishableKey(): string {
  return required(
    "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
}
