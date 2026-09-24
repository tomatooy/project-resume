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
- Target back end: a single Cloudflare Worker + Supabase (Auth + RLS) + the
  Vercel AI SDK (see `docs/specs/`)

The app currently runs its data layer against a local mock store
(`apps/web/src/lib/mock-store.ts`); `apps/web/src/lib/api.ts` mirrors the
spec's server functions so the swap to a real back end stays contained.

## Layout

```text
apps/web                 TanStack Start app
packages/resume-schema   Zod document schema, patch contract, fixtures
packages/resume-render   react-pdf templates and fonts
packages/ui              shadcn/Base UI components and design tokens
docs/specs               over-all, front-end, and back-end specs
```

## Getting started

```bash
bun install
bun run dev      # starts Supabase (Docker) then http://localhost:3000
```

Typecheck and lint:

```bash
bun run typecheck
bun run check
```

Tests (schema and render packages):

```bash
cd packages/resume-schema && bun test
cd packages/resume-render && bun test
```
