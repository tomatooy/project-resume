import OpenAI, {
  OpenAIError,
  type APIPromise,
  type ClientOptions,
} from "openai"
import type { Decision, DecisionCreateParams } from "openai/resources/decisions"

export type OpenAIClientConfig = Pick<
  ClientOptions,
  "baseURL" | "organization" | "project" | "timeout" | "maxRetries" | "fetch"
> & { apiKey: string; defaultModel?: string }

export type DecisionRequest = Omit<DecisionCreateParams, "model"> & {
  model?: string
}

export type RequestOptions = OpenAI.RequestOptions

export type OpenAIClient = {
  decisions: {
    create(
      body: DecisionRequest,
      options?: RequestOptions
    ): APIPromise<Decision>
  }
}

export function createOpenAIClient(config: OpenAIClientConfig): OpenAIClient {
  const apiKey = config.apiKey.trim()
  if (!apiKey) throw new OpenAIError("OpenAI apiKey must not be empty")

  const defaultModel = config.defaultModel?.trim() || "gpt-6-luna"
  const client = new OpenAI({
    apiKey,
    // Explicit defaults prevent ambient SDK configuration.
    baseURL: config.baseURL?.trim() || "https://api.openai.com/v1",
    organization: config.organization?.trim() || null,
    project: config.project?.trim() || null,
    adminAPIKey: null,
    webhookSecret: null,
    timeout: config.timeout ?? 10_000,
    maxRetries: config.maxRetries ?? 2,
    fetch: config.fetch,
    // Debug logs include request and response bodies.
    logLevel: "off",
    dangerouslyAllowBrowser: false,
  })

  return {
    decisions: {
      create: (body, options) =>
        client.decisions.create(
          { ...body, model: body.model ?? defaultModel },
          options
        ),
    },
  }
}
