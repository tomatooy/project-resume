# AGENTS.md

Baseline guidance for coding agents working in this repository. These instructions
override default behavior. Follow them exactly.

VS:Résumé is an AI resume builder. A user keeps structured (JSON) resumes,
edits them in a form editor beside a live PDF preview, and asks an AI assistant
to improve them. The assistant never edits the resume directly: it proposes
validated patches, the user accepts or rejects them, and accepted patches are
applied as a new immutable version. The resume is the first-class citizen;
conversations, suggestions, versions, and memory all hang off it.

## Working principles

- **Understand before you change.** Trace how a feature is wired before
  editing: schema (`packages/resume-schema`) -> store and actions
  (`apps/web/src/features/resume`) -> editor/preview/chat UI -> data layer
  (`apps/web/src/lib/api`). Match existing structure and conventions rather
  than inventing new ones.
- **Follow established patterns.** The codebase has consistent idioms: patches
  as the single mutation path, TanStack Store for the live document, TanStack
  Query for server state, and Zod schemas as the source of truth. New code
  should look like the code already there.
- **Reuse over duplication.** Check `packages/ui` for shared primitives and
  existing feature components before writing a new one. Extend or refactor
  into a shared component rather than forking a near-identical copy.
- **Avoid em dashes in text.** When generating any text (user-facing copy,
  prompts, or docs), use commas, sentence breaks, or parentheses instead of the
  em dash (`—`). Do not insert `—` into generated text.
- **Keep comments terse.** Comments are read mainly by agents, not humans.
  Prefer a short fragment over a sentence, one line over several. Comment only
  what the code cannot say itself: non-obvious intent, invariants, workarounds,
  upstream quirks. This repo's comments explain the why (why a document
  replace, why two saves must not overlap), never restate the next line.

## Toolchain

- Use **Bun** for package management and script execution (`bun`, `bunx`), not
  npm/pnpm/yarn. `packageManager` is `bun@1.3.14`.
- Lint and format are **Biome only** (`biome.json`, schema 2.5.11). There is
  no Prettier and no ESLint; those configs were removed from the repo.
- Do **not** run `build` after writing code. The user runs it manually.
- Biome version pitfall: a Homebrew global `biome` (2.4.16) shadows the
  workspace `@biomejs/biome` (2.5.11). Always go through `bun run format`,
  `bun run check`, or `bunx biome`, never the bare `biome` binary, or the
  config (which uses 2.5.x keys such as `linter.rules.preset`) will fail to
  parse.

## TypeScript and type safety

- Enhance type safety at all times. Never use `any`; avoid `as` and `unknown`
  unless there is genuinely no alternative.
- Prefer inference; define explicit types for function parameters, return
  values, and shared structures.
- Derive types from the Zod schemas in `packages/resume-schema`
  (`z.infer<typeof Schema>`); never redefine document types in the app. The
  schemas use Zod v4 (`z.email()`, `z.url()`).
- `tsconfig` is strict with `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, and `noUncheckedSideEffectImports`.
- Path aliases: `@/*` -> `apps/web/src/*`, `@workspace/ui/*` ->
  `packages/ui/src/*`. `@workspace/resume-schema` and
  `@workspace/resume-render` resolve through their package `exports`.

## Monorepo overview

Bun workspaces + Turborepo.

- `apps/web`: the app (TanStack Start + Vite 8 + React 19 + TypeScript 6).
- `packages/resume-schema`: the Zod document schema, node ids, the patch
  contract (`applyPatches` / `validatePatches`), fixtures, migrate, diff, hash,
  and format helpers. Deps: `zod` + `nanoid` only. No React, no Supabase, no
  AI SDK.
- `packages/resume-render`: react-pdf templates and fonts. Depends on
  `resume-schema`. Re-exports `pdf` and `usePDF` so the app never imports
  `@react-pdf/renderer` directly.
- `packages/ui`: shadcn on Base UI components, the `cn` helper, and the
  `globals.css` design tokens. Import via `@workspace/ui/components/*`,
  `@workspace/ui/lib/utils`, and `@workspace/ui/globals.css`.
- `packages/eslint-config`, `packages/typescript-config`: shared config
  (legacy; the app is moving off eslint).

Dependency direction (arrows point at dependencies):

```text
apps/web -> packages/ui
apps/web -> packages/resume-schema
apps/web -> packages/resume-render -> packages/resume-schema
packages/resume-schema -> (nothing internal)
```

## Architecture: target vs current

The specs in `docs/specs/` (`over-all-design.md`, `front-end.md`,
`back-end.md`) define the **target**: a single Cloudflare Worker (TanStack
Start SSR + server functions + `POST /api/chat`), Supabase Postgres + Auth with
Row Level Security, the Vercel AI SDK for model orchestration, and three-layer
memory. Read `over-all-design.md` first; the other two are its implementation
detail.

The current code implements that target end to end:

- `apps/web/src/lib/api.ts` is the browser's data layer. Each function wraps a
  server function from `apps/web/src/server/fns/` (`listResumes`, `getResume`,
  `updateResume`, `listVersions`, `decideSuggestions`, and so on) or, for chat
  history, the `GET /api/chat` route. Nothing above `api.ts` knows about
  Supabase.
- Server functions are `createServerFn({ method }).validator(schema)
  .handler(serve(({ services, log, data }) => ...))`. `serve`
  (`server/handler.ts`) builds a per-request Supabase client from the session
  cookie, runs `requireUser`, builds the services from `server/container.ts`,
  and maps anything thrown through `server/errors.ts`. `data` is typed from
  the validator; the handler never sees the database client. Every table has
  RLS and there is no service-role key; the database is the authorization
  boundary.
- `server/errors.ts` is the one error mapper for server functions and the chat
  route. A request that fails its schema goes through `parseRequest` and is
  VALIDATION 400; a Zod error from anywhere else is a stored row that no
  longer parses, and is INTERNAL 500. The chat route's request and response
  shapes live in `server/chat/contract.ts` and are what `lib/types.ts`
  re-exports to the panel.
- Domain logic lives in `packages/resume-core` (types from Zod, ports, services,
  in-memory doubles for every port). The composition root is split at the port
  seam: `createServices(ports)` in `resume-core` says how the services hang
  off the ports, and `supabasePorts(db, userId)` in
  `apps/web/src/server/container.ts` says which Supabase adapter fills each
  one. Tests hand `inMemoryPorts()` from `resume-core/testing` to the same
  `createServices`. `Services` holds services only; the message and
  conversation ports sit behind `MemoryService`.
- `packages/agent` holds everything that touches the AI SDK: prompts, tools,
  the run loop (`turn.ts`), the summarizer, and message conversion. Its entry
  point and `resume-schema`'s are curated by hand; add an export only when a
  consumer outside the package needs it. Dependency direction is `web -> agent
  -> resume-core -> resume-schema`.
- The assistant is `POST /api/chat` (`server/chat/handle-chat.ts`) consumed by
  `useChat` (`features/chat/use-assistant.ts`). The handler opens the run
  and streams; what happens once the turn ends (transcript row, run row, log
  line, consolidation) is `server/chat/run-lifecycle.ts`, tested on its own.
  Messages are stored in Postgres and rehydrated on load; the client sends
  only the last two messages. `check_fit` is a client tool: the browser renders the PDF, answers
  with the page count, and the same run resumes. Models come from DeepSeek
  through `packages/agent/src/models.ts`; the key is `DEEPSEEK_API_KEY` in
  `apps/web/.dev.vars` locally and a Wrangler secret in production.

Where the code and the spec diverge, the code is the current reality. The
specs' template section is the most obvious drift: it names three templates
(`modern`, `classic`, `compact`), but the code ships six (`lisbon`, `meridian`,
`plainsong`, `harbor`, `ledger`, `atlas`). Do not "fix" the code toward a stale
spec detail; when the back end is built, follow the spec while keeping the
code's established front-end conventions.

## State and data flow

Live document state:

- One `ResumeSession` (`features/resume/store.ts`) per open resume, wrapping a
  TanStack Store. `ResumeSessionProvider` (`features/resume/session-context.tsx`)
  owns it, keyed on the resume id so switching resumes mounts a fresh session.
  Access it via `useSession()` and `useResumeState(selector)`.
- Every mutation, a keystroke or an accepted suggestion, is a patch through
  `session.apply` -> `applyPatches` (resume-schema). One mutation path means
  undo is just the inverse patches `applyPatches` returns. Editor gestures are
  thin patch builders in `features/resume/actions.ts`.
- Undo/redo via `session.undo` / `session.redo`; Cmd/Ctrl+Z and Shift+Z are
  bound in the edit route. Consecutive edits to one field coalesce into one
  undo entry.

Autosave (`ResumeSession.save`):

- 800ms debounce after the last mutation. Calls `updateResume` with
  `expectedUpdatedAt` as the optimistic-concurrency token.
- Conflict (409): `saveStatus = "conflict"`; a banner offers Reload / Overwrite.
- Network error: `saveStatus = "error"`; backoff retry (1s to 30s), keep editing.
- `hasFieldErrors` or a schema-invalid document pauses autosave; the status bar
  shows "Fix errors to save".
- `beforeunload` warns when not saved.

Server state (TanStack Query):

- `lib/queries.ts` is the one module for server state: `queryOptions`
  factories (`resumesQuery`, `resumeQuery`, `versionsQuery`, `messagesQuery`,
  and so on) hold key, fetcher, and stale policy together, and mutation hooks
  (`useDuplicateResume`, `useRestoreVersion`, `useDecideSuggestions`, and so
  on) own their invalidation. Screens add toasts and navigation through the
  per-call `mutate(vars, { onSuccess })`. Loaders use
  `queryClient.ensureQueryData(resumeQuery(id))`; nothing outside this file
  spells a query key.
- `ResumeSession` takes its api and clock as constructor options
  (`SessionApi`, `Clock`), so `store.test.ts` drives it with fakes rather than
  mocking `lib/api`.
- `getRouter` (`router.tsx`) sets `refetchOnWindowFocus: false` and
  `staleTime: 30_000`: once loaded, the store is authoritative.

## Schema-first data layer

- `packages/resume-schema/src/schema.ts`: `Resume` = `{ schemaVersion: 1,
  basics, sections[] }`. Node kinds are section, item (experience / education /
  project / skills / custom), bullet, link, plus the fixed `basics` node. A
  section type holds a matching item kind (`SECTION_ITEM_KIND`). Node ids must
  be unique across the document.
- `packages/resume-schema/src/ids.ts`: `newId(prefix)` returns
  `${prefix}_${nanoid(10)}`; prefixes `sec`, `exp`, `edu`, `prj`, `skl`, `cus`,
  `bul`, `lnk`. `basics` is the one fixed, unprefixed id. `regenerateIds`
  deep-copies with fresh ids (used by duplicate).
- `packages/resume-schema/src/nodes.ts`: `indexNodes`, `findNode`, `breadcrumb`
  ("Experience > Acme > bullet 2"), `textFields` (what `replace_text` may
  target), `collectText`, `isWithin`.
- `packages/resume-schema/src/patch.ts`: the patch contract. Five ops
  (`replace_text`, `update_fields`, `insert_after`, `delete`, `move`), each
  addressed by node id and carrying `before` for grounding. `applyPatches` is
  pure, applies in order on a structural copy, and reports inverses.
  `validatePatches` is the deterministic gate: shape, tier, target exists,
  scope, field allowed, `before` matches, move bounds, non-empty text, and the
  whole-set dry run. It runs on the server before persisting and again at
  accept time against the current head. It does not read numbers: a figure the
  model adds is a proposal the user confirms, not something the validator
  refuses. `structuralReason` and `addedFigures` are the two pure helpers the
  panel recomputes on, so a card's destructive treatment and its estimate note
  come from the same code the server gates with.
- `packages/resume-schema/src/{format,diff,hash,migrate}.ts`: `formatRange`,
  `diffDocuments` (History compare), `contentHash` / `canonicalJson` (Web
  Crypto, used for version dedupe), `migrateResume` (schema upgrades).
- `packages/resume-schema/src/fixtures/`: `starter` plus minimal/one-page and
  other fixtures, used by template tests and seeding.

## Editor (`/r/:resumeId/edit`)

- Layout in `features/resume/editor/`: `SectionRail` (left nav, Add section,
  side-panel toggles), `EditorPane` (routes the active pane to Contact, Summary,
  or a `SectionPane`), `SectionPane` (items as sortable `ItemCard`s),
  `SortableRow` / `SortableList` (dnd-kit), `BulletList`, `ItemCard`, and
  `SaveBar` (save status + undo/redo + "Save version").
- Fields are custom primitives in `features/resume/editor/fields.tsx`
  (`TextInput`, `TextAreaInput`, `MonthInput`, `EndDateInput`, `ChipInput`),
  not the shadcn form components. They write straight to the store on every
  keystroke; there is no local form state.
- Validation runs against the per-node Zod schemas (`validateNode` in
  `editor/validate.ts`); errors render under the field, invalid values still
  reach the store (so the preview stays live), and autosave is paused while
  invalid.
- Node selection: focusing a field or clicking an item sets
  `selectedNodeId`, which scopes AI requests; Escape clears it.
- Reordering dispatches a `move` patch. Cross-container moves are not supported.
- Adding a top-level section is a whole-document replace
  (`session.replaceDocument`), because a section has no parent for
  `insert_after` to target.

## Preview and PDF

- `packages/resume-render` renders with `@react-pdf/renderer` (Yoga flexbox, no
  CSS). Six templates: `lisbon` (default), `meridian`, `plainsong`, `harbor`,
  `ledger`, `atlas`. `ResumeDocument` resolves the template id and falls back
  to `lisbon` on unknown ids.
- Naming trap: `@react-pdf/renderer` and `react-pdf` both export `Document` and
  `Page`. The renderer is imported only inside `packages/resume-render`; the
  viewer only inside `features/resume/preview/PdfViewer.tsx`. `resume-render`
  re-exports `pdf` and `usePDF`; the app imports those, never the renderer.
- Pipeline: `PdfEngine` (lazy, client-only, mounted by `PreviewProvider`) ->
  300ms debounce -> `ResumeDocument` -> `usePDF` -> blob -> `PdfViewer` (lazy,
  pdf.js). The previous blob is kept while a new render is in flight so the
  viewer never blanks. `previewPatches` (a hovered suggestion) are applied to a
  copy before rendering.
- `checkFit` (`preview/check-fit.tsx`) renders a one-off blob with
  `pdf().toBlob()` off the main pane and reads the page count back with pdf.js;
  the assistant's page-target skill uses it. It never throws; a failed render
  returns `ok: false`.
- Download reuses the preview blob (export is free); the filename is
  `${slug(basics.name)}-resume.pdf`.

## Chat / assistant (`features/chat`)

- The playbook library lives in `packages/agent/src/skills`: the built-in six
  (`library.ts`, assembled from `catalog.ts` rows and `playbooks/*.ts` bodies)
  plus a per-user overlay stored in `user_skills` / `user_disabled_skills`.
  `merge.ts` is the one place the two meet: `mergeSkills(overlay)` returns
  built-ins first then the user's own, `resolveSkills(overlay)` is the library
  a turn and the prompt index read, and a custom body is wrapped there as
  untrusted guidance. A playbook is prompt text only: no ops, no field
  whitelists, no authority, whichever tier it came from. The client reads
  `listSkills` (a server function) and never a catalog module; built-in bodies
  reach the model through `load_skill`'s `toModelOutput` and never the browser.
- The rail (`features/shell/ResumeRail.tsx`) carries two lists and the switch
  between them at its foot. Resumes on every route, the playbook library on
  `/skills`; the mode is the route, so the switch is a link rather than layout
  state. `SkillsRail.tsx` is the library list: Editor (Default, then Custom)
  and Interview, each row opening the skill's tab with a `Switch` beside it.
- `/skills` (`features/skills/`) is that library. The route is a layout with
  its own tab strip, like a resume's: an `All skills` tab in
  `_app.skills.index.tsx`, plus a closable tab per skill in
  `SkillTabs.tsx` / `_app.skills.$skillId.tsx`. A new skill is that same
  `SkillForm` on an empty draft, with `Upload SKILL.md` in its header
  (`ImportSkillDialog`) filling the form from a file without saving; a custom
  skill can be deleted from the tab or from its library row, both through
  `DeleteSkillDialog`. A built-in opens the
  read-only `SkillDetail` because its body never leaves the server, and an id the library
  no longer holds offers to close its tab. Which tabs are open is React state
  in `features/skills/workspace.tsx`, so it is per-request on the server; the
  tab itself is a URL. `useSkillNames()` in `lib/queries.ts` resolves
  attribution for ids whose skill was removed.
- `use-assistant.ts` wraps `useChat`: sends skill inputs in the request body,
  answers `check_fit` from `onToolCall` (never awaited inside it), keeps the
  suggestion status map beside the transcript, and maps route errors (401 to
  `/login`, others to a toast).
- `AssistantPanel` is the header and the conversation loader; `Composer` is
  the skill picker, its inputs and the send box; `Transcript` renders each
  assistant message part by part: text as it streams, `tool-check_fit` as a
  fit chip, `tool-propose_patches` output as `SuggestionCard`s. A card shows a word
  diff (`replace_text`), a field table (`update_fields`), a summary
  (insert/delete/move), and the patch's reason. A pending card also names any
  figure the patch adds that the resume does not state (`addedFigures`), so an
  estimate is confirmed before it lands. Hovering a card sets
  `session.previewPatches` so the preview shows the effect.
- Accept/reject calls `decideSuggestions`, which applies accepted patches,
  snapshots a version (`created_by: "agent"`), and returns the new head;
  `session.replaceHead` swaps it in. Patches that no longer match come back
  `stale` ("Outdated").

## Versions, history, export, interview

- Versions are created when the user accepts suggestions (agent), clicks
  "Save version" (user), or restores an older version (user). Autosave never
  creates a version. `VersionService.snapshot` dedupes by content hash.
- History (`features/history/HistoryScreen.tsx`) lists versions, diffs the
  selected version against the head via `diffDocuments`, and restores.
- Export (`features/export/ExportScreen.tsx`): PDF is live; DOCX, TXT, and JSON
  are stubbed "not in this release". `Preflight` lists flags.
- Interview (`features/interview/InterviewScreen.tsx`): fixed demo content; no
  generator behind it yet.
- Flags (`features/resume/flags.ts`): the one automated judgement is a bullet
  with no number ("no measurable outcome"). Counts surface in the section rail.

## UI development

- Keep UI consistent. Components live in `packages/ui` (shadcn on Base UI, not
  Radix). Use `cn` from `@workspace/ui/lib/utils`.
- Before building or reviewing UI, check `packages/ui` for an existing
  component first. If none fits, check shadcn and install its Base UI component
  into `packages/ui`. Prefer composing or extending these shared primitives;
  only hand-roll a component when neither provides a suitable foundation.
- Tailwind v4 tokens come from `@workspace/ui/globals.css`. Use semantic
  tokens (`bg-background`, `bg-card`, `border-border`, `text-muted-foreground`,
  `text-primary-text`, `text-warning`) and opacity modifiers (`bg-primary/10`,
  `bg-success/10`) rather than hardcoding colors or adding per-panel tokens.
  Follow `docs/design/style-colors.md` for color roles and reuse rules.
- Add shadcn components via the shadcn MCP (`.mcp.json`) or
  `bunx shadcn@latest add <component> -c apps/web`; they land in `packages/ui`.
- Do not use Tailwind or CSS inside resume templates; react-pdf cannot see it.
  Templates use react-pdf `StyleSheet` and the `tokens.ts` palette.

## Common commands (run from repo root)

- Install: `bun install`
- Dev (port 3000): `bun run dev`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Format: `bun run format`
- Check/fix (Biome): `bun run check`
- Tests (`resume-schema`, `resume-render`, `resume-core`, and `agent` carry
  Vitest suites): `cd packages/resume-schema && bun test` (and the same for the
  other three), or `bun run test` at the root.

## Verifying changes

- **Do not use browser automation to verify UI changes.** No Claude in Chrome
  (`mcp__claude-in-chrome__*`), Puppeteer, Playwright, headless Chrome, or
  Chrome DevTools MCP to visually confirm a change. The user verifies UI
  manually; after a UI change, stop and say what to look at (route, section,
  and what should have changed). Do not start a dev server or click through
  flows to prove it works.
- Verify with static checks instead: `bun run typecheck`, `bun run lint`
  (`bun run check`), and reading the code. Cheap and catches the errors that
  matter here.
- Exception: only drive a browser if the user explicitly asks for it in that
  message.

## Cross-cutting notes

- Errors: `ApiError` (`lib/types.ts`) with codes `UNAUTHENTICATED`,
  `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `RATE_LIMITED`, `INTERNAL`. Server
  functions map to these.
- Privacy: resume data is sensitive. Never write document content, message
  content, or patch text to logs, traces, or analytics (see
  `over-all-design.md` section 9).
- Design-sync artifacts: `.design-sync/`, `.ds-sync/`, `ds-bundle/`, and
  `packages/ui/.ds-css/` are generated by the claude.ai/design sync tooling.
  Do not hand-edit them.
