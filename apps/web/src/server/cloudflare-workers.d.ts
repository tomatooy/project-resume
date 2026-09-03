/**
 * The runtime module workerd exposes to Worker code. Only what this app
 * imports is declared; the full surface would come from `wrangler types`,
 * which nothing else here needs.
 */
declare module "cloudflare:workers" {
  export function waitUntil(promise: Promise<unknown>): void
}
