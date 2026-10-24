# VS:Résumé

An AI resume builder and optimization assistant. You keep one or more
structured resumes, edit them in a form-based editor beside a live PDF preview,
and ask an AI assistant to improve them. The assistant never edits the resume
directly: it proposes validated patches, you review them as diffs, and only
accepted patches are applied, each creating a new immutable version.

## Features

- Form editor for every resume section, with drag to reorder and autosave
- Live PDF preview through interchangeable templates (six shipped)
- One-click PDF export (the download is the exact preview blob)
- AI assistant with explicit skills: rewrite bullets, match a job description,
  grammar and clarity, cut to a page target, quantify impact, and a technical
  resume pass. Suggestions arrive as accept/reject cards, and a pending card
  names any figure the resume does not already state, so an estimate is
  confirmed rather than absorbed.
- Version history with compare and restore

## Stack

- TanStack Start + Vite + React 19, TypeScript (strict)
- Bun workspaces + Turborepo
- Tailwind v4 + shadcn on Base UI (`packages/ui`)
- `@react-pdf/renderer` for templates, pdf.js for the viewer
- Zod schemas as the source of truth (`packages/resume-schema`)
- Back end: a single Cloudflare Worker + Supabase (Auth + RLS) + the
  Vercel AI SDK (see `docs/specs/`)

The app's data layer calls server functions on the Worker. Supabase stores
resumes, versions, conversations, and suggestions, with each request authorized
by the signed-in user's session and Row Level Security.

## Layout

```text
apps/web                 TanStack Start app
packages/resume-schema   Zod document schema, patch contract, fixtures
packages/resume-render   react-pdf templates and fonts
packages/openai          standalone server-side OpenAI Decisions client
packages/ui              shadcn/Base UI components and design tokens
docs/specs               over-all, front-end, and back-end specs
```

## Getting started

```bash
bun install
bun run dev      # local services and web app at http://localhost:3002
```

Copy `.env.local.example` to `.env.local` and fill in the local Supabase and
Google OAuth settings before starting the app. `bun run dev:web` starts only
the web app when local Supabase is already running.

Server keys go in `apps/web/.dev.vars` locally and in Wrangler secrets in
production (see `.env.local.example`): `DEEPSEEK_API_KEY` for every AI
feature, and `TYPESAFE_API_KEY`, which autofill requires for its Jev
decisions. Without the TypeSafe key, autofill falls back to rules and plain
questions.

The standalone [OpenAI Decisions package](packages/openai/README.md) uses an
optional `OPENAI_API_KEY` with the same server secret setup. It is available
alongside Jev and has no product callers yet.

Typecheck and lint:

```bash
bun run typecheck
bun run check
```

Tests:

```bash
bun run test
```

## Cloudflare CLI

Wrangler is installed as a development dependency of `apps/web` by
`bun install`. Run it from the repository root through `bun run cf`:

```bash
bun run cf --version
bun run cf login
bun run cf whoami
```

Login opens your browser for Cloudflare authorization. Wrangler stores the
login on your machine, outside this repository. If you belong to multiple
accounts, set `CLOUDFLARE_ACCOUNT_ID` in your shell to the account ID shown
by `whoami` for the account you intend to use.

The shortcut runs in `apps/web`, using the `vs-resume` Worker configured
in `apps/web/wrangler.jsonc`. After a build it also lets Wrangler find the
generated deployment configuration from the Cloudflare Vite plugin.
The production URL is `https://vs-resume.ouyangzongxin.workers.dev`.

Production secrets are separate from the gitignored `apps/web/.dev.vars`.
When preparing a deployment, enter each secret at Wrangler's prompt:

```bash
bun run cf secret put DEEPSEEK_API_KEY --name vs-resume
bun run cf secret put TYPESAFE_API_KEY --name vs-resume
bun run cf secret put TAILOR_ENCRYPTION_KEY_V1 --name vs-resume
bun run cf secret list --name vs-resume
```

The tailoring key must be base64 encoding of exactly 32 random bytes. Reuse
an existing production key while tailoring attempts are in flight. See
[extension setup](docs/extension/README.md) for `EXTENSION_ORIGINS`, workflow,
and database requirements. `OPENAI_API_KEY` is optional.

Development uses root `.env.local`. Production builds use root
`.env.production.local`, which overrides the development values. Copy
`.env.production.example` to prepare that file on a new checkout. Bun's
automatic dotenv loading is disabled so Vite selects the files for its mode.
Explicit shell variables still take precedence.

Run these from the repository root:

```bash
bun run dev:web          # local app and database
bun run build:web        # production build only
bun run deploy:check     # production build and Wrangler dry run
bun run deploy:web       # production build and deployment
```

Set the production `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the build environment first. Vite
inlines these values. Production builds reject missing public configuration,
HTTP URLs, and loopback hosts. Hosted Supabase and Google Auth settings are
configured separately in their dashboards.

Follow the [deployment checklist](docs/deployment.md) for the environment
matrix, remaining account settings, and release commands. For the extension,
use `bun run dev:extension` or `bun run build:extension:dev` locally and
`bun run build:extension` for production.

References: [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/#login)
and [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/get-started/).
