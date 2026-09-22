# @workspace/typesafe

Server-side Jev decisions through the official `@typesafe-ai/sdk@0.6.0`.
This private workspace package supplies an explicit configuration boundary,
disables SDK logging, and preserves the SDK's inferred question and answer types.
It has no dependency on the resume domain, AI SDK, React, Supabase, or Node APIs.

## Usage

```ts
import { choice, createTypeSafeClient, noul, score } from "@workspace/typesafe"

// Supply the key from your server's secret configuration.
const client = createTypeSafeClient({ apiKey })
const { answers, model, usage } = await client.systemOne(
  {
    state: { message: "Please refund a duplicate payment." },
    questions: {
      category: choice("Which team should handle this message?", {
        billing: "Payments and invoices",
        technical: "Product errors",
        other: "Anything else",
      }),
      urgency: score("How urgent is the request?", ["Routine", "Soon", "Now"]),
      refundRequested: noul("Does the sender explicitly request a refund?"),
    },
  },
  { signal: AbortSignal.timeout(15_000) }
)
```

`answers.category.choice` is inferred as `"billing" | "technical" | "other"`.
Choice and Score retain their probability distributions and confidence values.
Score is an expected value and can fall between rubric levels, such as `0.75`.
Noul is a probability from 0 to 1, with no separate confidence field.
Thresholds, weights, and low-confidence fallbacks belong to the caller.

The typechecked [mixed-question example](examples/evaluate-message.ts) accepts
an injected client and cancellation signal. It makes no request on import.
Questions in one call share the state and are evaluated independently, so each
question should ask for one focused judgment.

## Configuration and API

`createTypeSafeClient(config)` exposes only `systemOne`, including the SDK's
`APIPromise` helpers such as `.withResponse()` for request IDs. It does not expose
the SDK client constructor, mutable client configuration, or model-listing API.
The public entry point explicitly exports question builders, request and result
types, and SDK error classes.

| Option | Default | Meaning |
| --- | --- | --- |
| `apiKey` | Required | A nonblank server-side key |
| `baseURL` | `https://api.typesafe.ai` | API root, excluding `/v1/systemone` |
| `defaultModel` | `jev-latest` | Override with a specific model when reproducibility matters |
| `timeout` | `10000` | Milliseconds per attempt, including response delivery |
| `retry` | SDK policy, `maxRetries: 2` | Up to three attempts total |
| `fetch` | Global `fetch` | Inject a transport for tests or server infrastructure |

The package passes explicit defaults to the SDK and never reads environment
configuration. Whitespace-only optional URL and model values use the defaults.
Per-request `model` overrides `defaultModel`. The second `systemOne` argument
accepts the official `RequestOptions`: `signal`, `timeout`, `retry`, and `headers`.
Retries and timeouts are implemented by the SDK, with no extra retry layer.
The SDK retries connection failures, attempt timeouts, 408, 429, and 5xx responses.
It honors `Retry-After`; consequently the attempt timeout is not a total deadline.
Pass an `AbortSignal` to bound the entire operation, including retry waits.

SDK errors remain their original classes, including `APIError`,
`AuthenticationError`, `RateLimitError`, `APIConnectionError`, `APITimeoutError`,
and `APIUserAbortError`. Their messages and bodies can contain private input.
Do not log or serialize raw errors. At the application boundary, use the
existing safe error mapper and log only allowed metadata such as error class,
model, duration, and token counts.

SDK logging is always off, even if `TYPESAFE_LOG_LEVEL=debug` is set. Browser use
is refused; neither logger configuration nor the browser escape hatch is part
of this package's API. Custom transports must also avoid logging request bodies.
The SDK supplies compile-time answer types, not runtime response-schema
validation. Validate at the consuming boundary if a use case requires it.

## Résumé Studio configuration

The app's server-only module `apps/web/src/server/typesafe.ts` exports
`createTypeSafeClientFromEnv()`. It reads configuration on each factory call,
so importing the module needs no key and key rotation applies to new clients.
There are no product callers yet, and existing chat does not require a Jev key.

| Variable | Location |
| --- | --- |
| `TYPESAFE_API_KEY` | Local `apps/web/.dev.vars`, production Worker secret |
| `TYPESAFE_DEFAULT_MODEL` | Wrangler `vars`, optionally overridden in `.dev.vars` |
| `TYPESAFE_BASE_URL` | Optional Wrangler `vars` or `.dev.vars` override |

Add the key to the existing `.dev.vars` file without replacing other secrets.
For production, run this from `apps/web`:

```sh
bunx wrangler secret put TYPESAFE_API_KEY
```

Never put the key in a `PUBLIC_` variable, Wrangler `vars`, or `.env.local`.
The dependency direction is `web -> typesafe -> official SDK`. Future
resume-specific rubrics and decision policies belong in `agent`, with the client
injected by the app. New use cases compose questions without extending a central
provider registry or changing `Models.smart` / `Models.fast`.

## Verification

From the repository root:

```sh
bun run --filter @workspace/typesafe test
bun run --filter @workspace/typesafe typecheck
bun run --filter web test src/server/typesafe.test.ts
bun run typecheck
bun run lint
```

Tests use synthetic fixtures and injected transports, with no paid API calls.
Type assertions and negative type cases are checked by `typecheck`.
The SDK uses Fetch APIs and detects Bun and Cloudflare Workers. Source inspection
and local tests do not establish that a particular deployed Worker or account
configuration has been verified.

References: [primitives](https://docs.typesafe.ai/primitives),
[JavaScript SDK](https://docs.typesafe.ai/sdk/javascript),
[client configuration](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig),
[runtime detection](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/runtime.ts).
