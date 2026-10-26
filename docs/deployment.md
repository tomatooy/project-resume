# Deployment checklist

Deploy the web app to `https://vs-resume.ouyangzongxin.workers.dev` with
Supabase project `gbwyxuqprtumutqmluju`. Run all commands below from the
repository root. Builds, migrations, secret uploads, and deployments are
manual steps.

## Development and production

| Configuration | Development | Production |
| --- | --- | --- |
| App URL | `http://localhost:3002` | `https://vs-resume.ouyangzongxin.workers.dev` |
| Supabase URL | `http://127.0.0.1:54321` | `https://gbwyxuqprtumutqmluju.supabase.co` |
| Web public environment | `.env.local` | `.env.production.local` |
| Extension public environment | `apps/extension/.env.local` | `apps/extension/.env.production.local` |
| Worker secrets | `apps/web/.dev.vars` | Cloudflare secrets on `vs-resume` |
| Extension origins | `apps/web/.dev.vars` | `vars.EXTENSION_ORIGINS` in `apps/web/wrangler.jsonc` |

The production environment files are gitignored. On a new checkout, copy
`.env.production.example` and `apps/extension/.env.production.example` to
their adjacent `.env.production.local` files and fill in the publishable key.

Web builds read `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
and `PUBLIC_APP_NAME`. Extension builds read `VITE_APP_ORIGIN`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and the optional
`VITE_EXTENSION_PUBLIC_KEY`. Google client secrets and AI provider keys stay
out of these public variables.

Vite loads `.env.local` in both modes and lets `.env.production.local`
override it for production. Existing shell variables have higher priority.
The root and app `bunfig.toml` files disable Bun's automatic dotenv loading
so it cannot preload development values ahead of Vite. Explicit `--env-file`
arguments still work for commands such as live model evaluations.
[Vite environment rules](https://vite.dev/guide/env-and-mode) and
[Bun dotenv configuration](https://bun.com/docs/runtime/environment-variables).

The current Wrangler configuration uses its top-level environment. Keep
`CLOUDFLARE_ENV` unset. If named staging environments are added later, the
Cloudflare Vite plugin selects them at build time through `CLOUDFLARE_ENV`;
each environment needs its own vars and bindings.
[Cloudflare environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

| Command | Effect |
| --- | --- |
| `bun run dev` | Start the local workspace services and development apps |
| `bun run dev:web` | Start the web app against local Supabase |
| `bun run dev:extension` | Watch the extension in development mode |
| `bun run build:extension:dev` | Build the extension once against local services |
| `bun run build:web` | Build the production web app |
| `bun run build:extension` | Build the extension against production services |
| `bun run deploy:check` | Rebuild the production web app and run a Wrangler dry run |
| `bun run deploy:web` | Rebuild the production web app and publish it |

Web production builds reject missing Supabase configuration, HTTP URLs,
and loopback hosts. Extension production builds apply the same URL checks
to both the app and Supabase origins. Both reject `sb_secret_` keys in public
configuration. Turbo includes environment files and public shell variables
in build cache inputs and restores the generated Wrangler deployment pointer
with cached build output.

## Account setup

- [ ] Confirm Cloudflare authentication and the intended account:

  ```bash
  bun run cf whoami
  ```

- [ ] Set the Worker secrets below. Enter values at the prompts. A secret
  update publishes a new Worker version immediately. The explicit name keeps
  these commands pointed at `vs-resume` even before rebuilding old artifacts.
  [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

  ```bash
  bun run cf secret put DEEPSEEK_API_KEY --name vs-resume
  bun run cf secret put TYPESAFE_API_KEY --name vs-resume
  bun run cf secret put TAILOR_ENCRYPTION_KEY_V1 --name vs-resume
  bun run cf secret list --name vs-resume
  ```

  `DEEPSEEK_API_KEY` enables AI generation. `TYPESAFE_API_KEY` enables the Jev
  decisions used by autofill. `TAILOR_ENCRYPTION_KEY_V1` must be exactly 32
  random bytes encoded as base64. Generate a production key with
  `openssl rand -base64 32`, save it securely, and keep it stable while
  tailoring attempts are in flight. `OPENAI_API_KEY` is optional because the
  standalone OpenAI client has no product callers yet.

- [ ] Review the non-secret Worker settings in `apps/web/wrangler.jsonc`:

  | Setting | Value |
  | --- | --- |
  | Worker name | `vs-resume` |
  | `workers_dev` | `true` |
  | `AI_MODEL_SMART` | `deepseek-v4-flash` |
  | `AI_MODEL_FAST` | `deepseek-v4-flash` |
  | `TYPESAFE_DEFAULT_MODEL` | `jev-latest` |
  | `TAILOR_WORKFLOW` | `resume-tailoring`, class `TailorWorkflow` |

  `AI_BASE_URL` and `TYPESAFE_BASE_URL` are optional proxy overrides. Leave
  them unset to use the provider defaults. `AUTOFILL_ENABLED` and
  `AUTOFILL_JEV_ENABLED` have no readers in the current app and are not
  environment switches.

- [ ] In hosted Supabase Auth, set the Site URL to
  `https://vs-resume.ouyangzongxin.workers.dev` and add
  `https://vs-resume.ouyangzongxin.workers.dev/auth/callback` to Redirect URLs.
  Enable Google and save its OAuth Client ID and Client Secret there.
  In Google Auth Platform, set the authorized JavaScript origin to the app
  URL and the authorized redirect URI to
  `https://gbwyxuqprtumutqmluju.supabase.co/auth/v1/callback`.
  [Google OAuth setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

- [ ] Link the hosted database and review pending migrations:

  ```bash
  supabase login
  supabase link --project-ref gbwyxuqprtumutqmluju
  supabase db push --dry-run
  ```

  After reviewing the preview, apply them:

  ```bash
  supabase db push
  supabase migration list
  ```

  These commands apply the repository's schema, grants, RLS policies, and
  Realtime publication changes. Configure hosted Auth separately; local
  `supabase/config.toml` retains the development URLs.
  [Supabase migration workflow](https://supabase.com/docs/guides/local-development/cli-workflows).

## Release

- [ ] Run static checks and existing tests:

  ```bash
  bun run typecheck
  bun run check
  bun run test
  ```

- [ ] Build and inspect the deployment package:

  ```bash
  bun run deploy:check
  ```

  Confirm the output names `vs-resume` and includes the `TAILOR_WORKFLOW`
  binding. This command rebuilds before the dry run. Use it after changing
  environment values or the Worker configuration.

- [ ] Publish the production web app:

  ```bash
  bun run deploy:web
  ```

- [ ] Open `/login`, complete Google sign-in, create a resume, edit and
  reload it, download a PDF, and accept an AI suggestion. Check the resulting
  version and sign out. If login still returns HTTP 500, inspect Worker
  errors before proceeding with the release.

For Cloudflare Builds, configure the public variables in the build settings
because gitignored `.env.production.local` files are absent from a clean
checkout. Runtime secrets remain attached to the Worker.
[Build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Production logs

Deploy the logging changes through the release steps above. They take effect
for new requests after deployment; they cannot recover details discarded by
an older release. No additional logging service or secret is required.

In Cloudflare, open **Workers & Pages > vs-resume > Observability** to search
stored logs. The Worker persists invocation and application logs at a sampling
rate of `1` (all requests, subject to Cloudflare limits). Application events
are structured objects, so their fields can be filtered individually.
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

To watch new production requests from the repository root:

```bash
bun run logs:prod
```

Use `bun run logs:prod:json` for JSON output. Start the stream before
reproducing the failure. These commands require Wrangler authentication and
only stream new events. Use the dashboard for historical logs. To narrow a
live stream to a particular event:

```bash
bun run logs:prod --search chat_stream_error
```

Avoid `--status error` when investigating handled failures. That flag filters
the Worker invocation outcome, not the HTTP status or console severity, so it
can hide a caught exception that returned HTTP 500 or failed inside an HTTP
200 chat stream. Filter by application `level`, `event`, or `requestId` in
the dashboard instead.
[Wrangler tail](https://developers.cloudflare.com/workers/wrangler/commands/workers/#tail).

Each application response includes `X-Request-Id`. Copy it from the failed
request's response headers in the browser Network panel, then filter stored
logs by `requestId`. A chat stream can return HTTP 200 before it fails, so
check its `chat_stream_error` and `chat_finished` events too. Workflow work
runs in a separate invocation: follow the `operationId` from
`tailoring_dispatched` into `tailoring_step_failed`.

| Field or event | What it tells you |
| --- | --- |
| `requestId`, `cfRay` | Application request and Cloudflare request correlation |
| `procedure` | Server function name or API procedure, such as `updateResume` or `autofill.infer` |
| `http_request` | Response status and time until response headers, not stream completion |
| `server_function`, `shared_api` | Operation duration |
| `request_failed`, `api_failed`, `api_context_failed` | Failure before the error is mapped for the client |
| `chat_stream_error`, `chat_finish_failed`, `background_failed` | Streaming, persistence, or background failure |
| `autofill_model_failed` | Model failure captured before the service falls back to rules or questions |
| `tailoring_step_failed` | Durable operation ID, step, elapsed time, and original failure |
| `error.code`, `error.name`, `error.message` | Database/provider code, class, and reviewed diagnostic text |
| `error.status`, `error.retryable`, `error.cause` | Upstream status, retryability, and bounded cause chain |
| `error.stack` | Up to 12 source locations, with the error's raw message removed |

Missing database columns and schema-cache errors retain their schema
identifiers. Missing API-key configuration names the variable. Constraint,
validation, and provider failures use safe summaries, because their original
messages can contain a resume, a database row, or a prompt. Unrecognized
messages are omitted; `error.messageRedacted` records whether the original
message was replaced. Browser error responses remain separate from these
operator diagnostics.

Do not put request/response bodies, headers, tokens, model output, job URLs,
resume text, or arbitrary error messages into log metadata. Pass exceptions
as the logger's third argument, for example
`log.error("import_failed", { charCount }, error)`, so `server/log-error.ts`
controls serialization. That module never copies provider response bodies,
PostgREST details or hints, or validation input. Cloudflare's
`redact_query_string` setting also removes query strings from its request URL
logs and traces, including OAuth codes and server-function inputs.

Server source maps are generated in Vite's `ssr` environment and uploaded
by Wrangler. Client source maps are not enabled. Cloudflare uses uploaded
maps for captured exception stacks; `error.stack` in an application log is
a string of bundled source locations and is not automatically remapped.
Keep the matching server build artifacts when investigating those locations.
[Source maps](https://developers.cloudflare.com/workers/observability/source-maps/).

## Extension release

- [ ] Set a stable `VITE_EXTENSION_PUBLIC_KEY` in
  `apps/extension/.env.production.local`, or establish the final Web Store ID.
  Record the actual extension ID after building and loading it.
- [ ] Set `vars.EXTENSION_ORIGINS` in `apps/web/wrangler.jsonc` to
  `chrome-extension://<extension-id>`, using commas for multiple exact IDs.
  Fill this allowlist before connecting the extension to production.
- [ ] Add `https://<extension-id>.chromiumapp.org/auth/callback` to the
  hosted Supabase Redirect URLs, then redeploy the updated Worker config.
- [ ] Run `bun run build:extension`, reload the extension, connect the
  production account, and verify tailoring and autofill against the
  production backend. Development and production builds share
  `apps/extension/dist`; reload after switching modes.

The [extension guide](extension/README.md) covers loading and manual acceptance.
