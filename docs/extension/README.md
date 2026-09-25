# VS:Résumé browser extension

The independent Chrome app is `apps/extension`. It uses the existing web Worker at `/api/v1`; it does not need an open app tab. Shared browser-safe oRPC contracts and the client live in `packages/api`.

## Configure and load

1. Copy `apps/extension/.env.example` to `apps/extension/.env.local`. Set `VITE_APP_ORIGIN`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. The origin must identify the backend deployment, not a separate extension API. HTTP is supported only for localhost development.
2. Run `bun install --frozen-lockfile`, then `bun run --filter @workspace/extension build` yourself. For unpacked development, `bun run --filter @workspace/extension dev` runs a build watcher; it does not start the web app.
3. In Chrome 127 or newer, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `apps/extension/dist`.
4. Record the extension ID shown by Chrome. For a stable development/release identity, set `VITE_EXTENSION_PUBLIC_KEY` to the extension's public key and rebuild. Never put a private signing key in this variable.
5. Add the exact callback `https://<extension-id>.chromiumapp.org/auth/callback` to the Supabase Auth redirect allowlist. The extension uses a separate Google PKCE session; it does not copy the app's session or refresh token. Add each development and production ID explicitly.
6. Configure the existing web Worker with `EXTENSION_ORIGINS=chrome-extension://<extension-id>` (comma-separated for multiple exact IDs). For local development this belongs in `apps/web/.dev.vars`; production may use Worker vars. Its public Supabase configuration must identify the same project as the extension.
7. Configure `TAILOR_ENCRYPTION_KEY_V1` as a Worker secret and in `.dev.vars` locally. Use a random 32-byte key encoded as base64. Keep it for the lifetime of in-flight attempts. Neither this secret nor a model key belongs in the extension.
8. Apply the `20260924*` database migrations through the normal environment migration process, including the Realtime publication for job bindings and tailoring operations. The `TAILOR_WORKFLOW` binding in `apps/web/wrangler.jsonc` names `resume-tailoring`, class `TailorWorkflow`, exported from `src/server.ts`. Deploy the compatible backend before distributing the extension.

Actual production origins and extension IDs are not known to the repository and have not been invented. Cloudflare account entitlement, deployed workflow exports, Google callback behavior, and model latency require the manual environment checks below. No build, deployment, or browser verification was performed by the implementing agent.

## OAuth returns to the main app

If the OAuth window stays open on the main app and the extension still shows **Connect account**, check the Supabase redirect allowlist. Replace `<extension-id>` with the actual ID from `chrome://extensions`; it must match the ID in `EXTENSION_ORIGINS`. For local Supabase, update `additional_redirect_urls` in `supabase/config.toml`, then run `bun run --filter @workspace/supabase stop` and `bun run --filter @workspace/supabase dev` to apply it. Close the old OAuth window and start a new connection from a LinkedIn job page.

Successful authentication returns to `https://<extension-id>.chromiumapp.org/auth/callback`, closes the OAuth window, and persists a separate extension session in `chrome.storage.local`. Main-app cookies do not connect the extension. **Find your next role** only means the active tab is unsupported; the account email in the panel footer indicates a connected account.

## Behavior and boundaries

Supported pages use HTTPS on `www.linkedin.com`: `/jobs/search-results/` with a query, or `/jobs/view/<numeric-id>` including slugged view paths. IDs have at least six digits. A view/query disagreement is rejected. A search page without a selected ID asks the user to select a job.

A compact widget stays pinned to the right edge of supported LinkedIn pages. Hover or keyboard focus reveals the drag handle and close button. Drag vertically, or use the handle’s arrow keys, to move it; the extension remembers its relative position and clamps it to the viewport. Dismissal lasts for the current tab’s browser session. Click the widget or the extension toolbar icon to open the isolated in-page panel docked to the right. Its top-right control returns to the floating widget at the saved position. Navigation never opens the panel automatically. The panel owns its header and has no browser pin/unpin controls. Its surface is light, its header text is gray, and the floating widget uses the shared grayscale palette. After rebuilding and reloading the extension, refresh existing LinkedIn tabs to mount the widget.

On **Tailor resume**, the extension fetches the selected posting through authenticated `POST /api/v1/jobs/linkedin/{externalJobId}/posting`. This calls the same `TailorService.fetchPosting` and `WorkerJobFetcher` as the web app, including canonical LinkedIn URLs, the ten-second request timeout, HTML-to-text conversion, and text limits. The content script only hosts the isolated widget frame; it never reads job descriptions or account data. The extension does not require the `scripting` permission. Before submitting, it rechecks the active tab, selected job, returned posting URL, and account. Existing bindings skip fetching; retries reuse the saved description. Rebuild and reload the extension after updating the backend to use this endpoint.

The panel reads persisted status on opening and focus. While open on a supported job, the service worker subscribes to RLS-scoped Supabase Realtime changes for that job's binding and current operation, then tells the panel to fetch a fresh snapshot. A disconnected subscription falls back to a ten-second check. The panel keeps its current content visible during refresh. Transport errors remain distinct from generation failure. API calls and account storage are restricted to the service worker; only an exact extension panel sender can invoke privileged messages. Embedded panels must belong to a LinkedIn tab, and their snapshots and subscriptions stay bound to that tab. Supabase storage is restricted to trusted extension contexts. Last-base preferences and ambiguous-request keys are account-scoped.

The database owns `(user, platform, job)` uniqueness. Admission clones the source and snapshots it before parsing. Initial admission, retries, and all other agent runs share atomic hourly quota accounting. Each retry snapshots the current saved copy, preserves its ID, and reuses the stored job text. Generated output is staged under owner RLS. Success writes the head and immutable version only after checking the current attempt, deadline, deletion, and revision under a lock. Cancellation fences commits before best-effort workflow termination.

Ordinary assistant changes still require accepted patches. Explicit extension **Tailor resume** and **Retry** authorize this specific whole-document creation/recovery operation. They do not grant the chat assistant general write authority.

Workflows receive only an AES-GCM encrypted, operation-bound envelope containing a short-lived user access token. There is no background refresh token or service-role client. Attempts last five minutes and require a further minute of token validity. Model calls have a maximum 120-second deadline-aware signal and one SDK retry; workflow step retries are bounded and recheck the overall deadline. Checkpoint results contain only operation IDs. Staged content is purged on terminal transition. Fresh authenticated reads reconcile expired work if the workflow can no longer authenticate. An ambiguous dispatch retains the admission and reuses its workflow instance ID.

Legacy target identity is backfilled lazily under the caller's RLS credentials using the shared URL parser. Captures and associations are preserved. Lookup pins the newest live origin association, with stable ID tie-breaking, and only infers readiness from a completed tailoring run with a persisted version. A soft-deleted binding does not fall back to an older resume. Legacy synchronous runs are never dispatched as new workflow instances. Their existing request still performs the model work; its final write now shares the atomic cancellation and revision guards so adoption cannot let a late writer bypass cancellation.

## Verification and manual acceptance

Automated coverage includes pure identity/contract tests, core lifecycle tests, envelope tamper/expiry tests, checkpoint replay tests, HTTP/direct-router tests, auth-boundary tests, shared posting fetch and selection-change tests, navigation mocks, panel interactions, transactional pgTAP tests, and real Supabase adapter concurrency checks. Workflow unit tests use injected checkpoints, not a deployed Cloudflare instance. Model-provider capacity and latency have not been benchmarked; the five-minute bound is enforced, not a throughput promise.

Run `bun run typecheck`, `bun run check`, `bun run test`, `bun run db:test`, and `bun run db:check` with the local fixture credentials described by the adapter script. SQL tests roll back their fixtures. Adapter checks create named test fixtures and soft-delete their test resumes, following the existing script's convention.

After configuring and building, verify:

- Connect the same Google account and compare base resumes with the main app. Test direct web page loading and client navigation for the migrated shared list.
- Open view/search forms of one job with different tracking parameters. Check right-edge placement, hover controls, vertical dragging, viewport resizing, tab-scoped dismissal, and widget/toolbar panel opening. Confirm navigation does not open the panel automatically.
- Create from a base, close the panel and all app tabs, and return after generation. Confirm **Resume is ready, now apply** and the correct **Edit resume** URL. Also restart Chrome during processing.
- Submit concurrently from two tabs. Confirm one copy. Force parser/writer failure, retry, and cancel; the editable copy must remain, and retries must retain its ID.
- Edit during generation and confirm conflict preserves those edits. Delete a copy and confirm the picker returns and explicit creation makes a replacement.
- Check unreadable posting responses, selection changes during fetching, offline lookup, expired authentication, a lost submission response, and unsupported URLs. No case may falsely claim readiness or associate another job's description.
- Confirm no notification, badge, download, application click, or automatic editor tab occurs.

The full twelve-item acceptance checklist remains in `docs/superpowers/plans/2026-09-24-linkedin-extension.md`.

### Regression note

The existing `packages/agent/test/models.test.ts` expectation enables smart-tier thinking, while `packages/agent/src/models.ts` currently disables it. The agent suite reports this pre-existing mismatch; the extension change does not change model selection or that setting. The import suite also had an obsolete hardcoded text ceiling; its fixture now derives the existing `MAX_IMPORT_CHARS` limit.

The full web suite also contains two stale word-diff color assertions (`bg-primary/14` versus the current `bg-success/10`), unrelated to this feature. A PDF-worker test timed out during the concurrent full run and passed when rerun alone. The PDF-renderer suite passed with network access for its existing remote font fixtures.

Final feature verification: TypeScript passes across all nine typed workspaces; Biome passes with the repository's existing schema-version informational notice. The core suite passes 160 tests, extension 13, shared API contracts 2, new web API/workflow tests 12, PDF renderer 47, and SQL suite 120. Real adapter checks pass, including concurrent admission/retry, deletion replacement, legacy adoption, and cancellation of an adopted in-flight web writer. Full-suite failures are the pre-existing model-setting and word-diff assertions described above.
