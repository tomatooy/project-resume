import { createORPCClient } from "@orpc/client"
import type { ContractRouterClient } from "@orpc/contract"
import { OpenAPILink } from "@orpc/openapi-client/fetch"
import { contract } from "./contract"

export type ApiClient = ContractRouterClient<typeof contract>
export function createApiClient(options: {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  headers?: () => Promise<Record<string, string>> | Record<string, string>
}): ApiClient {
  return createORPCClient(
    new OpenAPILink(contract, {
      url: options.baseUrl,
      headers: options.headers,
      fetch: options.fetch,
    })
  )
}
