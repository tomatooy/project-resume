# Create a Resume From a Job Posting: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick one existing resume and a LinkedIn job posting, and get back a new resume that is a deep copy of that one, rewritten by a model against the posting.

**Architecture:** A new `TailorService` in `resume-core` orchestrates: parse the posting, store it in `job_targets`, deep-copy the source resume through the existing `ResumeService.create({ fromResumeId })`, open an `agent_runs` row, ask the model for a whole id-free document, run it through `assembleResume` and a deterministic post-pass, and write it. The resume row exists before the model call, so every failure mode degrades to "you got a plain duplicate" rather than "you got nothing". Two new ports (`JobParser`, `ResumeTailor`) plus a `JobTargetRepository` and a `JobFetcher` keep every model call and every Supabase call outside the service, exactly like `ImportService`.

**Tech Stack:** Bun workspaces + Turborepo, TypeScript 6 strict, Zod v4, Vercel AI SDK (`generateText` + `Output.object`) against DeepSeek, TanStack Start server functions on a Cloudflare Worker, Supabase Postgres with RLS, React 19 + TanStack Query, vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-09-09-create-resume-from-job-design.md`

## Global Constraints

- Package manager is **Bun**. Never `npm`, `pnpm` or `yarn`. Never run `bun run build`.
- Formatting and linting is **Biome only**, through `bun run format` and `bun run check`. Never invoke a bare `biome` binary.
- **No em dashes** anywhere: code, comments, UI copy, commit messages, docs. Use a comma, colon, parentheses, or two sentences.
- **No browser automation** and no dev server. Verify with `bun run typecheck`, `bun run check`, and `bun run test`. After a UI change, say what to look at and stop.
- **Never `any`.** Avoid `as` and `unknown` casts. Derive types from Zod schemas with `z.infer`.
- **Privacy:** resume content, message content, patch text and job posting text never reach a log, trace or analytics call. Logs carry ids, counts, durations and error classes only.
- Authorization is **RLS**, not handler code. Every new table gets an owner policy and an explicit grant to `authenticated` only. `service_role` gets nothing.
- Services take **ports**, never a Supabase client. Model calls live in `@workspace/agent` behind a port interface declared in `resume-core`.
- Commit after every task.

## Test Policy

`AGENTS.md` claims only `resume-schema` and `resume-render` carry vitest suites. That is stale: `resume-core` and `agent` both have `"test": "vitest run"` and populated `test/` directories, and Task 1 alone breaks four existing test files. Tests are therefore in scope for every task in this plan, and Task 12 fixes the `AGENTS.md` sentence.

Run a single package's suite with `bun run --filter @workspace/resume-core test`.

## File Structure

**`packages/resume-schema`** (Task 1 only)
- `src/patch.ts` loses rule 10, the `UNGROUNDED_NUMBER` code, `groundingText`, `NUMBER_TOKEN` and `numbersIn`.

**`packages/resume-core`**
- `src/domain/linkedin.ts` (new): URL normalisation, pure.
- `src/domain/job-target.ts` (new): `JobTarget`, `ParsedJobPostingSchema`, char limits.
- `src/domain/tailor.ts` (new): `enforceTailorRules`, pure.
- `src/domain/validation.ts`: loses grounding.
- `src/domain/suggestion.ts`: `RunInputSchema` gains two id fields.
- `src/ports/job-target-repository.ts`, `src/ports/job-parser.ts`, `src/ports/resume-tailor.ts`, `src/ports/job-fetcher.ts` (all new).
- `src/services/tailor-service.ts` (new): the orchestration.
- `src/services/resume-service.ts`: `CreateResumeInput` gains `subtitle`.
- `src/services/run-service.ts`: gains `startForCreation`.
- `src/services/container.ts`: four new ports, one new service.
- `src/testing/`: one in-memory repository, three stubs.

**`packages/agent`**
- `src/prompts/job.ts` (new): both prompts.
- `src/job.ts` (new): `createJobParser`, `createResumeTailor`.

**`apps/web`**
- `src/server/adapters/job-target-repository.ts`, `src/server/adapters/job-fetcher.ts` (new).
- `src/server/container.ts`: wire them, lazily like the parser.
- `src/server/fns/jobs.ts` (new): `fetchJobPosting`, `tailorFromJob`.
- `src/lib/api.ts`, `src/lib/queries.ts`: two calls, one hook.
- `src/features/import/ImportDialog.tsx`: two tabs.
- `src/features/import/JobTab.tsx`, `JobProgress.tsx`, `use-tailor.ts` (new).
- `src/features/shell/ResumeRail.tsx`: one menu item.

**`supabase/migrations/20260909120000_job_targets.sql`** (new): two tables, policies, grants.

---

### Task 1: Remove rule 10 (grounding)

Rule 10 rejected any number in proposed text that did not already appear in the user's message, the job description, or the resume. The tailoring flow writes a whole document rather than patches, so it never passes through `validatePatches` at all, and keeping a rule that only constrains the chat path while the new path is unconstrained makes the guarantee incoherent. It goes.

**Files:**
- Modify: `packages/resume-schema/src/patch.ts` (lines 93, 500-528, 558, 647-666)
- Modify: `packages/resume-core/src/domain/validation.ts`
- Modify: `apps/web/src/features/chat/Transcript.tsx:401`
- Test: `packages/resume-schema/test/schema.test.ts`, `packages/resume-core/test/validation.test.ts`, `packages/agent/test/messages.test.ts`, `packages/agent/test/turn-loop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ValidationContext` without `groundingText`; `PatchErrorCode` with 10 members; `ValidationMode`'s `propose` branch without `jobDescription`.

- [ ] **Step 1: Find every reference**

```bash
grep -rn "UNGROUNDED_NUMBER\|groundingText\|jobDescription" --include='*.ts' --include='*.tsx' packages apps
```

Expected: hits in `patch.ts`, `validation.ts`, `Transcript.tsx`, and the four test files listed above. Every one of them is in scope for this task.

- [ ] **Step 2: Delete the error code**

In `packages/resume-schema/src/patch.ts`, remove the `"UNGROUNDED_NUMBER",` line from `PATCH_ERROR_CODES`. The array is now 10 entries.

- [ ] **Step 3: Delete the grounding field and its helpers**

In the same file, delete the `groundingText` member of `ValidationContext` along with its whole doc comment, and delete `NUMBER_TOKEN` and `numbersIn` entirely. `ValidationContext` ends at `scopeNodeId?: string`.

- [ ] **Step 4: Delete the rule and renumber**

Delete `const grounding = ctx.groundingText` from `validatePatches`, then delete the rule 10 block. Renumber the trailing comment so the file stays honest:

```ts
    // 6, 7 and 10. Dry-run against the accumulated set: `before` equality
    // (rule 6), `insert_after.node` parsing as the parent's child kind
    // (rule 7, reported as KIND_MISMATCH), and the whole-document re-check.
```

Fix the function's own doc comment, which currently ends "Rule 10 (grounding) is what stops the model inventing metrics":

```ts
/**
 * The deterministic gate every model-proposed patch passes through, on the
 * server before persisting and again at accept time against the current head.
 * Shape, scope, field and op limits, and a dry run of the whole set.
 */
```

- [ ] **Step 5: Strip grounding from the core validator**

In `packages/resume-core/src/domain/validation.ts`, drop `collectText` from the import, delete `jobDescription` from the `propose` branch of `ValidationMode`, delete the `groundingText` computation, and drop the key from the `validatePatches` call. Rewrite the two doc comments that describe the propose/reapply split, because grounding was the only difference they named:

```ts
/**
 * Which of the two moments a patch is being checked at.
 *
 * `propose`: the model just produced it, against the document the model was
 * shown. `reapply`: it was proposed earlier and the user is accepting it now,
 * against a head that may have moved.
 *
 * The two modes now run the same rules; the distinction survives because the
 * scope anchor comes from the request when proposing and from the run row when
 * reapplying, and because a `before` mismatch is what makes a suggestion stale.
 */
```

- [ ] **Step 6: Remove the client-side copy**

`apps/web/src/features/chat/Transcript.tsx:401` maps `UNGROUNDED_NUMBER` to user-facing text. Delete that entry from the map. Leave the rest of the map alone.

- [ ] **Step 7: Update the four test files**

Delete every test asserting an `UNGROUNDED_NUMBER` rejection, and delete `groundingText` / `jobDescription` from every context literal that still builds one. Do not weaken a surviving test to compensate: a test that only passed because grounding rejected the patch is a test of grounding, and it goes with it.

- [ ] **Step 8: Verify**

```bash
bun run typecheck && bun run check && bun run test
```

Expected: PASS, and `grep -rn "UNGROUNDED_NUMBER\|groundingText" --include='*.ts' --include='*.tsx' packages apps` returns nothing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Drop the grounding rule from patch validation"
```

---

### Task 2: LinkedIn URL normalisation

LinkedIn serves the same posting under at least three shapes, and only the canonical one fetches cleanly. This is a pure function so it can be tested without a network.

**Files:**
- Create: `packages/resume-core/src/domain/linkedin.ts`
- Create: `packages/resume-core/test/linkedin.test.ts`
- Modify: `packages/resume-core/src/domain/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeLinkedInJobUrl(input: string): string | null`, exported from `@workspace/resume-core`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"

import { normalizeLinkedInJobUrl } from "../src/domain/linkedin"

const CANONICAL = "https://www.linkedin.com/jobs/view/4456278957/"

describe("normalizeLinkedInJobUrl", () => {
  it("keeps a canonical posting url as it is", () => {
    expect(normalizeLinkedInJobUrl(CANONICAL)).toBe(CANONICAL)
  })

  it("strips the slug a search result carries", () => {
    expect(
      normalizeLinkedInJobUrl(
        "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4456278957"
      )
    ).toBe(CANONICAL)
  })

  it("takes the id out of a collections url's query", () => {
    expect(
      normalizeLinkedInJobUrl(
        "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4456278957&discover=true"
      )
    ).toBe(CANONICAL)
  })

  it("accepts the email and mobile hosts and paths", () => {
    expect(
      normalizeLinkedInJobUrl("https://www.linkedin.com/comm/jobs/view/4456278957")
    ).toBe(CANONICAL)
    expect(
      normalizeLinkedInJobUrl("https://uk.linkedin.com/jobs/view/4456278957/")
    ).toBe(CANONICAL)
  })

  it("adds a missing scheme rather than rejecting", () => {
    expect(normalizeLinkedInJobUrl("linkedin.com/jobs/view/4456278957")).toBe(
      CANONICAL
    )
  })

  it("rejects other hosts, other linkedin pages, and nonsense", () => {
    expect(
      normalizeLinkedInJobUrl("https://www.indeed.com/viewjob?jk=4456278957")
    ).toBeNull()
    expect(
      normalizeLinkedInJobUrl("https://www.linkedin.com/in/ada-lovelace/")
    ).toBeNull()
    expect(normalizeLinkedInJobUrl("not a url")).toBeNull()
    expect(normalizeLinkedInJobUrl("")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun run --filter @workspace/resume-core test linkedin`
Expected: FAIL, cannot resolve `../src/domain/linkedin`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * LinkedIn shows one posting under several shapes: a slugged search result, a
 * collections page carrying the id in the query, an email `/comm/` link, and a
 * country subdomain. Only the canonical form fetches reliably, so everything is
 * reduced to it before it is stored or fetched.
 *
 * Returning null rather than throwing is deliberate: "this is not a LinkedIn
 * job posting" is an answer the dialog shows next to the field, not an error.
 */
const JOB_ID = /(?:^|[/-])(\d{6,})\/?$/
const HOST = /^(?:[a-z]{2}\.)?(?:www\.)?linkedin\.com$/

export function normalizeLinkedInJobUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === "") return null

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  if (!HOST.test(url.hostname.toLowerCase())) return null

  // The collections and search pages put the id in the query, and the path
  // says nothing about which posting is open.
  const fromQuery = url.searchParams.get("currentJobId")
  if (fromQuery && /^\d{6,}$/.test(fromQuery)) return canonical(fromQuery)

  const path = url.pathname.replace(/^\/comm/, "")
  if (!path.startsWith("/jobs/view/")) return null

  const id = JOB_ID.exec(path)?.[1]
  return id ? canonical(id) : null
}

function canonical(id: string): string {
  return `https://www.linkedin.com/jobs/view/${id}/`
}
```

- [ ] **Step 4: Export it**

Add `export * from "./linkedin"` to `packages/resume-core/src/domain/index.ts`, in alphabetical position after `./errors`.

- [ ] **Step 5: Run the tests**

Run: `bun run --filter @workspace/resume-core test linkedin`
Expected: PASS, all six cases.

- [ ] **Step 6: Commit**

```bash
git add packages/resume-core
git commit -m "Normalise LinkedIn job URLs to their canonical form"
```

---

### Task 3: The `job_targets` and `resume_job_targets` tables

Postings are stored standalone and linked many-to-many, so one posting can be tailored against twice and one resume can accumulate several applications. Nothing in this release reads the link, but which posting a resume came from is unrecoverable if it is not captured at creation.

**Files:**
- Create: `supabase/migrations/20260909120000_job_targets.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `job_targets(id, user_id, source_url, raw_text, title, company, location, requirements, created_at)` and `resume_job_targets(resume_id, job_target_id, is_origin, created_at)`, both readable and writable by `authenticated` under an owner policy.

- [ ] **Step 1: Write the migration**

```sql
-- Job postings a user has tailored against, and which resumes came from them.
--
-- The posting is a first-class row rather than a column on `resumes` because
-- one posting can be tailored against more than once, and because a resume
-- picks up further applications over its life. `agent_runs.input` keeps only
-- the id of a row here, so the run's input is still safe to retain while the
-- posting text has one home.

create table job_targets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Null when the user pasted the description instead of giving a link.
  source_url   text,
  -- The posting as the model saw it, capped by the service at 20,000 chars.
  raw_text     text not null,
  title        text not null default '',
  company      text not null default '',
  location     text,
  -- { mustHaves: string[], niceToHaves: string[], keywords: string[] }.
  -- Jsonb rather than three arrays: the shape is model output, validated by
  -- Zod on the way in and on the way out, and it will grow.
  requirements jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index job_targets_user_created on job_targets (user_id, created_at desc);

-- Many-to-many on purpose. `is_origin` marks the posting the resume was
-- generated from, which is exactly one row today because the creation flow is
-- the only writer; later ways of attaching a posting will add rows with false.
create table resume_job_targets (
  resume_id     uuid not null references resumes(id)     on delete cascade,
  job_target_id uuid not null references job_targets(id) on delete cascade,
  is_origin     boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (resume_id, job_target_id)
);

create index resume_job_targets_by_target on resume_job_targets (job_target_id);

-- Same two-part boundary as every other table: a policy for which rows, a
-- grant for whether the role may reach the table at all.
alter table job_targets enable row level security;
create policy job_targets_owner on job_targets
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Joins through `resumes` like every other child table, and additionally
-- checks the posting is the same user's, so a link row cannot be used to
-- attach someone else's posting to your own resume.
alter table resume_job_targets enable row level security;
create policy resume_job_targets_owner on resume_job_targets
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid())
                 and exists (select 1 from job_targets j where j.id = job_target_id and j.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid())
                 and exists (select 1 from job_targets j where j.id = job_target_id and j.user_id = auth.uid()));

-- `alter default privileges` in 20260902120300_grants.sql already covers new
-- tables, but only for roles that existed when it ran and only for the role
-- that creates them. Stating the grants makes the two tables self-contained.
grant select, insert, update, delete on job_targets        to authenticated;
grant select, insert, update, delete on resume_job_targets to authenticated;
```

- [ ] **Step 2: Check it applies**

Run: `bunx supabase db reset`
Expected: every migration applies in order with no error. If the local Supabase stack is not running, `bunx supabase start` first.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260909120000_job_targets.sql
git commit -m "Add job_targets and resume_job_targets with owner policies"
```

---

### Task 4: Job target domain, port, and both adapters

**Files:**
- Create: `packages/resume-core/src/domain/job-target.ts`
- Create: `packages/resume-core/src/ports/job-target-repository.ts`
- Create: `packages/resume-core/src/testing/in-memory-job-target-repository.ts`
- Create: `apps/web/src/server/adapters/job-target-repository.ts`
- Create: `packages/resume-core/test/job-target-repository.test.ts`
- Modify: `packages/resume-core/src/domain/index.ts`, `src/ports/index.ts`, `src/testing/index.ts`, `src/testing/db.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ParsedJobPostingSchema` and `type ParsedJobPosting = { title: string; company: string; location?: string; mustHaves: string[]; niceToHaves: string[]; keywords: string[] }`
  - `type JobTarget = { id: string; sourceUrl: string | null; rawText: string; title: string; company: string; location: string | null; requirements: JobRequirements; createdAt: string }`
  - `type NewJobTarget = Omit<JobTarget, "id" | "createdAt">`
  - `interface JobTargetRepository { create(input: NewJobTarget): Promise<JobTarget>; findById(id: string): Promise<JobTarget | null>; link(input: { resumeId: string; jobTargetId: string; isOrigin: boolean }): Promise<void>; listForResume(resumeId: string): Promise<JobTarget[]> }`
  - `MAX_JOB_CHARS = 20_000`, `MIN_JOB_CHARS = 200`
  - `class InMemoryJobTargetRepository`

- [ ] **Step 1: Write the domain module**

```ts
import { z } from "zod"

/**
 * The model's reading of a posting. Flat arrays of short strings, for the same
 * reason `ParsedResumeSchema` is flat: a flash model given `anyOf` or nesting
 * produces valid JSON of the wrong shape often enough to matter.
 */
export const ParsedJobPostingSchema = z.object({
  title: z.string().max(200),
  company: z.string().max(200),
  location: z.string().max(200).optional(),
  /** Requirements stated as required. */
  mustHaves: z.array(z.string().max(300)).max(20),
  /** Requirements stated as preferred, bonus, or nice to have. */
  niceToHaves: z.array(z.string().max(300)).max(20),
  /** Tools, languages and named skills, as the posting spells them. */
  keywords: z.array(z.string().max(80)).max(40),
})
export type ParsedJobPosting = z.infer<typeof ParsedJobPostingSchema>

/** What is stored on the row: the posting minus the fields with columns. */
export const JobRequirementsSchema = ParsedJobPostingSchema.pick({
  mustHaves: true,
  niceToHaves: true,
  keywords: true,
})
export type JobRequirements = z.infer<typeof JobRequirementsSchema>

export type JobTarget = {
  id: string
  /** Null when the user pasted the description rather than giving a link. */
  sourceUrl: string | null
  rawText: string
  title: string
  company: string
  location: string | null
  requirements: JobRequirements
  createdAt: string
}

export type NewJobTarget = Omit<JobTarget, "id" | "createdAt">

/** The same ceiling import uses, for the same reason: one model call's worth. */
export const MAX_JOB_CHARS = 20_000
/** Below this it is a job title, not a posting, and tailoring has nothing to go on. */
export const MIN_JOB_CHARS = 200
```

- [ ] **Step 2: Write the port**

```ts
import type { JobTarget, NewJobTarget } from "../domain/job-target"

export type LinkJobTargetInput = {
  resumeId: string
  jobTargetId: string
  /** True for the posting the resume was generated from. */
  isOrigin: boolean
}

export interface JobTargetRepository {
  create(input: NewJobTarget): Promise<JobTarget>
  findById(id: string): Promise<JobTarget | null>
  /** Idempotent: linking the same pair twice is not an error. */
  link(input: LinkJobTargetInput): Promise<void>
  /** Newest first. No reader yet; the link exists so the fact is not lost. */
  listForResume(resumeId: string): Promise<JobTarget[]>
}
```

Add `export * from "./job-target"` to `src/domain/index.ts` and `export * from "./job-target-repository"` to `src/ports/index.ts`.

- [ ] **Step 3: Add the rows to the in-memory database**

In `packages/resume-core/src/testing/db.ts`, add to `InMemoryDb`:

```ts
  jobTargets: JobTarget[] = []
  resumeJobTargets: {
    resumeId: string
    jobTargetId: string
    isOrigin: boolean
  }[] = []
```

with `import type { JobTarget } from "../domain/job-target"` at the top.

- [ ] **Step 4: Write the in-memory repository**

```ts
import type { JobTarget, NewJobTarget } from "../domain/job-target"
import type {
  JobTargetRepository,
  LinkJobTargetInput,
} from "../ports/job-target-repository"
import type { InMemoryDb } from "./db"

export class InMemoryJobTargetRepository implements JobTargetRepository {
  constructor(private readonly db: InMemoryDb) {}

  async create(input: NewJobTarget): Promise<JobTarget> {
    const row: JobTarget = {
      ...input,
      id: this.db.uuid(),
      createdAt: this.db.now().toISOString(),
    }
    this.db.jobTargets.push(row)
    return row
  }

  async findById(id: string): Promise<JobTarget | null> {
    return this.db.jobTargets.find((row) => row.id === id) ?? null
  }

  async link(input: LinkJobTargetInput): Promise<void> {
    const existing = this.db.resumeJobTargets.find(
      (row) =>
        row.resumeId === input.resumeId &&
        row.jobTargetId === input.jobTargetId
    )
    if (existing) return
    this.db.resumeJobTargets.push({ ...input })
  }

  async listForResume(resumeId: string): Promise<JobTarget[]> {
    const ids = this.db.resumeJobTargets
      .filter((row) => row.resumeId === resumeId)
      .map((row) => row.jobTargetId)
    return this.db.jobTargets
      .filter((row) => ids.includes(row.id))
      .reverse()
  }
}
```

`InMemoryDb.uuid()` and `InMemoryDb.now()` are the existing helpers every other in-memory repository uses. Do not add a second id or clock scheme.

Add `export * from "./in-memory-job-target-repository"` to `src/testing/index.ts`.

- [ ] **Step 5: Write the Supabase adapter**

```ts
import {
  JobRequirementsSchema,
  type JobTarget,
  type JobTargetRepository,
  type LinkJobTargetInput,
  type NewJobTarget,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"

type Row = {
  id: string
  source_url: string | null
  raw_text: string
  title: string
  company: string
  location: string | null
  requirements: unknown
  created_at: string
}

const COLUMNS =
  "id, source_url, raw_text, title, company, location, requirements, created_at"

/** Empty rather than throwing: a posting whose requirements did not survive a
 *  schema change is still a posting, and the text is the part that matters. */
const EMPTY = { mustHaves: [], niceToHaves: [], keywords: [] }

function toJobTarget(row: Row): JobTarget {
  const parsed = JobRequirementsSchema.safeParse(row.requirements)
  return {
    id: row.id,
    sourceUrl: row.source_url,
    rawText: row.raw_text,
    title: row.title,
    company: row.company,
    location: row.location,
    requirements: parsed.success ? parsed.data : EMPTY,
    createdAt: row.created_at,
  }
}

export class SupabaseJobTargetRepository implements JobTargetRepository {
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async create(input: NewJobTarget): Promise<JobTarget> {
    const { data, error } = await this.db
      .from("job_targets")
      .insert({
        user_id: this.userId,
        source_url: input.sourceUrl,
        raw_text: input.rawText,
        title: input.title,
        company: input.company,
        location: input.location,
        requirements: input.requirements,
      })
      .select(COLUMNS)
      .single()

    if (error) throw error
    return toJobTarget(data)
  }

  async findById(id: string): Promise<JobTarget | null> {
    const { data, error } = await this.db
      .from("job_targets")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    return data ? toJobTarget(data) : null
  }

  /** `on conflict do nothing` via upsert: relinking the same pair is a no-op. */
  async link(input: LinkJobTargetInput): Promise<void> {
    const { error } = await this.db.from("resume_job_targets").upsert(
      {
        resume_id: input.resumeId,
        job_target_id: input.jobTargetId,
        is_origin: input.isOrigin,
      },
      { onConflict: "resume_id,job_target_id", ignoreDuplicates: true }
    )
    if (error) throw error
  }

  async listForResume(resumeId: string): Promise<JobTarget[]> {
    const { data, error } = await this.db
      .from("resume_job_targets")
      .select(`job_targets (${COLUMNS})`)
      .eq("resume_id", resumeId)
      .order("created_at", { ascending: false })

    if (error) throw error
    return (data ?? [])
      .map((row) => row.job_targets)
      .filter((row): row is Row => row !== null)
      .map(toJobTarget)
  }
}
```

If the generated Supabase types have not been regenerated for the new tables, `bunx supabase gen types typescript --local` per whatever script `apps/web` already uses; check `package.json` for the existing command rather than inventing one.

- [ ] **Step 6: Write the test**

```ts
import { describe, expect, it } from "vitest"

import { InMemoryDb, InMemoryJobTargetRepository } from "../src/testing/index"

const POSTING = {
  sourceUrl: "https://www.linkedin.com/jobs/view/4456278957/",
  rawText: "We are hiring a Senior Engineer.",
  title: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  requirements: { mustHaves: ["TypeScript"], niceToHaves: [], keywords: ["React"] },
}

describe("InMemoryJobTargetRepository", () => {
  it("round-trips a posting", async () => {
    const repo = new InMemoryJobTargetRepository(new InMemoryDb())
    const created = await repo.create(POSTING)

    expect(created.company).toBe("Acme")
    expect(await repo.findById(created.id)).toEqual(created)
    expect(await repo.findById("missing")).toBeNull()
  })

  it("links a resume to a posting, and linking twice changes nothing", async () => {
    const repo = new InMemoryJobTargetRepository(new InMemoryDb())
    const target = await repo.create(POSTING)

    await repo.link({ resumeId: "r1", jobTargetId: target.id, isOrigin: true })
    await repo.link({ resumeId: "r1", jobTargetId: target.id, isOrigin: false })

    expect(await repo.listForResume("r1")).toEqual([target])
    expect(await repo.listForResume("r2")).toEqual([])
  })

  it("lists several postings against one resume", async () => {
    const repo = new InMemoryJobTargetRepository(new InMemoryDb())
    const first = await repo.create(POSTING)
    const second = await repo.create({ ...POSTING, company: "Babbage" })

    await repo.link({ resumeId: "r1", jobTargetId: first.id, isOrigin: true })
    await repo.link({ resumeId: "r1", jobTargetId: second.id, isOrigin: false })

    expect((await repo.listForResume("r1")).map((t) => t.company)).toEqual([
      "Babbage",
      "Acme",
    ])
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `bun run --filter @workspace/resume-core test job-target`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/resume-core apps/web/src/server/adapters
git commit -m "Add the job target repository port and its two adapters"
```

---

### Task 5: The job posting parser (model call 1)

One structured-output call, no tools and no loop, exactly like `createResumeParser`. Reading the posting is separated from writing the resume so the second call is given a short list of requirements instead of 20,000 characters of boilerplate, benefits copy and equal-opportunity statements.

**Files:**
- Create: `packages/resume-core/src/ports/job-parser.ts`
- Create: `packages/resume-core/src/testing/stub-job-parser.ts`
- Create: `packages/agent/src/prompts/job.ts`
- Create: `packages/agent/src/job.ts`
- Create: `packages/agent/test/job-parser.test.ts`
- Modify: `packages/resume-core/src/ports/index.ts`, `src/testing/index.ts`, `packages/agent/src/index.ts`

**Interfaces:**
- Consumes: `ParsedJobPostingSchema`, `ParsedJobPosting` from Task 4.
- Produces:
  - `type ParseJobInput = { text: string; signal?: AbortSignal }`
  - `type ParseJobResult = { parsed: ParsedJobPosting; model: string }`
  - `interface JobParser { parse(input: ParseJobInput): Promise<ParseJobResult> }`
  - `createJobParser(models: Models): JobParser` from `@workspace/agent`
  - `class StubJobParser` with `result`, `model`, `failWith`, `calls`
  - `JOB_PARSE_PROMPT`

- [ ] **Step 1: Write the port**

```ts
import type { ParsedJobPosting } from "../domain/job-target"

export type ParseJobInput = {
  /** The posting as plain text: fetched from LinkedIn, or pasted. */
  text: string
  signal?: AbortSignal
}

export type ParseJobResult = {
  parsed: ParsedJobPosting
  /** Which model read it; goes to the log, never to a row. */
  model: string
}

/** The first of the two model calls behind tailoring. Implemented in `@workspace/agent`. */
export interface JobParser {
  parse(input: ParseJobInput): Promise<ParseJobResult>
}
```

Add `export * from "./job-parser"` to `src/ports/index.ts`.

- [ ] **Step 2: Write the stub**

```ts
import type { ParsedJobPosting } from "../domain/job-target"
import type {
  JobParser,
  ParseJobInput,
  ParseJobResult,
} from "../ports/job-parser"

const EMPTY: ParsedJobPosting = {
  title: "",
  company: "",
  mustHaves: [],
  niceToHaves: [],
  keywords: [],
}

export class StubJobParser implements JobParser {
  result: ParsedJobPosting = EMPTY
  model = "stub"
  failWith: Error | null = null
  readonly calls: ParseJobInput[] = []

  async parse(input: ParseJobInput): Promise<ParseJobResult> {
    this.calls.push(input)
    if (this.failWith) throw this.failWith
    return { parsed: this.result, model: this.model }
  }
}
```

Add `export * from "./stub-job-parser"` to `src/testing/index.ts`.

- [ ] **Step 3: Write the prompt**

```ts
/**
 * Reading the posting is a separate call from writing the resume so the writing
 * call is handed a short list of requirements rather than the whole page.
 * A LinkedIn posting is mostly not requirements: benefits, culture copy, the
 * equal-opportunity statement, and the company's own boilerplate.
 */
export const JOB_PARSE_PROMPT = [
  "You read a job posting and return what it asks for. You are not writing anything and you are not judging a candidate.",

  "Copy the job title and the company name exactly as the posting writes them. If the posting gives a location, copy it; if it is remote, say so in the same words the posting uses. Leave location out if the posting does not state one.",

  [
    "Split what the posting asks for into two lists:",
    "- mustHaves: stated as required, essential, or simply listed under Requirements or What you'll need.",
    "- niceToHaves: stated as preferred, bonus, a plus, desirable, or nice to have.",
    "One requirement per entry, each a short phrase in the posting's own words. If the posting does not separate the two, put everything in mustHaves.",
  ].join("\n"),

  "keywords: the named tools, languages, frameworks, certifications and methodologies the posting mentions, spelled as the posting spells them. One per entry, no duplicates, no phrases.",

  "Ignore benefits, salary, culture statements, equal-opportunity notices, application instructions, and anything about the company that is not a requirement.",

  "If the text is not a job posting, return empty strings and empty lists rather than inventing a role.",
].join("\n\n")
```

- [ ] **Step 4: Write the parser**

```ts
import type {
  JobParser,
  ParseJobInput,
  ParseJobResult,
} from "@workspace/resume-core"
import { ParsedJobPostingSchema } from "@workspace/resume-core"
import { Output, generateText } from "ai"

import type { Models } from "./models"
import { JOB_PARSE_PROMPT } from "./prompts/job"

/**
 * The `JobParser` port. Structured output, no tools, no loop: reading a posting
 * has nothing to negotiate, so there is no step budget to get wrong.
 */
export function createJobParser(models: Models): JobParser {
  return {
    async parse(input: ParseJobInput): Promise<ParseJobResult> {
      const result = await generateText({
        model: models.smart,
        output: Output.object({ schema: ParsedJobPostingSchema }),
        system: JOB_PARSE_PROMPT,
        prompt: `Job posting:\n\n${input.text}`,
        providerOptions: models.providerOptions,
        abortSignal: input.signal,
      })
      return { parsed: result.output, model: models.ids.smart }
    },
  }
}
```

Add `export { createJobParser } from "./job"` to `packages/agent/src/index.ts`.

- [ ] **Step 5: Write the test**

`packages/agent/test/` already stubs the model; read a neighbouring test such as `messages.test.ts` for how `Models` is faked there and follow it exactly rather than introducing a second approach. The test asserts what this package is responsible for, which is the wiring, not the model:

```ts
import { describe, expect, it } from "vitest"

import { createJobParser } from "../src/job"
import { fakeModels } from "./fake-models"

describe("createJobParser", () => {
  it("passes the posting through and reports the smart model id", async () => {
    const models = fakeModels({
      output: {
        title: "Senior Engineer",
        company: "Acme",
        mustHaves: ["TypeScript"],
        niceToHaves: [],
        keywords: ["React"],
      },
    })

    const result = await createJobParser(models).parse({ text: "posting text" })

    expect(result.parsed.company).toBe("Acme")
    expect(result.model).toBe(models.ids.smart)
  })

  it("forwards the abort signal to the model call", async () => {
    const models = fakeModels({ output: { title: "", company: "", mustHaves: [], niceToHaves: [], keywords: [] } })
    const controller = new AbortController()

    await createJobParser(models).parse({
      text: "posting text",
      signal: controller.signal,
    })

    expect(models.lastCall?.abortSignal).toBe(controller.signal)
  })
})
```

If `packages/agent/test` has no such helper, write `fakeModels` in `packages/agent/test/fake-models.ts` returning a `Models` whose `smart` is a `MockLanguageModelV3` from `ai/test`, and record the last call on it. Do not reach for the network in a test.

- [ ] **Step 6: Run the tests**

Run: `bun run --filter @workspace/agent test job-parser`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/resume-core packages/agent
git commit -m "Add the job posting parser behind a port"
```

---

### Task 6: The resume tailor (model call 2)

The second call is handed the source document and the parsed requirements and returns a whole new document, id-free, in the shape import already uses. It writes a document rather than patches because it is creating a resume, not editing one, which is the same reason `ImportService` gets to do it.

**Files:**
- Create: `packages/resume-core/src/ports/resume-tailor.ts`
- Create: `packages/resume-core/src/testing/stub-resume-tailor.ts`
- Create: `packages/agent/test/resume-tailor.test.ts`
- Modify: `packages/agent/src/prompts/job.ts`, `packages/agent/src/job.ts`, `packages/agent/src/index.ts`, `packages/resume-core/src/ports/index.ts`, `src/testing/index.ts`

**Interfaces:**
- Consumes: `ParsedJobPosting` (Task 4), `Resume` and `ParsedResume` from `@workspace/resume-schema`.
- Produces:
  - `type TailorResumeInput = { resume: Resume; posting: ParsedJobPosting; signal?: AbortSignal }`
  - `type TailorResumeResult = { parsed: ParsedResume; model: string }`
  - `interface ResumeTailor { tailor(input: TailorResumeInput): Promise<TailorResumeResult> }`
  - `createResumeTailor(models: Models): ResumeTailor`
  - `class StubResumeTailor`
  - `TAILOR_PROMPT`

- [ ] **Step 1: Write the port**

```ts
import type { ParsedResume, Resume } from "@workspace/resume-schema"

import type { ParsedJobPosting } from "../domain/job-target"

export type TailorResumeInput = {
  /** The source document, ids and all. The model is not asked to keep them. */
  resume: Resume
  posting: ParsedJobPosting
  signal?: AbortSignal
}

export type TailorResumeResult = {
  /**
   * Id-free, like import's output. Models cannot reliably emit ids that satisfy
   * the strict format and the global uniqueness check, so `assembleResume`
   * mints them instead and the model never sees one it has to preserve.
   */
  parsed: ParsedResume
  model: string
}

/** The second of the two model calls behind tailoring. Implemented in `@workspace/agent`. */
export interface ResumeTailor {
  tailor(input: TailorResumeInput): Promise<TailorResumeResult>
}
```

Add `export * from "./resume-tailor"` to `src/ports/index.ts`.

- [ ] **Step 2: Write the stub**

```ts
import type { ParsedResume } from "@workspace/resume-schema"

import type {
  ResumeTailor,
  TailorResumeInput,
  TailorResumeResult,
} from "../ports/resume-tailor"

const EMPTY: ParsedResume = { basics: {}, sections: [] }

export class StubResumeTailor implements ResumeTailor {
  result: ParsedResume = EMPTY
  model = "stub"
  failWith: Error | null = null
  readonly calls: TailorResumeInput[] = []

  async tailor(input: TailorResumeInput): Promise<TailorResumeResult> {
    this.calls.push(input)
    if (this.failWith) throw this.failWith
    return { parsed: this.result, model: this.model }
  }
}
```

Add `export * from "./stub-resume-tailor"` to `src/testing/index.ts`.

- [ ] **Step 3: Write the tailoring prompt**

Append to `packages/agent/src/prompts/job.ts`:

```ts
/**
 * The one prompt in this codebase that is allowed to write. Import forbids it
 * and the chat skills propose patches a user accepts one at a time; this call
 * produces a whole document nobody reviews line by line, so the honesty rules
 * are stated here rather than assumed.
 */
export const TAILOR_PROMPT = [
  "You rewrite a resume so that it speaks to one specific job posting. You are given the resume and what the posting asks for. Return the whole resume, rewritten.",

  [
    "What you must never do:",
    "- Never invent an employer, a job title, a school, a qualification, a date, or a project the resume does not already contain.",
    "- Never claim a skill the resume gives no evidence for, however well it would match the posting.",
    "- Never change a company name, a role title, a school, a degree, or any date.",
    "- Never state a number, a percentage, a headcount, or a currency amount that the resume does not already state. If a bullet has no number, the rewritten bullet has no number.",
  ].join("\n"),

  [
    "What you should do:",
    "- Rewrite bullets so the work that matters to this posting is what the reader sees first, using the posting's vocabulary where the resume describes the same thing in different words.",
    "- Reorder items within a section so the most relevant comes first.",
    "- Drop bullets and items that have nothing to do with this posting, except that every job in the experience section stays. An old or unrelated role may come down to a single line, but removing it would leave a gap in the person's history that is not yours to create.",
    "- Write a summary and a headline aimed at this posting, built only from what the resume already says.",
    "- Group and name skills the way the posting groups and names them, keeping only skills the resume supports.",
  ].join("\n"),

  "Keep every section the resume has, with its heading as written. Do not add a section. Do not translate. Do not change the language the resume is written in.",

  "There is no length target. Say what is relevant and stop.",
].join("\n\n")
```

- [ ] **Step 4: Write the tailor**

Append to `packages/agent/src/job.ts`:

```ts
/**
 * The `ResumeTailor` port. Same one-shot structured-output shape as the parser:
 * the model is given a document and a posting and returns a document.
 *
 * The resume goes in as JSON rather than rendered text because the model has to
 * return the same structure, and showing it the shape it must produce is worth
 * more than the tokens a prose rendering would save.
 */
export function createResumeTailor(models: Models): ResumeTailor {
  return {
    async tailor(input: TailorResumeInput): Promise<TailorResumeResult> {
      const { posting } = input
      const result = await generateText({
        model: models.smart,
        output: Output.object({ schema: ParsedResumeSchema }),
        system: TAILOR_PROMPT,
        prompt: [
          `Job title: ${posting.title}`,
          `Company: ${posting.company}`,
          posting.location ? `Location: ${posting.location}` : "",
          `Required: ${posting.mustHaves.join("; ") || "not stated"}`,
          `Preferred: ${posting.niceToHaves.join("; ") || "not stated"}`,
          `Keywords: ${posting.keywords.join(", ") || "not stated"}`,
          "",
          "Resume:",
          JSON.stringify(input.resume),
        ]
          .filter((line) => line !== "")
          .join("\n"),
        providerOptions: models.providerOptions,
        abortSignal: input.signal,
      })
      return { parsed: result.output, model: models.ids.smart }
    },
  }
}
```

Extend the file's imports: `ParsedResumeSchema` from `@workspace/resume-schema`, `ResumeTailor`, `TailorResumeInput`, `TailorResumeResult` from `@workspace/resume-core`, and `TAILOR_PROMPT` from `./prompts/job`.

Add `export { createJobParser, createResumeTailor } from "./job"` to `packages/agent/src/index.ts`, replacing the line added in Task 5.

- [ ] **Step 5: Write the test**

```ts
import { starter } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import { createResumeTailor } from "../src/job"
import { fakeModels } from "./fake-models"

const POSTING = {
  title: "Senior Engineer",
  company: "Acme",
  mustHaves: ["TypeScript"],
  niceToHaves: ["React"],
  keywords: ["Postgres"],
}

describe("createResumeTailor", () => {
  it("puts the posting and the document in the prompt and reports the model", async () => {
    const models = fakeModels({
      output: { basics: { name: "Ada" }, sections: [] },
    })

    const result = await createResumeTailor(models).tailor({
      resume: starter,
      posting: POSTING,
    })

    expect(result.model).toBe(models.ids.smart)
    const prompt = models.lastCall?.prompt ?? ""
    expect(prompt).toContain("Senior Engineer")
    expect(prompt).toContain("TypeScript")
    expect(prompt).toContain(starter.basics.name ?? "")
  })
})
```

Adjust the `models.lastCall` accessor to whatever `fakeModels` records, matching Task 5.

- [ ] **Step 6: Run the tests**

Run: `bun run --filter @workspace/agent test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/resume-core packages/agent
git commit -m "Add the resume tailor behind a port"
```

---

### Task 7: The deterministic post-pass

Two rules are enforced in code rather than trusted to the prompt, because the prompt is the only thing standing between the model and the document and neither failure is visible to a user skimming the result.

**Files:**
- Create: `packages/resume-core/src/domain/tailor.ts`
- Create: `packages/resume-core/test/tailor-rules.test.ts`
- Modify: `packages/resume-core/src/domain/index.ts`

**Interfaces:**
- Consumes: `Resume`, `Section`, `Item` from `@workspace/resume-schema`.
- Produces: `enforceTailorRules(source: Resume, tailored: Resume): Resume`

- [ ] **Step 1: Write the failing test**

```ts
import type { Resume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { enforceTailorRules } from "../src/domain/tailor"

function experience(company: string, role: string, start: string) {
  return {
    id: `itm_${company}${start}`,
    kind: "experience" as const,
    company,
    role,
    start,
    end: null,
    bullets: [{ id: `bul_${company}`, text: `Worked at ${company}.` }],
  }
}

function doc(items: ReturnType<typeof experience>[]): Resume {
  return {
    schemaVersion: 1,
    basics: { name: "Ada", links: [] },
    sections: [
      { id: "sec_exp", type: "experience", title: "Experience", items },
    ],
  }
}

describe("enforceTailorRules", () => {
  it("puts back an experience item the model dropped", () => {
    const source = doc([
      experience("Acme", "Engineer", "2020"),
      experience("Babbage", "Analyst", "1842"),
    ])
    const tailored = doc([experience("Acme", "Senior Engineer", "2020")])

    const result = enforceTailorRules(source, tailored)

    const companies = result.sections[0]?.items.map(
      (item) => item.kind === "experience" && item.company
    )
    expect(companies).toEqual(["Acme", "Babbage"])
  })

  it("keeps the model's rewrite and ordering for the items it kept", () => {
    const source = doc([
      experience("Acme", "Engineer", "2020"),
      experience("Babbage", "Analyst", "1842"),
    ])
    const tailored = doc([
      experience("Babbage", "Analyst", "1842"),
      experience("Acme", "Engineer", "2020"),
    ])

    const result = enforceTailorRules(source, tailored)

    expect(result.sections[0]?.items).toEqual(tailored.sections[0]?.items)
  })

  it("puts back a whole experience section the model omitted", () => {
    const source = doc([experience("Acme", "Engineer", "2020")])
    const tailored: Resume = {
      schemaVersion: 1,
      basics: { name: "Ada", links: [] },
      sections: [
        {
          id: "sec_sk",
          type: "skills",
          title: "Skills",
          items: [
            { id: "itm_sk", kind: "skills", label: "Languages", skills: ["TypeScript"] },
          ],
        },
      ],
    }

    const result = enforceTailorRules(source, tailored)

    expect(result.sections.map((s) => s.type)).toEqual(["skills", "experience"])
  })

  it("drops a section the model emptied", () => {
    const source = doc([experience("Acme", "Engineer", "2020")])
    const tailored: Resume = {
      ...doc([experience("Acme", "Engineer", "2020")]),
      sections: [
        ...doc([experience("Acme", "Engineer", "2020")]).sections,
        { id: "sec_pr", type: "projects", title: "Projects", items: [] },
      ],
    }

    const result = enforceTailorRules(source, tailored)

    expect(result.sections.map((s) => s.type)).toEqual(["experience"])
  })

  it("leaves a document that already obeys both rules untouched", () => {
    const source = doc([experience("Acme", "Engineer", "2020")])
    expect(enforceTailorRules(source, source)).toEqual(source)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun run --filter @workspace/resume-core test tailor-rules`
Expected: FAIL, cannot resolve `../src/domain/tailor`.

- [ ] **Step 3: Write the implementation**

```ts
import type { Item, Resume, Section } from "@workspace/resume-schema"

/**
 * The two rules the prompt is not trusted with.
 *
 * Every job in the source survives. The model may cut an unrelated role down
 * to one line, and should, but removing it would leave a gap in the person's
 * employment history. That reads as a fact about the candidate rather than an
 * editing decision, and nobody asked for it.
 *
 * A section with no items left is removed, because the templates render it as
 * a heading with nothing underneath.
 *
 * Ordering inside a section is the model's to decide, so restored items go on
 * the end rather than back where they were.
 */
export function enforceTailorRules(source: Resume, tailored: Resume): Resume {
  const sections = tailored.sections.map((section) =>
    section.type === "experience"
      ? restoreExperience(source, section)
      : section
  )

  // A whole section the model dropped: only experience is protected, and only
  // when the source actually had one.
  for (const section of source.sections) {
    if (section.type !== "experience") continue
    if (sections.some((kept) => kept.type === "experience")) continue
    sections.push(section)
  }

  return { ...tailored, sections: sections.filter((s) => s.items.length > 0) }
}

function restoreExperience(source: Resume, section: Section): Section {
  const missing = source.sections
    .filter((s) => s.type === "experience")
    .flatMap((s) => s.items)
    .filter((item) => !section.items.some((kept) => sameJob(kept, item)))

  return missing.length === 0
    ? section
    : { ...section, items: [...section.items, ...missing] }
}

/**
 * Ids cannot be used: the tailored document's ids are minted fresh by
 * `assembleResume` and match nothing. Company, role and start are what the
 * model is forbidden to change, which is exactly what makes them the key.
 */
function sameJob(a: Item, b: Item): boolean {
  if (a.kind !== "experience" || b.kind !== "experience") return false
  return (
    norm(a.company) === norm(b.company) &&
    norm(a.role) === norm(b.role) &&
    norm(a.start) === norm(b.start)
  )
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}
```

If `Item` is not exported from `@workspace/resume-schema` under that name, use whatever `ItemSchema` infers to; do not re-declare the union.

- [ ] **Step 4: Export it**

Add `export * from "./tailor"` to `packages/resume-core/src/domain/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `bun run --filter @workspace/resume-core test tailor-rules`
Expected: PASS, all five cases.

- [ ] **Step 6: Commit**

```bash
git add packages/resume-core
git commit -m "Enforce experience survival and drop emptied sections"
```

---

### Task 8: `TailorService`

The orchestration, and the four small changes to existing services it needs.

**Files:**
- Create: `packages/resume-core/src/services/tailor-service.ts`
- Create: `packages/resume-core/test/tailor-service.test.ts`
- Modify: `packages/resume-core/src/services/resume-service.ts` (`CreateResumeInput`, `setSubtitle`)
- Modify: `packages/resume-core/src/ports/resume-repository.ts` (`setSubtitle`)
- Modify: `packages/resume-core/src/testing/in-memory-resume-repository.ts`
- Modify: `apps/web/src/server/adapters/resume-repository.ts`
- Modify: `packages/resume-core/src/services/run-service.ts` (`startForCreation`)
- Modify: `packages/resume-core/src/domain/suggestion.ts` (`RunInputSchema`)
- Modify: `packages/resume-core/src/services/container.ts`, `src/services/index.ts`
- Modify: `packages/resume-core/src/testing/ports.ts`
- Modify: `packages/resume-core/test/harness.ts`

**Interfaces:**
- Consumes: `JobTargetRepository` (Task 4), `JobParser` (Task 5), `ResumeTailor` (Task 6), `enforceTailorRules` (Task 7), `MIN_JOB_CHARS`, `MAX_JOB_CHARS`.
- Produces:
  - `TAILOR_SKILL_ID = "tailor_from_job"`
  - `type TailorFromJobInput = { sourceResumeId: string; jobText: string; sourceUrl?: string; signal?: AbortSignal }`
  - `type TailorFromJobResult = { resume: ResumeSummary; jobTargetId: string; tailored: boolean; model: string | null }`
  - `class TailorService` with `tailorFromJob(input): Promise<TailorFromJobResult>`
  - `Ports` gains `jobTargets`, `jobParser`, `resumeTailor`, `jobFetcher`
  - `Services` gains `tailor: TailorService`
  - `ResumeService.setSubtitle(id, subtitle): Promise<void>`
  - `RunService.startForCreation(input: StartRunInput): Promise<AgentRun>`

- [ ] **Step 1: Add `subtitle` to create, and a subtitle setter**

In `packages/resume-core/src/services/resume-service.ts`:

```ts
export type CreateResumeInput = {
  title?: string
  /**
   * Forces the line under the title. Without it a copy inherits the source's,
   * which would let a resume claim it was tailored for a company it has never
   * been near, because its source once was.
   */
  subtitle?: string
  /** When set, the new resume is a deep copy with every node id regenerated. */
  fromResumeId?: string
  document?: Resume
}
```

and in `create`, replace the subtitle expression:

```ts
      subtitle:
        input.subtitle ??
        (source
          ? source.subtitle
          : input.document
            ? IMPORTED_SUBTITLE
            : NEW_SUBTITLE),
```

Export the constants so the tailor service can reuse the neutral one:

```ts
export const NEW_SUBTITLE = "Draft · not tailored"
```

Add the setter next to `rename`, matching it exactly:

```ts
  async setSubtitle(id: string, subtitle: string): Promise<void> {
    if (!(await this.resumes.setSubtitle(id, subtitle))) {
      throw new AppError("NOT_FOUND", "Resume not found")
    }
  }
```

- [ ] **Step 2: Add `setSubtitle` to the port and both adapters**

In `packages/resume-core/src/ports/resume-repository.ts`, beside `rename`:

```ts
  setSubtitle(id: string, subtitle: string): Promise<boolean>
```

Implement it in `InMemoryResumeRepository` and `SupabaseResumeRepository` by copying `rename` and swapping the column. Like `rename`, it must not move `revision`: the line under the title is not the document.

- [ ] **Step 3: Add the creation-time run**

In `packages/resume-core/src/services/run-service.ts`, below `start`:

```ts
  /**
   * A run against a resume that is being created rather than edited.
   *
   * No "Before AI run" snapshot, because there is no earlier state worth
   * restoring: the head is the untouched duplicate, and this flow writes
   * exactly one version whether the model succeeds or not. No running-run
   * check either, because the conversation was opened one line ago.
   */
  startForCreation(input: StartRunInput): Promise<AgentRun> {
    return this.runs.create({
      conversationId: input.conversationId,
      resumeId: input.resumeId,
      skillId: input.skillId,
      model: input.model,
      selectedNodeId: input.selectedNodeId ?? null,
      resumeVersionId: null,
      input: input.input,
    })
  }
```

- [ ] **Step 4: Widen the run input**

In `packages/resume-core/src/domain/suggestion.ts`:

```ts
export const RunInputSchema = z.object({
  jobDescription: z.string().optional(),
  targetPages: z.number().int().optional(),
  /** Tailoring: ids only. The posting text lives on the `job_targets` row. */
  jobTargetId: z.string().optional(),
  sourceResumeId: z.string().optional(),
})
```

- [ ] **Step 5: Write the service**

```ts
import {
  assembleResume,
  regenerateIds,
  ResumeSchema,
} from "@workspace/resume-schema"

import { AppError } from "../domain/errors"
import {
  MAX_JOB_CHARS,
  MIN_JOB_CHARS,
  type ParsedJobPosting,
} from "../domain/job-target"
import type { ResumeSummary } from "../domain/resume"
import { enforceTailorRules } from "../domain/tailor"
import type { JobParser } from "../ports/job-parser"
import type { JobTargetRepository } from "../ports/job-target-repository"
import type { ResumeTailor } from "../ports/resume-tailor"
import type { MemoryService } from "./memory-service"
import { NEW_SUBTITLE, type ResumeService } from "./resume-service"
import type { RunService } from "./run-service"
import type { VersionService } from "./version-service"

/**
 * Deliberately not a member of the `SKILLS` registry. A skill is something the
 * assistant chooses between mid-conversation and whose patches are checked
 * against an op and field whitelist; this is neither, and adding it to the
 * registry would put a whole-document writer behind a union that promises
 * patch validation.
 */
export const TAILOR_SKILL_ID = "tailor_from_job"

export type TailorFromJobInput = {
  sourceResumeId: string
  jobText: string
  /** The canonical LinkedIn URL, when the text was fetched rather than pasted. */
  sourceUrl?: string
  signal?: AbortSignal
}

export type TailorFromJobResult = {
  resume: ResumeSummary
  jobTargetId: string
  /** False when the writing call failed, timed out, or was cancelled. */
  tailored: boolean
  model: string | null
}

/**
 * Creates a resume from a job posting.
 *
 * The resume row is created before the writing call, which is what makes every
 * failure land on one path. `agent_runs.conversation_id` is not null and a
 * conversation needs a resume, so the ordering was forced; the consequence is
 * that a model failure costs the user a plain duplicate rather than nothing,
 * which is worth having on purpose.
 */
export class TailorService {
  constructor(
    private readonly jobParser: JobParser,
    private readonly resumeTailor: ResumeTailor,
    private readonly jobTargets: JobTargetRepository,
    private readonly resumes: ResumeService,
    private readonly versions: VersionService,
    private readonly runs: RunService,
    private readonly memory: MemoryService
  ) {}

  async tailorFromJob(
    input: TailorFromJobInput
  ): Promise<TailorFromJobResult> {
    const text = input.jobText.trim()
    if (text.length < MIN_JOB_CHARS) {
      throw new AppError(
        "VALIDATION",
        "That is too short to be a job posting. Paste the whole description."
      )
    }
    if (text.length > MAX_JOB_CHARS) {
      throw new AppError(
        "VALIDATION",
        `That is over the ${MAX_JOB_CHARS.toLocaleString()} character limit. Trim it and try again.`
      )
    }

    // Before either model call, so a user who has exhausted the hour is told
    // so rather than being charged for the parse.
    await this.runs.assertWithinHourlyLimit()

    const source = await this.resumes.get(input.sourceResumeId)

    const { parsed: posting, model: parseModel } = await this.jobParser.parse({
      text,
      signal: input.signal,
    })

    const target = await this.jobTargets.create({
      sourceUrl: input.sourceUrl ?? null,
      rawText: text,
      title: posting.title,
      company: posting.company,
      location: posting.location ?? null,
      requirements: {
        mustHaves: posting.mustHaves,
        niceToHaves: posting.niceToHaves,
        keywords: posting.keywords,
      },
    })

    // The neutral subtitle, upgraded only once the document is actually
    // written. A resume that never got tailored must not say that it was.
    const created = await this.resumes.create({
      fromResumeId: source.id,
      title: titleFor(posting, source.title),
      subtitle: NEW_SUBTITLE,
    })

    await this.jobTargets.link({
      resumeId: created.id,
      jobTargetId: target.id,
      isOrigin: true,
    })

    const conversation = await this.memory.openConversation(created.id)
    const run = await this.runs.startForCreation({
      conversationId: conversation.id,
      resumeId: created.id,
      skillId: TAILOR_SKILL_ID,
      model: parseModel,
      // Ids only. `finish` clears this column anyway; the link row is what
      // makes the posting recoverable afterwards.
      input: { jobTargetId: target.id, sourceResumeId: source.id },
    })

    const startedAt = Date.now()
    try {
      const { parsed, model } = await this.resumeTailor.tailor({
        resume: source.data,
        posting,
        signal: input.signal,
      })

      // `assembleResume` mints ids for the model's id-free output; restoring a
      // source item reintroduces the source's ids, so the whole document is
      // renumbered once before it is validated.
      const merged = regenerateIds(
        enforceTailorRules(source.data, assembleResume(parsed))
      )
      const checked = ResumeSchema.safeParse(merged)
      if (!checked.success) {
        throw new AppError(
          "VALIDATION",
          checked.error.issues[0]?.message ?? "The tailored resume was invalid"
        )
      }

      await this.resumes.update({ id: created.id, data: checked.data })
      const subtitle = subtitleFor(posting)
      await this.resumes.setSubtitle(created.id, subtitle)
      await this.runs.finish(run.id, {
        status: "completed",
        latencyMs: Date.now() - startedAt,
      })
      await this.versions.snapshot(created.id, {
        label: labelFor(posting),
        createdBy: "system",
        agentRunId: run.id,
      })

      return {
        resume: { ...created, subtitle },
        jobTargetId: target.id,
        tailored: true,
        model,
      }
    } catch (error) {
      const cancelled = isAbort(error)
      await this.runs.finish(run.id, {
        status: cancelled ? "cancelled" : "failed",
        errorClass: cancelled ? "aborted" : "tailor_failed",
        latencyMs: Date.now() - startedAt,
      })
      // The duplicate stands. One version either way, so History reads the
      // same whichever path ran, and only the label says which.
      await this.versions.snapshot(created.id, {
        label: `Assembled from ${source.title}`,
        createdBy: "system",
        agentRunId: run.id,
      })

      return {
        resume: created,
        jobTargetId: target.id,
        tailored: false,
        model: null,
      }
    }
  }
}

/** Static, set once. Deriving it from a join would rename the resume whenever
 *  the user attached another posting to it. */
function titleFor(posting: ParsedJobPosting, fallback: string): string {
  const company = posting.company.trim()
  const role = posting.title.trim()
  if (company && role) return `${company} - ${role}`
  return company || role || `${fallback} copy`
}

function subtitleFor(posting: ParsedJobPosting): string {
  const company = posting.company.trim()
  return company ? `Tailored for ${company}` : "Tailored for this role"
}

function labelFor(posting: ParsedJobPosting): string {
  const role = posting.title.trim() || "this role"
  const company = posting.company.trim()
  return company ? `Tailored for ${role} at ${company}` : `Tailored for ${role}`
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}
```

- [ ] **Step 6: Wire the container**

In `packages/resume-core/src/services/container.ts`, add to `Ports`:

```ts
  jobTargets: JobTargetRepository
  jobParser: JobParser
  resumeTailor: ResumeTailor
  jobFetcher: JobFetcher
```

add `tailor: TailorService` to `Services`, and inside `createServices`:

```ts
    tailor: new TailorService(
      ports.jobParser,
      ports.resumeTailor,
      ports.jobTargets,
      resumes,
      versions,
      new RunService(versions, ports.runs, ports.clock),
      memory
    ),
```

`runs` and `memory` are already constructed in that function; hoist them into `const` bindings and pass the same instances rather than building second ones. Add `export * from "./tailor-service"` to `src/services/index.ts`.

`JobFetcher` is declared in Task 9. Write Task 9's port file first if the type does not resolve, or do Task 9 before this step; the two are one commit's worth of dependency either way.

- [ ] **Step 7: Wire the test ports**

In `packages/resume-core/src/testing/ports.ts`:

```ts
    jobTargets: new InMemoryJobTargetRepository(db),
    jobParser: new StubJobParser(),
    resumeTailor: new StubResumeTailor(),
    jobFetcher: new StubJobFetcher(),
```

and add `tailorService: services.tailor` to `harness()` in `packages/resume-core/test/harness.ts`.

- [ ] **Step 8: Write the service test**

```ts
import type { ParsedResume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { harness } from "./harness"

const POSTING = "x".repeat(400)

const PARSED_JOB = {
  title: "Senior Engineer",
  company: "Acme",
  mustHaves: ["TypeScript"],
  niceToHaves: [],
  keywords: ["React"],
}

const TAILORED: ParsedResume = {
  basics: { name: "Ada Lovelace", summary: "Engineer who ships TypeScript." },
  sections: [
    {
      type: "experience",
      title: "Experience",
      items: [
        {
          company: "Babbage & Co",
          role: "Analyst",
          start: "1842",
          end: "1843",
          bullets: ["Shipped the first program, in TypeScript terms."],
        },
      ],
    },
  ],
}

async function seed(h: ReturnType<typeof harness>) {
  const base = await h.resumeService.create({ title: "Ada Lovelace" })
  return base
}

describe("TailorService", () => {
  it("names the resume after the posting and writes exactly one version", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB
    h.resumeTailor.result = TAILORED

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
    })

    expect(result.tailored).toBe(true)
    expect(result.resume.title).toBe("Acme - Senior Engineer")
    expect(result.resume.subtitle).toBe("Tailored for Acme")

    const versions = await h.versionService.list(result.resume.id)
    expect(versions.map((v) => [v.label, v.createdBy])).toEqual([
      ["Tailored for Senior Engineer at Acme", "system"],
    ])
  })

  it("stores the posting and links it to the new resume as its origin", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
      sourceUrl: "https://www.linkedin.com/jobs/view/4456278957/",
    })

    const target = await h.jobTargets.findById(result.jobTargetId)
    expect(target?.company).toBe("Acme")
    expect(target?.rawText).toBe(POSTING)
    expect(await h.jobTargets.listForResume(result.resume.id)).toEqual([target])
  })

  it("keeps the plain duplicate when the writing call fails", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB
    h.resumeTailor.failWith = new Error("provider down")

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
    })

    expect(result.tailored).toBe(false)
    expect(result.resume.subtitle).toBe("Draft · not tailored")

    const record = await h.resumeService.get(result.resume.id)
    const original = await h.resumeService.get(base.id)
    expect(record.data.basics.name).toBe(original.data.basics.name)

    const versions = await h.versionService.list(result.resume.id)
    expect(versions.map((v) => v.label)).toEqual([
      "Assembled from Ada Lovelace",
    ])
  })

  it("does not create a resume when the source does not exist", async () => {
    const h = harness()
    h.jobParser.result = PARSED_JOB

    await expect(
      h.tailorService.tailorFromJob({
        sourceResumeId: "missing",
        jobText: POSTING,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    expect(await h.resumeService.list()).toHaveLength(0)
    expect(h.jobParser.calls).toHaveLength(0)
  })

  it("refuses a posting too short to tailor against, before any model call", async () => {
    const h = harness()
    const base = await seed(h)

    await expect(
      h.tailorService.tailorFromJob({
        sourceResumeId: base.id,
        jobText: "Senior Engineer at Acme",
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })

    expect(h.jobParser.calls).toHaveLength(0)
    expect(await h.resumeService.list()).toHaveLength(1)
  })

  it("records the run against the new resume, not the source", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB
    h.resumeTailor.result = TAILORED

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
    })

    const runs = h.db.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]?.resumeId).toBe(result.resume.id)
    expect(runs[0]?.skillId).toBe("tailor_from_job")
  })
})
```

The last test reads `h.db.runs` directly because there is no service that lists runs; check `InMemoryDb`'s field name and the `AgentRun` casing before relying on it.

- [ ] **Step 9: Run everything**

```bash
bun run typecheck && bun run check && bun run test
```
Expected: PASS. Existing `resume-service` and `import-service` tests still pass, because `subtitle` is optional and `setSubtitle` is additive.

- [ ] **Step 10: Commit**

```bash
git add packages/resume-core apps/web/src/server/adapters/resume-repository.ts
git commit -m "Add TailorService, which creates a resume from a job posting"
```

---

### Task 9: Fetching a LinkedIn posting

The fetch is its own round trip, ending with the text in the textarea. The textarea is the confirmation step: the user sees what will be sent before anything is generated, and a failed fetch degrades to the paste box that is already on screen.

**Files:**
- Create: `packages/resume-core/src/ports/job-fetcher.ts`
- Create: `packages/resume-core/src/testing/stub-job-fetcher.ts`
- Create: `apps/web/src/server/adapters/job-fetcher.ts`
- Create: `apps/web/src/server/fns/jobs.ts`
- Create: `packages/resume-core/test/fetch-posting.test.ts`
- Modify: `packages/resume-core/src/services/tailor-service.ts`, `src/ports/index.ts`, `src/testing/index.ts`
- Modify: `apps/web/src/server/container.ts`

**Interfaces:**
- Consumes: `normalizeLinkedInJobUrl` (Task 2), `MAX_JOB_CHARS` (Task 4), `TailorService` (Task 8).
- Produces:
  - `interface JobFetcher { fetch(url: string, signal?: AbortSignal): Promise<string> }`
  - `TailorService.fetchPosting(rawUrl: string, signal?: AbortSignal): Promise<{ url: string; text: string }>`
  - `fetchJobPosting` server function taking `{ url: string }`
  - `class StubJobFetcher` with `text`, `failWith`, `calls`

- [ ] **Step 1: Write the port and the stub**

```ts
/**
 * Fetches a job posting as plain text. Implemented on the Worker, where the
 * request has no browser fingerprint and no session, which is why this often
 * comes back as a sign-in wall rather than a posting.
 */
export interface JobFetcher {
  fetch(url: string, signal?: AbortSignal): Promise<string>
}
```

```ts
import type { JobFetcher } from "../ports/job-fetcher"

export class StubJobFetcher implements JobFetcher {
  text = ""
  failWith: Error | null = null
  readonly calls: string[] = []

  async fetch(url: string): Promise<string> {
    this.calls.push(url)
    if (this.failWith) throw this.failWith
    return this.text
  }
}
```

Add the two barrel exports.

- [ ] **Step 2: Add the service method**

Add to `TailorService`, taking `JobFetcher` as an eighth constructor argument and `normalizeLinkedInJobUrl` plus `MAX_JOB_CHARS` to the imports:

```ts
  /**
   * Fetches a posting so the user can read it before generating anything.
   *
   * LinkedIn is the only host accepted, because it is the only one whose URL
   * shapes are known well enough to normalise and the only one whose markup
   * this strips correctly. Everything else is a paste.
   */
  async fetchPosting(
    rawUrl: string,
    signal?: AbortSignal
  ): Promise<{ url: string; text: string }> {
    const url = normalizeLinkedInJobUrl(rawUrl)
    if (!url) {
      throw new AppError(
        "VALIDATION",
        "That is not a LinkedIn job link. Paste the description instead."
      )
    }

    const text = await this.jobFetcher.fetch(url, signal)
    const trimmed = text.trim().slice(0, MAX_JOB_CHARS)
    if (trimmed.length < MIN_JOB_CHARS) {
      throw new AppError(
        "NOT_FOUND",
        "That posting could not be read. Open it and paste the description instead."
      )
    }
    return { url, text: trimmed }
  }
```

- [ ] **Step 3: Write the Worker adapter**

```ts
import type { JobFetcher } from "@workspace/resume-core"

/**
 * Fetches a posting on the Worker and reduces it to text.
 *
 * There is no HTML parser here on purpose: the Worker has no DOM, a parser
 * would be a dependency for one call site, and a job posting is prose. Scripts
 * and styles go first so their contents do not survive as text, then tags
 * become nothing and block-level ones become newlines.
 */
const BLOCK = /<\/(?:p|div|li|ul|ol|h[1-6]|section|br)\s*>|<br\s*\/?>/gi
const DROP = /<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi
const TAG = /<[^>]+>/g
const ENTITY: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
}

/** A browser user agent, because the bare Worker one is refused outright. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const TIMEOUT_MS = 10_000

export class WorkerJobFetcher implements JobFetcher {
  async fetch(url: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const response = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) return ""
    return toText(await response.text())
  }
}

function toText(html: string): string {
  return html
    .replace(DROP, " ")
    .replace(BLOCK, "\n")
    .replace(TAG, " ")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITY[entity.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
```

- [ ] **Step 4: Wire the web container**

In `apps/web/src/server/container.ts`, add the two lazy model ports beside the existing ones and the two direct ones:

```ts
import { createJobParser, createResumeTailor } from "@workspace/agent"
import { SupabaseJobTargetRepository } from "./adapters/job-target-repository"
import { WorkerJobFetcher } from "./adapters/job-fetcher"

/** Same reason as the summarizer: only tailoring needs the key. */
const lazyJobParser: JobParser = {
  parse: (input) => createJobParser(createModelsFromEnv()).parse(input),
}

const lazyResumeTailor: ResumeTailor = {
  tailor: (input) => createResumeTailor(createModelsFromEnv()).tailor(input),
}

const jobFetcher = new WorkerJobFetcher()
```

and inside `supabasePorts`:

```ts
    jobTargets: new SupabaseJobTargetRepository(db, userId),
    jobParser: lazyJobParser,
    resumeTailor: lazyResumeTailor,
    jobFetcher,
```

Import the two port types alongside the existing `ResumeParser` and `Summarizer` type imports.

- [ ] **Step 5: Write the server function**

Create `apps/web/src/server/fns/jobs.ts`:

```ts
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { serve } from "../handler"
import { errorClassOf } from "../log"

/**
 * Fetches a LinkedIn posting so the user can read it before generating.
 *
 * The log records that a fetch happened and how it ended, never the URL and
 * never the text: a job link identifies what a person is applying for.
 */
export const fetchJobPosting = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().max(2000) }))
  .handler(
    serve(async ({ services, log, data }) => {
      const startedAt = Date.now()
      try {
        const result = await services.tailor.fetchPosting(data.url)
        log.info("job_fetch_finished", {
          charCount: result.text.length,
          latencyMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        log.warn("job_fetch_failed", {
          errorClass: errorClassOf(error),
          latencyMs: Date.now() - startedAt,
        })
        throw error
      }
    })
  )
```

- [ ] **Step 6: Write the test**

```ts
import { describe, expect, it } from "vitest"

import { harness } from "./harness"

describe("TailorService.fetchPosting", () => {
  it("normalises the url before fetching and returns the text", async () => {
    const h = harness()
    // The stub returns what the adapter would have produced: plain text.
    // Stripping HTML is `WorkerJobFetcher`'s job, not the service's.
    h.jobFetcher.text = `We are hiring a Senior Engineer. ${"detail ".repeat(60)}`

    const result = await h.tailorService.fetchPosting(
      "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4456278957"
    )

    expect(h.jobFetcher.calls).toEqual([
      "https://www.linkedin.com/jobs/view/4456278957/",
    ])
    expect(result.url).toBe("https://www.linkedin.com/jobs/view/4456278957/")
    expect(result.text).toContain("We are hiring")
  })

  it("rejects a non-LinkedIn link without fetching anything", async () => {
    const h = harness()

    await expect(
      h.tailorService.fetchPosting("https://www.indeed.com/viewjob?jk=1")
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(h.jobFetcher.calls).toHaveLength(0)
  })

  it("treats a sign-in wall as unreadable rather than as a posting", async () => {
    const h = harness()
    h.jobFetcher.text = "Sign in to view this job"

    await expect(
      h.tailorService.fetchPosting(
        "https://www.linkedin.com/jobs/view/4456278957/"
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
```

`WorkerJobFetcher.toText` is not covered here. It is a regex pipeline over HTML with no dependencies, so if you want it tested, add a separate `apps/web` unit test for `toText` alone; do not reach for the network from a test.

- [ ] **Step 7: Verify**

```bash
bun run typecheck && bun run check && bun run test
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/resume-core apps/web/src/server
git commit -m "Fetch a LinkedIn posting on the Worker and strip it to text"
```

---

### Task 10: The generation server function and the browser's data layer

**Files:**
- Modify: `apps/web/src/server/fns/jobs.ts`
- Modify: `apps/web/src/lib/api.ts`
- Read only: `apps/web/src/lib/queries.ts` (confirm no hook is needed)

**Interfaces:**
- Consumes: `TailorService.tailorFromJob` (Task 8), `fetchJobPosting` (Task 9).
- Produces:
  - `tailorFromJob` server function taking `{ sourceResumeId, jobText, sourceUrl? }`
  - `api.fetchJobPosting(input, signal)` and `api.tailorFromJob(input, signal)`
  - `useTailorFromJob()` is not added; the dialog owns the request, like import does.

- [ ] **Step 1: Add the generation server function**

Append to `apps/web/src/server/fns/jobs.ts`:

```ts
import { MAX_JOB_CHARS } from "@workspace/resume-core"

/**
 * Creates the resume. Two model calls behind one request, so the log records
 * which of them the run got to, never the posting or the document.
 */
export const tailorFromJob = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sourceResumeId: z.uuid(),
      jobText: z.string().max(MAX_JOB_CHARS),
      sourceUrl: z.string().max(2000).optional(),
    })
  )
  .handler(
    serve(async ({ services, log, data }) => {
      const startedAt = Date.now()
      try {
        const result = await services.tailor.tailorFromJob(data)
        log.info("tailor_finished", {
          resumeId: result.resume.id,
          jobTargetId: result.jobTargetId,
          tailored: result.tailored,
          model: result.model,
          charCount: data.jobText.length,
          latencyMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        log.warn("tailor_failed", {
          errorClass: errorClassOf(error),
          charCount: data.jobText.length,
          latencyMs: Date.now() - startedAt,
        })
        throw error
      }
    })
  )
```

- [ ] **Step 2: Add both calls to the api layer**

In `apps/web/src/lib/api.ts`, import the two functions and write them out rather than wrapping them in `guard`, for the same reason `importResume` is written out: both carry an `AbortSignal` and `guard` has nowhere to put one.

```ts
import {
  fetchJobPosting as fetchJobPostingFn,
  tailorFromJob as tailorFromJobFn,
} from "@/server/fns/jobs"

/**
 * Fetches a LinkedIn posting so the user can read it before generating. The
 * text lands in the textarea, which is the confirmation step: nothing is
 * generated from something the user has not seen.
 */
export async function fetchJobPosting(
  input: { url: string },
  signal?: AbortSignal
): Promise<{ url: string; text: string }> {
  try {
    return await fetchJobPostingFn({ data: input, signal })
  } catch (error) {
    throw toApiError(error)
  }
}

/**
 * Creates a resume from a posting. Resolves with `tailored: false` rather than
 * rejecting when the writing call fails: the user still has a resume, and the
 * dialog says which one they got.
 */
export async function tailorFromJob(
  input: { sourceResumeId: string; jobText: string; sourceUrl?: string },
  signal?: AbortSignal
): Promise<TailorFromJobResult> {
  try {
    return await tailorFromJobFn({ data: input, signal })
  } catch (error) {
    throw toApiError(error)
  }
}
```

`TailorFromJobResult` is re-exported from `@workspace/resume-core`; add it to whichever type barrel `apps/web/src/lib/types.ts` already uses for `ResumeSummary`, rather than importing the package directly in `api.ts` if that file does not already.

- [ ] **Step 3: Leave `queries.ts` alone except for one line**

The dialog owns the request, so there is no mutation hook. The only change is that the Job tab invalidates the resume list on success, which it does through the existing `resumesQuery().queryKey` the way `ImportDialog.finish` already does. No edit to `queries.ts` is required; confirm that and move on rather than adding a hook nothing calls.

- [ ] **Step 4: Verify**

```bash
bun run typecheck && bun run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "Expose posting fetch and resume tailoring to the browser"
```

---

### Task 11: The Job tab

Two entry points, one dialog. `ImportDialog` gains a tab strip; the rail's per-resume menu opens the same dialog on the Job tab with that resume already chosen.

There is no `tabs` component in `@workspace/ui`, so the strip is two buttons and a piece of state. Do not add a shadcn tabs primitive for two tabs.

**Files:**
- Create: `apps/web/src/features/import/JobTab.tsx`
- Create: `apps/web/src/features/import/JobProgress.tsx`
- Create: `apps/web/src/features/import/use-tailor.ts`
- Modify: `apps/web/src/features/import/ImportDialog.tsx`
- Modify: `apps/web/src/features/shell/ResumeRail.tsx`

**Interfaces:**
- Consumes: `fetchJobPosting`, `tailorFromJob` from `@/lib/api` (Task 10).
- Produces:
  - `ImportDialog` props become `{ open, onOpenChange, tab?: "upload" | "job", sourceResumeId?: string }`
  - `useTailor(onDone)` returning `{ progress, failure, busy, fetching, fetchPosting, run, cancel, reset }`
  - `TailorStage = "reading" | "writing"`

- [ ] **Step 1: Write the hook**

```ts
import { useCallback, useRef, useState } from "react"

import { fetchJobPosting, tailorFromJob } from "@/lib/api"
import { ApiError, type TailorFromJobResult } from "@/lib/types"

export type TailorStage = "reading" | "writing"

export type TailorInput = {
  sourceResumeId: string
  jobText: string
  sourceUrl?: string
}

/**
 * One generation, start to finish, inside the dialog.
 *
 * Same shape as `useImport` and for the same reason: there is no queue behind
 * this, so the work lives exactly as long as the request. Cancelling abandons
 * it, and the dialog stays open until it is done.
 */
export function useTailor(onDone: (result: TailorFromJobResult) => void) {
  const [stage, setStage] = useState<TailorStage | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStage(null)
  }, [])

  const reset = useCallback(() => setFailure(null), [])

  const fetchPosting = useCallback(async (url: string) => {
    setFailure(null)
    setFetching(true)
    try {
      return await fetchJobPosting({ url })
    } catch (error) {
      setFailure(messageFor(error))
      return null
    } finally {
      setFetching(false)
    }
  }, [])

  const run = useCallback(
    async (input: TailorInput) => {
      const controller = new AbortController()
      abort.current = controller
      setFailure(null)

      try {
        // Two stages, both indeterminate. Neither the posting nor the document
        // gives a number to count towards, so nothing pretends otherwise.
        setStage("reading")
        const started = tailorFromJob(input, controller.signal)
        setStage("writing")
        const result = await started
        if (controller.signal.aborted) return

        setStage(null)
        onDone(result)
      } catch (error) {
        setStage(null)
        if (isAbort(error)) return
        setFailure(messageFor(error))
      } finally {
        abort.current = null
      }
    },
    [onDone]
  )

  return {
    progress: stage,
    failure,
    fetching,
    busy: stage !== null,
    fetchPosting,
    run,
    cancel,
    reset,
  }
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === "INTERNAL"
      ? "Something went wrong building that resume. Try again."
      : error.message
  }
  return "Something went wrong. Try again."
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
```

The two stages are set around a single request, so "writing" appears immediately. That is honest about ordering and dishonest about timing. If that reads badly once the dialog is on screen, collapse it to one stage rather than inventing a timer.

- [ ] **Step 2: Write the progress panel**

```ts
import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import type { TailorStage } from "./use-tailor"

const STAGES: { id: TailorStage; label: string }[] = [
  { id: "reading", label: "Reading the job posting" },
  { id: "writing", label: "Writing your resume" },
]

/** Neither stage can be measured, so both get the indeterminate bar rather
 *  than a percentage nobody could compute. */
export function JobProgressPanel({
  stage,
  onCancel,
}: {
  stage: TailorStage
  onCancel: () => void
}) {
  const current = STAGES.findIndex((entry) => entry.id === stage)

  return (
    <div className="flex flex-col gap-4 py-1">
      <ol className="flex flex-col gap-2.5">
        {STAGES.map((entry, index) => {
          const state =
            index < current ? "done" : index === current ? "active" : "waiting"
          return (
            <li
              key={entry.id}
              className={cn(
                "flex items-center gap-2.5 text-[12.5px]",
                state === "waiting" && "text-muted-foreground/60",
                state === "done" && "text-muted-foreground",
                state === "active" && "font-medium text-foreground"
              )}
            >
              {state === "done" ? (
                <CheckCircleIcon weight="fill" className="size-4 flex-none text-ok" />
              ) : state === "active" ? (
                <Spinner className="size-4 flex-none text-primary" />
              ) : (
                <CircleIcon className="size-4 flex-none" />
              )}
              <span>{entry.label}</span>
            </li>
          )
        })}
      </ol>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span className="block h-full w-1/3 animate-[preview-scan_1.1s_ease-in-out_infinite] rounded-full bg-primary/70" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-muted-foreground">
          Keep this open. Closing it stops the work.
        </p>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the Job tab**

```tsx
import { SparkleIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { useState } from "react"

import { resumesQuery } from "@/lib/queries"
import type { TailorFromJobResult } from "@/lib/types"
import { JobProgressPanel } from "./JobProgress"
import { useTailor } from "./use-tailor"

/** Below this the posting is a job title, and tailoring has nothing to work from. */
const MIN_CHARS = 200

/**
 * One pane, not a wizard. The link and the description are the same field in
 * two steps: fetching fills the textarea, and the textarea is what gets sent,
 * so the user always reads the posting before anything is generated.
 */
export function JobTab({
  sourceResumeId,
  onDone,
}: {
  sourceResumeId?: string
  onDone: (result: TailorFromJobResult) => void
}) {
  const { data: resumes } = useQuery(resumesQuery())
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [source, setSource] = useState(sourceResumeId ?? "")
  const { progress, failure, fetching, busy, fetchPosting, run, cancel } =
    useTailor(onDone)

  if (progress) return <JobProgressPanel stage={progress} onCancel={cancel} />

  const ready = source !== "" && text.trim().length >= MIN_CHARS

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <label
          htmlFor="job-url"
          className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
        >
          LinkedIn job link
        </label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="job-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.linkedin.com/jobs/view/..."
            className="text-[12.5px]"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={url.trim() === "" || fetching}
            onClick={() => {
              void fetchPosting(url).then((result) => {
                if (result) setText(result.text)
              })
            }}
          >
            {fetching ? "Fetching" : "Fetch"}
          </Button>
        </div>
      </div>

      <div>
        <label
          htmlFor="job-text"
          className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
        >
          Job description
        </label>
        <Textarea
          id="job-text"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste the description, or fetch it from the link above."
          className="mt-1.5 max-h-48 text-[12.5px]"
        />
      </div>

      <div>
        <label
          htmlFor="job-source"
          className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
        >
          Build it from
        </label>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger id="job-source" className="mt-1.5 w-full text-[12.5px]">
            <SelectValue placeholder="Choose a resume" />
          </SelectTrigger>
          <SelectContent>
            {(resumes ?? []).map((resume) => (
              <SelectItem key={resume.id} value={resume.id}>
                {resume.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {failure ? (
        <p className="text-[12px] leading-[1.5] text-destructive">{failure}</p>
      ) : null}

      <p className="text-[11.5px] leading-[1.5] text-muted-foreground">
        The assistant rewrites your resume against this posting. Read the result
        before you send it anywhere: check the wording is still true of you, and
        that nothing has been added that you would not say yourself.
      </p>

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() =>
            void run({
              sourceResumeId: source,
              jobText: text,
              sourceUrl: url.trim() || undefined,
            })
          }
        >
          <SparkleIcon />
          Create resume
        </Button>
      </div>
    </div>
  )
}
```

`sourceUrl` is sent as the user typed it. The server normalises it again in `fetchPosting`, but `tailorFromJob` stores it raw; if that matters, normalise in `TailorService.tailorFromJob` before writing the row, using the same `normalizeLinkedInJobUrl` and falling back to null.

- [ ] **Step 4: Add the tab strip to `ImportDialog`**

Change the props and add the state:

```tsx
export function ImportDialog({
  open,
  onOpenChange,
  tab: initialTab = "upload",
  sourceResumeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab?: "upload" | "job"
  sourceResumeId?: string
}) {
  const [tab, setTab] = useState<"upload" | "job">(initialTab)
```

Reset the tab whenever the dialog opens, so the rail's menu item lands on Job and the rail's New button lands on Upload:

```tsx
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])
```

Between `DialogHeader` and the body, add the strip. It is hidden while `busy`, because switching tabs mid-import would abandon work the dialog is refusing to close over:

```tsx
        {busy ? null : (
          <div className="flex gap-1 rounded-[9px] bg-muted p-0.5">
            <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
              Upload or paste
            </TabButton>
            <TabButton
              active={tab === "job"}
              disabled={(resumes?.length ?? 0) === 0}
              title={
                (resumes?.length ?? 0) === 0
                  ? "Import or create a resume first"
                  : undefined
              }
              onClick={() => setTab("job")}
            >
              From a job posting
            </TabButton>
          </div>
        )}
```

with the button, at the bottom of the file next to `Notice`:

```tsx
function TabButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex-1 rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground"
      )}
    >
      {children}
    </button>
  )
}
```

`resumes` comes from `useQuery(resumesQuery())`, which the dialog does not currently call; add it.

Wrap the existing body so the Job tab renders in its place, and give the Job tab the same `finish`:

```tsx
        {tab === "job" ? (
          <JobTab
            sourceResumeId={sourceResumeId}
            onDone={(result) => {
              if (!result.tailored) {
                toast.warning(
                  "The assistant could not rewrite it, so this is a plain copy of the resume you picked."
                )
              }
              void finish(result.resume)
            }}
          />
        ) : progress ? (
          <ImportProgressPanel progress={progress} onCancel={cancel} />
        ) : (
          /* the existing upload pane, unchanged */
        )}
```

Update `DialogDescription` so it fits both tabs:

```tsx
          <DialogDescription>
            Start from a resume you already have, from a blank page, or from a
            job you want to apply for.
          </DialogDescription>
```

- [ ] **Step 5: Add the rail menu item**

In `apps/web/src/features/shell/ResumeRail.tsx`, add state beside the existing `importing`:

```tsx
  const [tailoring, setTailoring] = useState<string | null>(null)
```

a menu item after Duplicate:

```tsx
                      <DropdownMenuItem onClick={() => setTailoring(resume.id)}>
                        Tailor for a job
                      </DropdownMenuItem>
```

and a second dialog instance beside the existing one. Two instances rather than one shared piece of state, because the two entry points differ in every prop and merging them would mean a nullable tab and a nullable source id threaded through one component:

```tsx
      <ImportDialog
        open={tailoring !== null}
        onOpenChange={(next) => {
          if (!next) setTailoring(null)
        }}
        tab="job"
        sourceResumeId={tailoring ?? undefined}
      />
```

- [ ] **Step 6: Verify statically**

```bash
bun run typecheck && bun run check
```
Expected: PASS. Do not start a dev server and do not open a browser.

- [ ] **Step 7: Hand the UI to the user**

Say exactly what to look at, then stop:

- The rail's New button opens the dialog on **Upload or paste**, unchanged, with a new tab strip above it. **From a job posting** is disabled with a tooltip when the user has no resumes.
- The Job tab has a LinkedIn link field with a Fetch button, a description textarea, a **Build it from** dropdown, the review line, and **Create resume**. Fetching fills the textarea.
- A resume's `...` menu in the rail has a new **Tailor for a job** item, which opens the same dialog on the Job tab with that resume already selected in the dropdown.
- After generating, the app navigates to `/r/<new id>/edit`. If the model call failed, a warning toast says it is a plain copy.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features
git commit -m "Add the job posting tab and the rail's tailor action"
```

---

### Task 12: Correct the target specs and `AGENTS.md`

The specs describe guarantees this release changes. Leaving them is worse than having no spec, because the next person reads them as current.

**Files:**
- Modify: `docs/specs/over-all-design.md:13`, `:79`
- Modify: `docs/specs/back-end.md:542`, `:588`, `:730`, `:835`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: The patches-only principle**

`over-all-design.md:13` says the AI never edits the resume directly and returns validated patches. That was already only true of editing, since import writes a whole document. Restate it as the rule it actually is:

> The AI never edits an existing resume directly: it returns patches that are validated on the server and accepted one at a time. Creating a resume is the exception, and it is a narrow one: import and tailoring both write a whole document, because there is nothing yet to patch. Everything that touches a resume after it exists goes through patches.

- [ ] **Step 2: The phase 2 line**

`over-all-design.md:79` lists "Job-description ingestion (store JDs per resume, reuse across requests)" as future work. Mark it done and correct the shape, since postings are stored standalone and linked many-to-many rather than per resume.

- [ ] **Step 3: Grounding**

`back-end.md:542` documents `groundingText` and rule 10. Both are gone as of Task 1. Delete the paragraph and renumber any list that counted eleven rules.

- [ ] **Step 4: Posting retention**

`back-end.md:588` says clearing `agent_runs.input` means job descriptions are not retained beyond the run. That is now only half true, and the half that changed is the one a reader cares about:

> `agent_runs.finish` clears `input`, so a finished run retains nothing about what was asked. A posting a user tailored against is retained deliberately, on its own `job_targets` row, and the run's `input` holds only that row's id while it runs.

- [ ] **Step 5: The skill id union**

`back-end.md:730` types `skill_id` as a closed union of the seven registry skills. Add the reserved value and say why it is outside the registry:

> `skill_id` is text, not an enum. It is one of the seven `SKILLS` ids for anything the assistant chooses, plus the reserved `tailor_from_job`, which is deliberately not a registry entry: it writes a whole document rather than patches, so it has no op or field whitelist to be checked against.

- [ ] **Step 6: The forbidden log fields**

`back-end.md:835` lists job descriptions among fields that must never be logged. That still holds and now covers two more call sites; add `job_targets.raw_text` and the posting URL to the list explicitly, since a job link identifies what a person is applying for.

- [ ] **Step 7: `AGENTS.md`**

The line claiming only `resume-schema` and `resume-render` carry vitest suites is wrong and has been for a while. Correct it to name all four: `resume-schema`, `resume-render`, `resume-core`, `agent`.

- [ ] **Step 8: Commit**

```bash
git add docs AGENTS.md
git commit -m "Bring the specs in line with tailoring and the dropped rule"
```

---

## Self-Review Notes

Recorded so an executor knows these were checked rather than missed.

**Spec coverage.** Every decision in the spec's table maps to a task: base copy and output shape to Task 8, job input and fetch confirmation to Tasks 2 and 9, job storage and link UI to Tasks 3 and 4, the two LLM calls to Tasks 5 and 6, pruning and additions to Tasks 6 and 7, the review line and selector default to Task 11, versions and failure handling to Task 8, naming to Task 8, the run row and its input to Task 8, the rate limit to Task 8, grounding to Task 1, and the spec divergences to Task 12. No length target appears anywhere, which is the decision.

**Ordering.** Task 8 needs `JobFetcher` from Task 9 to satisfy the `Ports` type. Do Task 9's step 1 early, or accept one red typecheck between the two. Everything else is strictly ordered.

**Known gaps, on the record.**

- `agent_runs.finish` clears `input`, so `jobTargetId` does not survive the run. The `resume_job_targets` row is the durable record, which is why it is written before the model call rather than after.
- Nothing reads `resume_job_targets` or `is_origin` in this release. That is deliberate: the fact is unrecoverable if not captured at creation, and a reader is cheap to add later.
- `WorkerJobFetcher` will often come back with a sign-in wall. `fetchPosting` treats short text as unreadable and the user pastes instead, which is the expected path more often than not.
- Rule 10 is gone, additions are allowed inside experience bullets, there is no suggestion review, and nothing marks which words the model wrote. The line in the Job tab is the only safeguard, and the user reads it before the content exists. Task 11 step 3 is where that copy lives; treat it as load-bearing.
