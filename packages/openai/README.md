# @workspace/openai

Server-side OpenAI Decisions through the official `openai@7.41.0` SDK.
This standalone package sits alongside `@workspace/typesafe`. It supplies an
explicit configuration boundary and disables SDK logging. It has no dependency
on the resume domain, AI SDK, React, or Supabase. Autofill continues to use Jev.

## Usage

```ts
import { createOpenAIClient } from "@workspace/openai"

const client = createOpenAIClient({ apiKey })
const { answers } = await client.decisions.create(
  {
    input: "Please refund a duplicate payment.",
    questions: [{
      type: "predicate",
      name: "refundRequested",
      instructions: "Does the sender explicitly request a refund?",
    }],
  },
  { signal: AbortSignal.timeout(15_000) }
)

for (const answer of answers) {
  if (answer.type === "predicate") {
    // The caller chooses its threshold for review or routing.
    const needsReview = answer.probability >= 0.8
  } else if (answer.type === "refusal") {
    // Leave this question unresolved for the caller.
  }
}
```

The typechecked [mixed-question example](examples/evaluate-message.ts) covers
predicate, choice, and score questions with an injected client. It makes no
request on import. The package preserves the native SDK shapes:

| Jev | OpenAI Decisions |
| --- | --- |
| `systemOne({ state, questions })` | `decisions.create({ input, questions })` |
| Text or structured `state` | Text or user messages with text and images; serialize objects explicitly |
| Questions keyed by name | Question array with optional `name` values |
| `noul` / `.noul` | `predicate` / `.probability` |
| Choice criteria keyed by label | `choices: [{ value, description }]`, with string or boolean values |
| Score criteria | Ordered `levels: [{ label, description }]` |
| Answer and probability maps | Answer and probability arrays |

Narrow each answer by `type`, including `refusal`. Choice and score answers
retain their confidence and probability distributions. A score can fall between
level indices. Independent questions share the same input; dependent questions
need separate calls. See the [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
and [TypeScript API reference](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create).

## Configuration

| Option | Default |
| --- | --- |
| `apiKey` | Required, nonblank server-side key |
| `baseURL` | `https://api.openai.com/v1`, including the API version |
| `defaultModel` | `gpt-6-luna` |
| `organization`, `project` | Unset |
| `timeout` | `10000` ms per attempt |
| `maxRetries` | `2`, up to three attempts |
| `fetch` | Global `fetch` |

The package reads no environment configuration. Blank optional strings use the
defaults. A request's `model` overrides `defaultModel`. The default follows the
model supported by Decisions; an override must also be supported by the API.

`OpenAIClient` exposes only `decisions.create`. `DecisionRequest` derives from
the SDK's `DecisionCreateParams`, making `model` optional. Native SDK request,
response, input, and error types are exported from the package entry point.
The original `APIPromise` is returned, including `.withResponse()` for request
IDs. There is no runtime response validation or policy for acting on answers.

The second argument accepts SDK `RequestOptions`, including `signal`, `timeout`,
`maxRetries`, and `headers`. The SDK owns retries and timeouts; the package adds
no retry layer. Use an abort signal for a total deadline across retries.

SDK logging is always off, including when `OPENAI_LOG=debug` is set. Browser
use is rejected. Logger options and the browser escape hatch are not exposed.
Custom transports must also avoid logging input or responses. Provider errors
retain their original SDK classes and can contain private content. At the app
boundary, use the existing safe error mapper and log only allowed metadata.

## App configuration

`apps/web/src/server/openai.ts` exports `createOpenAIClientFromEnv()`. It reads
configuration only when called, so importing it needs no key and new clients
pick up key rotation. No product feature calls it yet.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required only when creating this client |
| `OPENAI_DEFAULT_MODEL` | Optional default model override |
| `OPENAI_BASE_URL` | Optional API base URL, including `/v1` |
| `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` | Optional explicit request routing |

Add the key to `apps/web/.dev.vars` locally, preserving existing secrets. In
production, run `bunx wrangler secret put OPENAI_API_KEY` from `apps/web`.
Optional configuration can go in `.dev.vars` or Wrangler `vars`. Never put the
key in `.env.local`, Wrangler `vars`, or a `PUBLIC_` variable.

Dependency direction: `web -> openai -> official SDK`. Resume-specific decision
questions and policies belong in `agent`, with the client injected by the app
when a feature adopts it.

## Verification

```sh
bun run --filter @workspace/openai test
bun run --filter @workspace/openai typecheck
bun run --filter web test src/server/openai.test.ts
bun run typecheck
bun run lint
```

Tests use synthetic fixtures and mocked transports. They make no paid API calls
and do not establish account access or deployment behavior.
