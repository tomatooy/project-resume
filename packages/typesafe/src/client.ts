import {
  TypeSafeClient as SdkClient,
  TypeSafeError,
  type TypeSafeClientConfig as SdkConfig,
} from "@typesafe-ai/sdk"

export type TypeSafeClientConfig = Pick<
  SdkConfig,
  "baseURL" | "defaultModel" | "timeout" | "retry" | "fetch"
> & { apiKey: string }

export type TypeSafeClient = Pick<SdkClient, "systemOne">

export function createTypeSafeClient(
  config: TypeSafeClientConfig
): TypeSafeClient {
  const apiKey = config.apiKey.trim()
  if (!apiKey) throw new TypeSafeError("TypeSafe apiKey must not be empty")

  const client = new SdkClient({
    apiKey,
    // Explicit defaults prevent the SDK from reading ambient environment values.
    baseURL: config.baseURL?.trim() || "https://api.typesafe.ai",
    defaultModel: config.defaultModel?.trim() || "jev-latest",
    timeout: config.timeout ?? 10_000,
    retry: { maxRetries: 2, ...config.retry },
    fetch: config.fetch,
    // SDK debug logs include unredacted request and response bodies.
    logLevel: "off",
    dangerouslyAllowBrowser: false,
  })

  return { systemOne: client.systemOne.bind(client) }
}
