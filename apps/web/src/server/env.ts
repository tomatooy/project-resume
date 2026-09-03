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

/* ------------------------------------------------------------------- AI */

/**
 * Real secrets, so these come from `process.env`, which is where `wrangler
 * secret` and `.dev.vars` land, and never through a `PUBLIC_` name that Vite
 * would inline into the browser bundle.
 */
export function deepseekApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Add it to apps/web/.dev.vars locally, or `wrangler secret put DEEPSEEK_API_KEY` in production."
    )
  }
  return key
}

/** Empty means the provider default; an override is a deploy-time choice. */
export function aiModelIds(): { smart?: string; fast?: string } {
  return {
    smart: process.env.AI_MODEL_SMART || undefined,
    fast: process.env.AI_MODEL_FAST || undefined,
  }
}

export function aiBaseUrl(): string | undefined {
  return process.env.AI_BASE_URL || undefined
}
