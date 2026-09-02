/// <reference types="vite/client" />

/**
 * Vite's own `ImportMetaEnv` is an index signature, so every lookup would come
 * back untyped. Naming the variables here is what makes a missing one a
 * compile error rather than `undefined` at run time.
 *
 * `envPrefix` in vite.config.ts is what lets `PUBLIC_` reach the browser.
 */
interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY: string
  readonly PUBLIC_APP_NAME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
