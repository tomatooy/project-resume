# Back-end Spec

Spec version 1.0, 2026-09-01. Read `over-all-design.md` first. This document defines the runtime, data model, shared schema package, patch contract, server functions, the chat route, the agent package, memory, and operations.

---

## 1. Runtime and deployment

### 1.1 Single Worker

One Cloudflare Worker serves SSR, server functions, and the chat route. There is no separate API service in the MVP.

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
})
```

`apps/web/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "resume-app",
  "main": "@tanstack/react-start/server-entry",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [{ "binding": "RATE_LIMIT", "id": "<set per environment>" }],
  "vars": {
    "PUBLIC_APP_NAME": "Resume Assistant",
    "AI_GATEWAY_BASE_URL": "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>"
  },
  "observability": { "enabled": true }
}
```

Secrets (set with `wrangler secret put`, never in `vars`):

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY      anon/publishable key; safe for the browser but read from env on the server
ANTHROPIC_API_KEY
OPENAI_API_KEY
AI_GATEWAY_TOKEN              if the gateway is configured with authentication
```

There is no service-role key anywhere in the Worker.

Bindings are read with `import { env } from 'cloudflare:workers'` inside server code. Plain string configuration is also available as `process.env.*` in server functions.

### 1.2 Environments

| Env | Supabase | Worker | Model |
|---|---|---|---|
| local | `supabase start` (Docker) | `wrangler dev` via `vite dev` | real gateway, or `AI_MOCK=1` |
| preview | branch database (Supabase branching) or a shared staging project | `wrangler versions upload` | real gateway with a low rate limit |
| production | production project | `wrangler deploy` | real gateway |

---

## 2. Authentication

### 2.1 Server client

`apps/web/src/server/auth/supabase.ts`

```ts
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import type { Database } from '@workspace/supabase'

export function createSupabaseForRequest(request: Request, responseHeaders: Headers) {
  return createServerClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '')
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          responseHeaders.append('Set-Cookie', serializeCookieHeader(name, value, options))
        }
      },
    },
  })
}
```

In server functions, `request` and response headers come from `getRequest()` and `setResponseHeader` in `@tanstack/react-start/server`. A helper `withSupabase()` wraps both.

### 2.2 Requiring a user

```ts
export async function requireUser(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) throw new AppError('UNAUTHENTICATED', 401)
  return { userId: data.claims.sub as string }
}
```

`getClaims()` verifies the JWT (locally when the project uses asymmetric keys, otherwise via the auth server) and refreshes the session cookie when needed. Every server function and the chat route call `requireUser` first.

### 2.3 Auth routes

- `GET /auth/callback?code=...&next=...`: `supabase.auth.exchangeCodeForSession(code)`, then redirect to `next` (validated to be a same-origin path) or `/dashboard`.
- `POST /logout`: `supabase.auth.signOut()`, redirect to `/login`.

### 2.4 Authorization model

Every query runs through the per-request client carrying the user's JWT, so Postgres RLS enforces ownership. Handlers do not add ownership checks of their own except where a write must reference a row from another table (the policy handles that too, via joins in the policy expression). If a query returns zero rows because of RLS, the handler returns `NOT_FOUND` (404), never a distinguishable 403.

---

## 3. Database

Supabase Postgres. Migrations live in `supabase/migrations/` and are applied with the Supabase CLI. Types are generated to `supabase/types/database.ts` with `bun run db:types` and imported as `@workspace/supabase`.

### 3.1 Schema

```sql
create extension if not exists "pgcrypto";

create type created_by_kind as enum ('user', 'agent', 'system');
create type message_role as enum ('user', 'assistant', 'system');
create type run_status as enum ('running', 'completed', 'failed', 'cancelled');
create type suggestion_status as enum ('pending', 'accepted', 'rejected', 'stale');
create type patch_op as enum ('replace_text', 'update_fields', 'insert_after', 'delete', 'move');

create table resumes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  title               text not null,
  data                jsonb not null,                 -- working head, validated Resume document
  schema_version      int  not null default 1,
  template_id         text not null default 'modern',
  template_options    jsonb not null default '{"pageSize":"A4","fontScale":1}',
  current_version_id  uuid,                           -- fk added after resume_versions exists
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create table resume_versions (
  id              uuid primary key default gen_random_uuid(),
  resume_id       uuid not null references resumes(id) on delete cascade,
  version_no      int  not null,
  content         jsonb not null,
  schema_version  int  not null,
  content_hash    text not null,                      -- sha256 of canonical JSON
  label           text,
  created_by      created_by_kind not null,
  agent_run_id    uuid,                               -- fk added after agent_runs exists
  created_at      timestamptz not null default now(),
  unique (resume_id, version_no)
);

alter table resumes
  add constraint resumes_current_version_fk
  foreign key (current_version_id) references resume_versions(id) deferrable initially deferred;

create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  resume_id          uuid not null references resumes(id) on delete cascade,
  title              text,
  active_summary_id  uuid,                            -- fk added after memory_summaries exists
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (resume_id)                                  -- one conversation per resume in the MVP
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  seq              bigint generated always as identity,
  role             message_role not null,
  content          jsonb not null,                    -- UIMessage parts (text, tool parts)
  agent_run_id     uuid,
  metadata         jsonb not null default '{}',       -- skillId, selectedNodeId, tokens
  created_at       timestamptz not null default now()
);
create index messages_conversation_seq on messages(conversation_id, seq);

create table memory_summaries (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  summary          jsonb not null,                    -- MemorySummary (section 9.2)
  summary_text     text not null,
  source_from_seq  bigint not null,
  source_to_seq    bigint not null,
  model            text not null,
  created_at       timestamptz not null default now()
);

alter table conversations
  add constraint conversations_active_summary_fk
  foreign key (active_summary_id) references memory_summaries(id) deferrable initially deferred;

create table agent_runs (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  resume_id           uuid not null references resumes(id) on delete cascade,
  resume_version_id   uuid not null references resume_versions(id),
  skill_id            text not null,
  model               text not null,
  selected_node_id    text,
  input               jsonb not null default '{}',     -- jobDescription, targetPages (deleted when the run finishes)
  status              run_status not null default 'running',
  error_class         text,
  input_tokens        int,
  output_tokens       int,
  latency_ms          int,
  created_at          timestamptz not null default now(),
  finished_at         timestamptz
);

alter table resume_versions
  add constraint resume_versions_agent_run_fk
  foreign key (agent_run_id) references agent_runs(id);

create table suggestions (
  id              uuid primary key default gen_random_uuid(),
  agent_run_id    uuid not null references agent_runs(id) on delete cascade,
  resume_id       uuid not null references resumes(id) on delete cascade,
  ordinal         int  not null,
  patch           jsonb not null,                     -- validated ResumePatch
  target_node_id  text not null,
  operation       patch_op not null,
  status          suggestion_status not null default 'pending',
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index suggestions_run on suggestions(agent_run_id, ordinal);

-- updated_at trigger on resumes and conversations
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger resumes_updated_at before update on resumes for each row execute function set_updated_at();
create trigger conversations_updated_at before update on conversations for each row execute function set_updated_at();
```

### 3.2 Row Level Security

Enabled on every table. Policies:

```sql
alter table resumes enable row level security;
create policy resumes_owner on resumes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table resume_versions enable row level security;
create policy versions_owner on resume_versions
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()));

alter table conversations enable row level security;
create policy conversations_owner on conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table messages enable row level security;
create policy messages_owner on messages
  for all using (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check   (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()));

alter table memory_summaries enable row level security;
create policy summaries_owner on memory_summaries
  for all using (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check   (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()));

alter table agent_runs enable row level security;
create policy runs_owner on agent_runs
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()));

alter table suggestions enable row level security;
create policy suggestions_owner on suggestions
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()));
```

Soft-deleted resumes (`deleted_at is not null`) are filtered in queries, not in policies.

### 3.3 Database functions

Two operations must be atomic and are implemented as Postgres functions called via `supabase.rpc`, running as the invoking user (`security invoker`) so RLS still applies:

- `create_resume_version(p_resume_id uuid, p_content jsonb, p_schema_version int, p_content_hash text, p_label text, p_created_by created_by_kind, p_agent_run_id uuid) returns resume_versions`: computes `version_no = coalesce(max(version_no),0)+1`, inserts, updates `resumes.current_version_id`, `resumes.data = p_content`, returns the row.
- `decide_suggestions(p_run_id uuid, p_decisions jsonb, p_new_content jsonb, p_content_hash text) returns resume_versions`: updates each suggestion's status and `decided_at`, then calls `create_resume_version` when at least one was accepted. The patch application itself happens in the Worker (section 7.4); the function only persists the result atomically.

---

## 4. Server functions

All in `apps/web/src/server/fns/`. Each is `createServerFn({ method }).validator(zodSchema).handler(...)`. Each handler: `withSupabase` → `requireUser` → service call → plain JSON result. Errors are thrown as `AppError(code, status)` and serialized as `{ error: { code, message } }`.

Error codes: `UNAUTHENTICATED` 401, `NOT_FOUND` 404, `CONFLICT` 409, `VALIDATION` 400, `RATE_LIMITED` 429, `INTERNAL` 500.

### 4.1 `resumes.ts`

| Function | Input | Output |
|---|---|---|
| `listResumes` | none | `ResumeSummary[]` (`id, title, templateId, updatedAt`) sorted by `updated_at desc`, excluding deleted |
| `getResume` | `{ id }` | `{ id, title, data, schemaVersion, templateId, templateOptions, currentVersionId, updatedAt }`; runs `migrateResume` if `schemaVersion` is behind |
| `createResume` | `{ title?, fromResumeId? }` | new `ResumeSummary`; content is the `starter` fixture or a deep copy of the source with all node IDs regenerated |
| `updateResume` | `{ id, data: Resume, expectedUpdatedAt? }` | `{ updatedAt }`; validates `data` with `ResumeSchema`; if `expectedUpdatedAt` is given and differs from the row, throws `CONFLICT` |
| `renameResume` | `{ id, title }` | `{ ok: true }` |
| `setTemplate` | `{ id, templateId, templateOptions }` | `{ ok: true }` |
| `duplicateResume` | `{ id }` | `ResumeSummary` |
| `deleteResume` | `{ id }` | `{ ok: true }` (sets `deleted_at`) |

### 4.2 `versions.ts`

| Function | Input | Output |
|---|---|---|
| `listVersions` | `{ resumeId }` | `{ id, versionNo, label, createdBy, createdAt }[]` |
| `getVersion` | `{ id }` | `{ content }` |
| `createSnapshot` | `{ resumeId, label? }` | version row; content is the current head; no-op returning the current version if `content_hash` equals the current version's hash |
| `restoreVersion` | `{ resumeId, versionId }` | new version row with label `Restored from v{n}`; head replaced |

### 4.3 `conversations.ts`

| Function | Input | Output |
|---|---|---|
| `getOrCreateConversation` | `{ resumeId }` | `{ id }` |
| `listMessages` | `{ conversationId, limit = 100 }` | `UIMessage[]` in `seq` order (converted from `messages.content`) |

### 4.4 `suggestions.ts`

| Function | Input | Output |
|---|---|---|
| `decideSuggestions` | `{ runId, decisions: { suggestionId, status: 'accepted' \| 'rejected' }[] }` | `{ head: Resume, updatedAt, version?: VersionSummary, results: { suggestionId, status }[] }` |

Flow in section 7.4.

### 4.5 `session.ts`

| Function | Input | Output |
|---|---|---|
| `getSession` | none | `{ userId, email } \| null` (does not throw) |

---

## 5. Shared schema package (`packages/resume-schema`)

Zero-dependency except `zod` and `nanoid`. Consumed by the browser, the Worker, templates, and the agent.

### 5.1 Document schema (`src/schema.ts`)

```ts
import { z } from 'zod'

export const NodeId = z.string().regex(/^(basics|sec|exp|edu|prj|skl|cus|bul|lnk)_[A-Za-z0-9_-]{10}$|^basics$/)
export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
export const EndDate = z.union([YearMonth, z.literal('present')])
const Text = z.string().max(2000)
const Short = z.string().max(200)

export const LinkSchema = z.object({ id: NodeId, label: Short, url: z.string().url().max(500) })
export const BulletSchema = z.object({ id: NodeId, text: Text })

export const BasicsSchema = z.object({
  id: z.literal('basics'),
  name: Short.min(1),
  headline: Short.optional(),
  email: z.string().email().optional(),
  phone: Short.optional(),
  location: Short.optional(),
  links: z.array(LinkSchema).max(10),
  summary: Text.optional(),
})

export const ExperienceItemSchema = z.object({
  id: NodeId, kind: z.literal('experience'),
  company: Short.min(1), role: Short.min(1), location: Short.optional(),
  start: YearMonth, end: EndDate,
  bullets: z.array(BulletSchema).max(20),
})
export const EducationItemSchema = z.object({
  id: NodeId, kind: z.literal('education'),
  school: Short.min(1), degree: Short.optional(), field: Short.optional(),
  start: YearMonth.optional(), end: EndDate.optional(),
  bullets: z.array(BulletSchema).max(10),
})
export const ProjectItemSchema = z.object({
  id: NodeId, kind: z.literal('project'),
  name: Short.min(1), url: z.string().url().optional(),
  start: YearMonth.optional(), end: EndDate.optional(),
  bullets: z.array(BulletSchema).max(20),
})
export const SkillsGroupSchema = z.object({
  id: NodeId, kind: z.literal('skills'),
  label: Short.min(1), skills: z.array(Short.min(1)).max(50),
})
export const CustomItemSchema = z.object({
  id: NodeId, kind: z.literal('custom'),
  title: Short.min(1), subtitle: Short.optional(),
  start: YearMonth.optional(), end: EndDate.optional(),
  bullets: z.array(BulletSchema).max(20),
})

export const ItemSchema = z.discriminatedUnion('kind', [
  ExperienceItemSchema, EducationItemSchema, ProjectItemSchema, SkillsGroupSchema, CustomItemSchema,
])

export const SectionType = z.enum(['experience', 'education', 'projects', 'skills', 'custom'])
export const SectionSchema = z.object({
  id: NodeId, type: SectionType, title: Short.min(1),
  items: z.array(ItemSchema).max(50),
}).superRefine((s, ctx) => {
  // items must match the section type (experience -> experience, projects -> project, ...)
})

export const ResumeSchema = z.object({
  schemaVersion: z.literal(1),
  basics: BasicsSchema,
  sections: z.array(SectionSchema).max(20),
}).superRefine((r, ctx) => {
  // all node ids unique across the document
})

export type Resume = z.infer<typeof ResumeSchema>
// plus Section, Item, ExperienceItem, ..., Bullet, Link, Basics
```

### 5.2 IDs (`src/ids.ts`)

`newId(prefix)` returns `${prefix}_${nanoid(10)}` with prefixes `sec, exp, edu, prj, skl, cus, bul, lnk`. `regenerateIds(resume)` returns a deep copy with fresh IDs (used by duplicate). `basics.id` is always the literal `'basics'`.

### 5.3 Node access (`src/nodes.ts`)

```ts
export type NodeKind = 'basics' | 'section' | 'item' | 'bullet' | 'link'
export type NodeRef = { id: string; kind: NodeKind; parentId: string | null; index: number; node: unknown; path: (string | number)[] }
export function indexNodes(resume: Resume): Map<string, NodeRef>
export function findNode(resume: Resume, id: string): NodeRef | undefined
export function breadcrumb(resume: Resume, id: string): string        // "Experience > Acme > bullet 2"
export function textFields(kind: NodeKind, node: unknown): string[]   // fields replace_text may target
```

Text fields by kind: basics `headline, summary`; item `role, company, title, subtitle, name, degree, field, school, label`; bullet `text`; link `label`; section `title`.

### 5.4 Fixtures (`src/fixtures/`)

`starter` (an empty but valid resume with one experience section), `minimal`, `one-page`, `two-page`, `long-bullets`, `unicode`, each exported as a typed constant plus an `expectations.json` with page counts per template.

### 5.5 Migrations (`src/migrate.ts`)

`migrateResume(data: unknown): Resume` upgrades any past `schemaVersion` to the current one and validates. Adding a schema version requires adding a step here and bumping the literal. `getResume` runs it on read; `updateResume` writes the current version.

### 5.6 Utilities

`formatRange(start, end, locale)`, `diffDocuments(a, b): NodeDiff[]` (added, removed, changed nodes by ID, used by History compare), `canonicalJson(resume)` and `contentHash(resume)` (sha256 hex over canonical JSON, via Web Crypto so it runs in both runtimes).

---

## 6. Patch contract (`src/patch.ts`)

### 6.1 Types

```ts
const Common = z.object({
  reason: z.string().max(500),
  skillId: z.string(),
  confidence: z.number().min(0).max(1).optional(),
})

export const ReplaceText = Common.extend({
  op: z.literal('replace_text'),
  targetNodeId: NodeId,
  field: z.string(),                 // must be in textFields(kind)
  before: z.string(),
  after: z.string().min(1),
})

export const UpdateFields = Common.extend({
  op: z.literal('update_fields'),
  targetNodeId: NodeId,
  before: z.record(z.string(), z.unknown()),   // current values of exactly the keys in after
  after: z.record(z.string(), z.unknown()),    // partial node; never id, kind, items, bullets, links
})

export const InsertAfter = Common.extend({
  op: z.literal('insert_after'),
  parentId: NodeId,                            // section (for items), item (for bullets), basics (for links)
  afterNodeId: NodeId.nullable(),              // null inserts at index 0
  node: z.unknown(),                           // new node without id; server assigns id
})

export const Delete = Common.extend({
  op: z.literal('delete'),
  targetNodeId: NodeId,
  before: z.unknown(),                         // the full node, for grounding and inverse
})

export const Move = Common.extend({
  op: z.literal('move'),
  targetNodeId: NodeId,
  toIndex: z.number().int().min(0),            // within the same parent
})

export const ResumePatchSchema = z.discriminatedUnion('op', [ReplaceText, UpdateFields, InsertAfter, Delete, Move])
export type ResumePatch = z.infer<typeof ResumePatchSchema>
export type PatchOp = ResumePatch['op']
```

### 6.2 Apply

```ts
export type ApplyResult = {
  resume: Resume
  applied: { patch: ResumePatch; inverse: ResumePatch; assignedIds?: string[] }[]
  failed: { patch: ResumePatch; code: PatchErrorCode; message: string }[]
}
export function applyPatches(resume: Resume, patches: ResumePatch[], opts?: { stopOnError?: boolean }): ApplyResult
```

Pure. Applies in order on a structural copy; a failing patch is skipped (or stops, with `stopOnError`). `insert_after` assigns IDs with `newId` and reports them. The result document is re-validated with `ResumeSchema`; if validation fails the whole apply returns `failed` for the offending patch with `SCHEMA_INVALID`.

### 6.3 Validate

```ts
export type PatchErrorCode =
  | 'TARGET_NOT_FOUND' | 'PARENT_NOT_FOUND' | 'OP_NOT_ALLOWED' | 'FIELD_NOT_ALLOWED'
  | 'BEFORE_MISMATCH' | 'SCHEMA_INVALID' | 'KIND_MISMATCH' | 'EMPTY_TEXT'
  | 'UNGROUNDED_NUMBER' | 'OUT_OF_SCOPE' | 'INDEX_OUT_OF_RANGE'

export type ValidationContext = {
  allowedOps: PatchOp[]
  allowedFields?: Partial<Record<NodeKind, string[]>>   // narrows textFields per skill
  scopeNodeId?: string                                  // when set, targets must be this node or a descendant
  groundingText: string                                 // user message + job description + all resume text
}
export function validatePatches(resume: Resume, patches: unknown[], ctx: ValidationContext):
  { valid: ResumePatch[]; rejected: { index: number; code: PatchErrorCode; message: string }[] }
```

Rules, in order, per patch:

1. Parse with `ResumePatchSchema`; failure is `SCHEMA_INVALID`.
2. `op` must be in `allowedOps`, else `OP_NOT_ALLOWED`.
3. Target (or parent) must exist, else `TARGET_NOT_FOUND` / `PARENT_NOT_FOUND`.
4. If `scopeNodeId` is set, the target must be that node or inside it, else `OUT_OF_SCOPE`.
5. `replace_text.field` must be in `textFields(kind)` and in `allowedFields[kind]` when given, else `FIELD_NOT_ALLOWED`.
6. `before` must deep-equal the current value (`replace_text` compares the string after trimming and collapsing whitespace), else `BEFORE_MISMATCH`.
7. `insert_after.node` must parse with the child schema for the parent kind, else `KIND_MISMATCH`.
8. `move.toIndex` must be within the parent's array, else `INDEX_OUT_OF_RANGE`.
9. `after` text must be non-empty after trimming, else `EMPTY_TEXT`.
10. **Grounding**: every number token (`/\d[\d,.]*%?/`) in `after` (or in any string of `insert_after.node`) must appear in `before` or in `groundingText`, else `UNGROUNDED_NUMBER`. This is what stops invented metrics.
11. Dry-run `applyPatches` on the accumulated valid list; a failure marks the patch `SCHEMA_INVALID`.

Validation is deterministic and runs in both the Worker (before persisting suggestions, and again at accept time against the current head) and the browser (for `check_fit`).

---

## 7. Services (`apps/web/src/server/`)

### 7.1 `resume/resume-service.ts`

Thin typed wrappers over the `resumes` table used by the server functions in section 4.1. `update` validates with `ResumeSchema`, sets `schema_version`, and performs the `expectedUpdatedAt` check with `update ... where id = ? and updated_at = ?` returning the row (zero rows means conflict).

### 7.2 `resume/version-service.ts`

`snapshot(resumeId, { label, createdBy, agentRunId })`: reads head, computes `contentHash`, compares with current version's hash, returns the existing version if equal, otherwise calls `create_resume_version` RPC.

`restore(resumeId, versionId)`: reads the version content, calls `create_resume_version` with that content and label `Restored from v{n}`.

### 7.3 `chat/run-service.ts`

`startRun({ conversationId, resumeId, skillId, selectedNodeId, model })`:
1. `versionService.snapshot(resumeId, { label: 'Before AI run', createdBy: 'system' })` (no-op if unchanged).
2. Insert `agent_runs` with `status = 'running'` and that `resume_version_id`.
3. Return `{ runId, baseVersion }`.

`finishRun(runId, { status, usage, latencyMs, errorClass })` also clears `agent_runs.input` so job descriptions are not retained beyond the run.

### 7.4 `chat/suggestion-service.ts`

`persistProposal(runId, resumeId, valid: ResumePatch[])`: inserts one `suggestions` row per patch with `ordinal`, returns rows with IDs.

`decide(userId, runId, decisions)`:
1. Load the run and its pending suggestions; unknown IDs or non-pending rows are `VALIDATION` errors.
2. Load the current head.
3. For accepted suggestions in `ordinal` order, run `validatePatches` against the head with the skill's allowed ops and no scope. Any rejected patch is marked `stale` (not accepted) and reported.
4. `applyPatches(head, acceptedValidPatches)`.
5. Call `decide_suggestions` RPC with the statuses, the new content, and its hash. When nothing was accepted, the RPC only updates statuses and returns null.
6. Return `{ head, updatedAt, version, results }`.

### 7.5 `memory/memory-service.ts`

See section 9.

---

## 8. Chat route (`apps/web/src/routes/api.chat.ts`)

```ts
export const Route = createFileRoute('/api/chat')({
  server: { handlers: { POST: handleChat } },
})
```

### 8.1 Request

```ts
const ChatRequest = z.object({
  conversationId: z.string().uuid(),
  resumeId: z.string().uuid(),
  skillId: SkillId.optional(),           // required on a new turn, absent on a client-tool continuation
  selectedNodeId: NodeId.optional(),
  jobDescription: z.string().max(20000).optional(),
  targetPages: z.number().int().min(1).max(5).optional(),
  messages: z.array(z.unknown()),        // UIMessage[] from useChat
})
```

### 8.2 Handler steps

1. `createSupabaseForRequest`, `requireUser`.
2. Parse body with `ChatRequest`; `VALIDATION` on failure.
3. Rate limit: KV key `rl:${userId}:${hourBucket}`; increment; over 60 per hour → 429 with `Retry-After`.
4. Load conversation (must belong to the user and to `resumeId`), the resume head, and the skill from the registry (`UNKNOWN_SKILL` → 400).
5. Determine the turn type from the last UI message:
   - `role: 'user'`: new turn. `skillId` is required (400 `VALIDATION` otherwise). Insert the message row. `startRun`, storing `skill_id`, `selected_node_id`, and the request's `jobDescription` and `targetPages` in `agent_runs.input` (jsonb).
   - `role: 'assistant'` containing tool parts with outputs (client tool continuation): find the run with `status = 'running'` for this conversation (404 if none); read `skillId`, `selectedNodeId`, `jobDescription`, `targetPages` from that run; persist the tool output into the run's pending assistant message (`metadata.pendingParts`); do not start a new run.
6. Build model messages: `[system, ...memoryContext, ...(continuation ? [inFlightAssistantMessage] : [])]` where `memoryContext = buildContext(conversationId)` (section 9.1) and the new user message is included by `buildContext` because it was inserted in step 5.
7. Build the `AgentInput` (section 10.2) and call `runSkill()` from `packages/agent`, passing the tools with server-side `execute` bound to this request (`propose_patches`) and the client-side tool (`check_fit`, no `execute`).
8. Return `result.toUIMessageStreamResponse({ onFinish, consumeSseStream: consumeStream })`.
9. `onFinish({ responseMessage, isAborted })`: insert the assistant message row with all parts, `finishRun` with usage and status (`completed`, `cancelled` if aborted, `failed` on error), then `ctx.waitUntil(memoryService.maybeConsolidate(conversationId))`.

Errors after streaming has started are written as an `error` part; before streaming they are JSON `{ error }` with the status codes from section 4.

### 8.3 Why history is rebuilt server-side

The client sends its full `UIMessage[]` on each request, but the server uses only the last message from it. Everything before that comes from Postgres through the memory service. This keeps the client from being the source of truth for history and lets the server apply the three-layer context policy.

---

## 9. Memory

### 9.1 Context building

`buildContext(conversationId): ModelMessage[]`

1. Load `conversations.active_summary_id`; if present, load the summary.
2. Load the last 12 messages with `seq > summary.source_to_seq` (or the last 12 overall when there is no summary), ordered by `seq`.
3. Return `[ { role: 'system', content: 'Conversation memory:\n' + summary_text } (if summary), ...convertToModelMessages(messages) ]`.

Tool parts in stored messages are kept only as compact text (`[check_fit: 2 pages]`, `[proposed 4 patches, ids ...]`) when converting, to save tokens.

### 9.2 Summary schema

```ts
export const MemorySummary = z.object({
  user_goal: z.string().max(300).optional(),
  resume_focus: z.array(z.string().max(60)).max(10),
  preferences: z.array(z.string().max(120)).max(10),
  decisions: z.array(z.string().max(160)).max(20),
  open_tasks: z.array(z.string().max(160)).max(10),
})
```

`summary_text` is a rendering of the object as short labeled lines, produced by code (not by the model), so it is always consistent with the JSON.

### 9.3 Consolidation

`maybeConsolidate(conversationId)` runs after every completed run (in `waitUntil`):

1. Count messages with `seq > active summary.source_to_seq` (or all). If fewer than 12, return.
2. Load the previous summary (if any) and those messages.
3. `generateObject({ model: models.fast, schema: MemorySummary, prompt })` where the prompt includes the previous summary JSON and the messages as compact text (tool parts summarized as in 9.1). Instruction: merge, keep decisions, drop resolved open tasks.
4. Insert `memory_summaries` with `source_from_seq` = first message seq covered, `source_to_seq` = last, `model`.
5. Update `conversations.active_summary_id`.

Failure is logged (error class only) and ignored; the next run retries. This is the "full three-layer memory" of the MVP; Cloudflare Queues replace `waitUntil` in phase 2 without changing this function's contract.

---

## 10. Agent package (`packages/agent`)

Headless. Depends on `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `zod`, `@workspace/resume-schema`. No Supabase, no React, no `cloudflare:workers`.

### 10.1 Models (`src/models.ts`)

```ts
export type ModelTier = 'fast' | 'smart'
export function createModels(cfg: { gatewayBaseUrl: string; anthropicApiKey: string; openaiApiKey: string; gatewayToken?: string }) {
  const anthropic = createAnthropic({ baseURL: `${cfg.gatewayBaseUrl}/anthropic`, apiKey: cfg.anthropicApiKey, headers: gatewayHeaders })
  const openai = createOpenAI({ baseURL: `${cfg.gatewayBaseUrl}/openai`, apiKey: cfg.openaiApiKey, headers: gatewayHeaders })
  return {
    smart: anthropic('claude-sonnet-5'),
    fast: anthropic('claude-haiku-4-5-20251001'),
    fallbackSmart: openai('gpt-5'),
  }
}
```

Skills use `smart`; consolidation uses `fast`. Provider fallback is configured in the AI Gateway, not in code. With `AI_MOCK=1` the app substitutes `MockLanguageModelV2` from `ai/test` with canned responses per skill fixture.

### 10.2 Skill interface (`src/skills/types.ts`)

```ts
export type SkillId = 'bullet_rewrite' | 'jd_match' | 'grammar_clarity' | 'condense_to_pages'
  | 'ats_keyword' | 'impact_quantification' | 'summary_optimize'

export type SkillContext = {
  resume: Resume
  selectedNodeId?: string
  jobDescription?: string
  targetPages?: number
  userMessage: string
}

export type ResumeSkill = {
  id: SkillId
  name: string
  description: string
  status: 'mvp' | 'phase2'
  allowedOps: PatchOp[]                                  // exactly the table in over-all-design.md section 6.2
  allowedFields?: Partial<Record<NodeKind, string[]>>
  tools: ('check_fit' | 'propose_patches')[]           // propose_patches is always present
  scope(ctx: SkillContext): { scopeNodeId?: string; resumeContext: unknown }   // what part of the resume to send
  systemPrompt(ctx: SkillContext): string                // base prompt + skill fragment
  requires?: ('jobDescription' | 'targetPages' | 'selectedNodeId')[]
}

export const skills: Record<SkillId, ResumeSkill>
```

`scope` rules:
- `bullet_rewrite`, `grammar_clarity`, `impact_quantification` with a `selectedNodeId`: send the containing item plus `basics.headline`, and set `scopeNodeId` to the selected node's item. Without a selection: send the whole document, no scope.
- `jd_match`, `ats_keyword`, `condense_to_pages`, `summary_optimize`: whole document, no scope.

`requires` is enforced by the route (400 `VALIDATION` with a message naming the missing input).

### 10.3 Base system prompt (`src/prompts/base.ts`)

Fixed text covering: you improve resumes by proposing patches; never invent facts, employers, dates, or numbers; ask a question in plain text instead of guessing; address nodes only by the IDs given; always finish by calling `propose_patches` once with all patches (or with an empty list and an explanation when nothing should change); each patch needs a one-sentence `reason`; keep the user's voice and tense; write for the target role when a job description is given. The resume context is provided as a fenced JSON block with node IDs, and the patch contract is described with one example per allowed op.

### 10.4 Tools (`src/tools.ts`)

```ts
export const checkFitTool = tool({
  description: 'Render the resume with the given patches applied and return the page count. Use before proposing when a page target exists.',
  inputSchema: z.object({ patches: z.array(ResumePatchSchema).max(50) }),
  // no execute: runs in the browser
})

export function proposePatchesTool(deps: {
  resume: Resume; ctx: ValidationContext; persist: (valid: ResumePatch[]) => Promise<{ suggestionId: string; patch: ResumePatch }[]>
}) {
  return tool({
    description: 'Submit the final list of patches. Call exactly once at the end.',
    inputSchema: z.object({
      patches: z.array(z.unknown()).max(50),
      gaps: z.array(z.string().max(300)).max(20).optional(),      // jd_match: missing qualifications
      followUpQuestion: z.string().max(500).optional(),
    }),
    execute: async ({ patches, gaps, followUpQuestion }) => {
      const { valid, rejected } = validatePatches(deps.resume, patches, deps.ctx)
      const suggestions = await deps.persist(valid)
      return { suggestions, rejected, gaps: gaps ?? [], followUpQuestion }
    },
  })
}
```

The tool output is what the browser renders as suggestion cards. When `rejected` is non-empty the model may call `propose_patches` again within the step budget with corrected patches; the server persists only the additional valid ones (idempotent by `before`/`after`/target).

### 10.5 Run (`src/run.ts`)

```ts
export function runSkill(input: {
  skill: ResumeSkill
  ctx: SkillContext
  memory: ModelMessage[]
  models: ReturnType<typeof createModels>
  tools: { check_fit?: Tool; propose_patches: Tool }
  abortSignal?: AbortSignal
}) {
  const { scopeNodeId, resumeContext } = input.skill.scope(input.ctx)
  return streamText({
    model: input.models.smart,
    system: input.skill.systemPrompt(input.ctx) + '\n\nResume:\n```json\n' + JSON.stringify(resumeContext) + '\n```',
    messages: input.memory,
    tools: pick(input.tools, input.skill.tools),
    stopWhen: [stepCountIs(6), hasToolCall('propose_patches')],
    abortSignal: input.abortSignal,
  })
}
```

`stopWhen` ends the loop after `propose_patches` succeeds or after six steps. The route wires `scopeNodeId` and the grounding text into the `ValidationContext` given to `proposePatchesTool`.

### 10.6 Evals (`packages/agent/test/`)

For each MVP skill, a fixture: resume, user message, optional JD, and assertions run with the real `smart` model behind an `EVAL=1` flag (skipped in CI): at least one valid patch, zero `UNGROUNDED_NUMBER` rejections, all targets inside scope, `propose_patches` called exactly once. Unit tests with `MockLanguageModelV2` cover the loop mechanics without a network.

---

## 11. Operations

### 11.1 Rate limiting

KV counter per user per hour on `/api/chat` (60 requests). Server functions are not rate limited in the MVP beyond Cloudflare's defaults.

### 11.2 Logging

Structured JSON via `console.log` picked up by Workers observability. Allowed fields: `requestId, userId, resumeId, conversationId, runId, skillId, model, status, errorClass, latencyMs, inputTokens, outputTokens, patchCount, rejectedCount`. Forbidden: message text, resume content, patch text, job descriptions, email addresses.

### 11.3 Metrics derived from tables

- Accept rate per skill: `suggestions` grouped by `skill` (via `agent_runs.skill_id`) and `status`.
- Validation failure rate: `rejectedCount / (patchCount + rejectedCount)` from logs.
- Latency and tokens per skill: `agent_runs`.

### 11.4 Error classes on `agent_runs.error_class`

`provider`, `schema_validation`, `database`, `authorization`, `rate_limit`, `user_cancelled`, `internal`.

### 11.5 Backups and retention

Supabase daily backups (managed). Messages and versions are never deleted in the MVP except by cascade when a resume is hard-deleted; soft-deleted resumes are hard-deleted by a scheduled job after 30 days (phase 2; a manual SQL job until then).

---

## 12. Testing

| Layer | Tool | Coverage |
|---|---|---|
| `resume-schema` | Vitest | schema accepts fixtures and rejects malformed docs; `applyPatches` for every op and inverse; `validatePatches` for every error code; `contentHash` stable across key order |
| Database | Vitest against local Supabase | RLS: user B cannot read or write user A's rows in any table; RPC functions create versions atomically |
| Server functions | Vitest with a test user session | each function's happy path and each error code; `updateResume` conflict; `restoreVersion` labels |
| Chat route | Vitest with `MockLanguageModelV2` | new turn creates a run and a version snapshot; `propose_patches` persists suggestions; client-tool continuation does not create a second run; `onFinish` persists the assistant message and triggers consolidation at 12 messages |
| Agent | Vitest (mock) and `EVAL=1` (real model) | section 10.6 |
| End to end | Playwright | see `front-end.md` section 10 |

CI runs `bun run check`, `bun run typecheck`, `bun run test` on every push; e2e and evals run on demand.

---

## 13. Phase 2 and 3 hooks already present

- `memory_summaries` and `maybeConsolidate` are queue-ready: moving to Cloudflare Queues means enqueueing `{ conversationId }` instead of `waitUntil`.
- `agent_runs.status = 'running'` plus stored pending parts allow a Durable Object to take over streaming later without a schema change.
- `resume_versions.content_hash` enables a share/publish table keyed by hash in phase 3; the browser renders and uploads the PDF blob to R2, so no server-side renderer is required.
- The skill interface is unchanged if a router is added in front of it.
- `packages/agent` isolates the AI SDK choice; swapping to `@tanstack/ai` touches only `run.ts`, `tools.ts`, and the route's response helper.
