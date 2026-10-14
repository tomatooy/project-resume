# Server/Data-Layer Recon for the Browser Extension

Key fact: the extension does NOT call `apps/web/src/lib/api.ts` or `apps/web/src/server/fns/*` (those are the web app's TanStack server functions). It calls a typed oRPC client against `POST/GET /api/v1`.

- `apps/extension/src/lib/api.ts:1-22` builds `createApiClient({ baseUrl: appOrigin + "/api/v1" })`; auth header is `Bearer <supabase access_token>`.
- `apps/web/src/routes/api.v1.$.ts:1-11` -> `handleApi` (`server/api/handler.ts`), which builds context with `verifyBearer` (`server/api/context.ts:16-26`) or cookie, then `createServices(supabasePorts(db,userId))`.
- Contract: `packages/api/src/contract/index.ts`; handlers: `apps/web/src/server/api/router.ts`.

## 1. Endpoints the extension actually calls (function -> server handler -> table)

- `api.resumes.page/summary/list` (`background.ts:383,435`, `background/messages.ts:43,54,240`) -> `services.resumes.*` -> `resumes` (needs user auth; summary is metadata only).
- `api.jobs.lookup/fetchPosting/tailor/retry` (`background/messages.ts:41,119,155,169,211`) -> `services.tailor`/`operations` -> `job_targets`, `job_resume_bindings`, `tailor_operations`, `resume_job_targets`.
- `api.operations.cancel` (`background/messages.ts:148`) -> `services.operations.cancel` -> `tailor_operations`.
- `api.autofill.prepare` (`autofill/background.ts:521,781`) -> `services.autofill.prepare` -> `resumes`/`resume_versions` (returns SourceStamp).
- `api.autofill.plan` (`background.ts:653`) -> `services.autofill.plan` -> read-only, LLM-backed.
- `api.autofill.draft` (`background.ts:1444`) -> `services.autofill.draft` -> read-only.
- `api.autofill.document` (`autofill/pdf-background.ts:31`) -> `services.autofill.document` -> `resumes`/`resume_versions` (stamped document, `Cache-Control: private, no-store`, `api.test.ts:375`).
- `api.autofillProfile.get/update` (`background.ts:1355,1360`) -> `services.autofillProfile.*` -> `autofill_profiles`.
- `api.autofillAnswers.save` (`background.ts:1365`) -> `services.autofillAnswers.save` -> `autofill_scoped_answers`. (`list`/`remove` exist in contract but no extension call site was found.)
- `api.autofill.policy` exists in contract; no extension call site found.

## 2. Profile (server level)

- Schema: `packages/resume-core/src/autofill-profile/schema.ts` (`AutofillProfileSchema`, `ProfileDataSchema`, 7 sections; `ProfileUpdateSchema` carries `expectedRevision`). Service: `.../service.ts` (revision CAS, `profile_conflict`).
- Table `autofill_profiles` (`supabase/migrations/20260926120000_autofill.sql:1-28`): PK `user_id`, jsonb `data`, `revision` trigger, RLS `autofill_profile_owner` `user_id = auth.uid()`.
- Read/write fns: `services.autofillProfile.get/update` -> `SupabaseAutofillProfileRepository` (`apps/web/src/server/adapters/autofill.ts:107-155`). No web `server/fns` (extension-only path).

## 3. Saved/reusable answers

- Schema `ScopedAnswerSchema` / `SaveScopedAnswerSchema` / `DeleteScopedAnswerSchema` (`packages/resume-core/src/autofill/contract.ts:146-171`); service `ScopedAnswerService` (`autofill/answers.ts:143-220`), which enforces meaning + explicit conditions + rejects record concepts.
- Table `autofill_scoped_answers` (`20261013120000_autofill_scoped_answers.sql`): `id uuid PK`, `user_id`, `revision bigint`, jsonb `data`, `confirmed_at`, `updated_at`. RLS `autofill_scoped_answer_owner` (`user_id = auth.uid()`), grant select/insert/update/delete.
- Ownership: every query filters `user_id = this.userId` (`adapters/autofill.ts:48-104`).
- CAS: DB trigger bumps `revision` on write; repository `save` inserts at `expectedRevision===0` else `.eq("revision", expectedRevision)` and returns null (409 CONFLICT) when no row matched or on 23505; `remove` matches `id + user_id + revision` (same file). Contract-level `expectedRevision` on save/delete.

## 4. Confirmed / per-application temporary answers

NOT server-persisted. `ApplicationAnswerSchema` (`contract.ts:132-144`) is accepted inline in `DraftAnswerInputSchema.applicationAnswers` (`contract.ts:472-484`); `SourceSnapshot.scopedAnswers` (`contract.ts:180-186`) is an in-memory snapshot. Extension-local only: `AutofillSession.applicationAnswers` built by `rememberAnswer` (`apps/extension/src/autofill/confirmed-answers.ts:17-57`), held in the in-process `sessions` map and mirrored to `chrome.storage.session` per tab (`autofill/background.ts:89-104`). SourceRef kind `application_answer` exists (`contract.ts` SourceRef union) but there is no `application_answers` table (grep of all migrations: none).

## 5. PDF rendering

No server PDF endpoint and no server-side renderer (`@workspace/resume-render` is imported only under `apps/web/src/features/...` client code). Server's only role is `autofill.document`, returning a stamped `AutofillDocument` = `{ resume, templateId, templateOptions, sourceStamp }` (`AutofillDocumentSchema`, `contract.ts:488-493`). Rendering happens extension-side in an offscreen document (`autofill/render-pdf.tsx` -> `pdf(<ResumeDocument/>).toBlob()`, then base64+sha256 in `pdf-contract.ts`). Cache key inputs: the `SourceStamp` (`contract.ts:32-48`) = `resumeId`, `resumeSource` (head `revision`+`contentHash` or `versionId`+`contentHash`), `profileRevision`, `overridesRevision`. Server sets `private, no-store`.

## 6. Migrations

`supabase/migrations/*.sql`, ordered `YYYYMMDDHHMMSS_snake_name.sql`; additive (`create table`, `create or replace function`, subsequent ALTERs; see `20260924121000+`). Convention: `enable row level security` + one owner policy `for all to authenticated using (user_id = auth.uid()) with check (...)` + explicit `revoke`/`grant`; a BEFORE INSERT/UPDATE trigger owns `revision` (CAS token) and `updated_at`, refusing identity/owner changes (`20260926120000_autofill.sql:18-28`, `20261013120000_autofill_scoped_answers.sql:17-33`, `20260902120000_init.sql:41-57`). Security-definer functions like `autofill_reserve_quota` gate bounded ops.

## Does NOT exist today

- No `application_answers` / per-application answer table or endpoint; those answers never leave the extension.
- No server-side PDF rendering, PDF cache table, or PDF route.
- No extension call site for `autofill.policy` or `autofillAnswers.list/remove`.
- No server function in `apps/web/src/server/fns/*` for Profile or scoped answers (extension path is `/api/v1` only).
