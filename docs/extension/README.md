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

If the OAuth window stays open on the main app and the extension still shows **Connect account**, check the Supabase redirect allowlist. Replace `<extension-id>` with the actual ID from `chrome://extensions`; it must match the ID in `EXTENSION_ORIGINS`. For local Supabase, update `additional_redirect_urls` in `supabase/config.toml`, then run `bun run --filter @workspace/supabase stop` and `bun run --filter @workspace/supabase dev` to apply it. Close the old OAuth window and start a new connection from the panel.

Successful authentication returns to `https://<extension-id>.chromiumapp.org/auth/callback`, closes the OAuth window, and persists a separate extension session in `chrome.storage.local`. Main-app cookies do not connect the extension. **No job or application detected** only means the tab is not a supported job or application page; the account email in the panel footer indicates a connected account.

## Tailoring fails before generation

If a saved attempt has `error_class=dispatch_failed`, check the Worker encryption configuration before retrying. `TAILOR_ENCRYPTION_KEY_V1` must be base64 encoding of exactly 32 random bytes, not a 32-character passphrase or 33 decoded bytes. Generate it with `openssl rand -base64 32` and store it only in `apps/web/.dev.vars` locally or the production Worker secret. Keep an existing valid key while attempts are in flight.

After changing `.dev.vars`, restart the local web dev process so the Worker uses the new value. Retry the failed attempt from the extension using its saved description. Configuration validation now runs before admission or retry, logs `tailoring.configuration` with a fixed error class, and does not create another attempt or consume quota. `shared_api` / `jobs.lookup` info lines only measure status reads; they do not describe a generation failure.

## Behavior and boundaries

Pages fall into three kinds. The design and its edge cases are in `docs/superpowers/specs/2026-10-17-extension-panel-states-design.md`.

- **Job pages** use HTTPS on `www.linkedin.com`: `/jobs/search-results` (trailing slash optional) with a query, or `/jobs/view/<numeric-id>` including slugged view paths. IDs have at least six digits. A view/query disagreement is rejected. A search page without a selected ID asks the user to select a job.
- **Application pages** are HTTPS pages, on the default port, of a known applicant tracking system: Workday (`*.myworkdayjobs.com`, `*.myworkdaysite.com`), Greenhouse (`boards.greenhouse.io`, `job-boards.greenhouse.io`, and their `eu.` forms), Lever (`jobs.lever.co`, `jobs.eu.lever.co`), Ashby (`jobs.ashbyhq.com`), SmartRecruiters (`jobs.smartrecruiters.com`, `careers.smartrecruiters.com`), and iCIMS (`*.icims.com` except `www.icims.com`). Wildcard hosts need a subdomain. The list lives in `apps/extension/src/lib/pages.ts`; the manifest's host permissions and the widget host's matches must equal it, and the autofill script's matches must equal its Greenhouse and Ashby hosts (`AUTOFILL_MATCHES`). Tests check both.
- **Unsupported pages** are everything else, including other LinkedIn pages and application forms embedded in a company's own site.

Job and application pages open the isolated in-page panel, docked to the right, without taking focus. Its header can minimize it to a compact widget pinned to the right edge, or close it for the tab. Hover or keyboard focus on the widget reveals the drag handle and close button. Drag vertically, or use the handle’s arrow keys, to move it; the extension remembers its relative position across tabs and clamps it to the viewport. Clicking the widget reopens the panel. Each tab keeps one mode for job pages and one for application pages, so after closing the panel on one job, later jobs in that tab stay closed while new tabs open it again. The modes last until the tab closes, the browser restarts, or the extension reloads or updates. Disconnecting the account does not reset them.

On unsupported pages nothing appears until the toolbar icon is clicked. The panel then stays on that page, including query and hash changes, and goes away once the page changes or reloads. On any page the toolbar icon closes a showing panel and otherwise opens one. Where Chrome does not let extensions run, such as `chrome://` pages and the Chrome Web Store, the click shows nothing and the icon's tooltip reads "VS:Résumé can't run on this page" until the tab loads another page.

Every panel first checks the account and offers **Connect account** when none is connected. Job pages then show resume tailoring. Greenhouse and Ashby application pages show Autofill (see Autofill below); other application pages show a placeholder naming the detected system. Unsupported pages say **No job or application detected** and offer **Open VS:Résumé**. The panel owns its header and has no browser pin/unpin controls. Its surface is light, its header text is gray, and the floating widget uses the shared grayscale palette.

A tab opened in the background loads its panel when first shown. Installing or updating the extension adds the host to open job and application tabs and the autofill script to open Greenhouse and Ashby tabs; a host left behind by the previous version removes itself, so open tabs need no refresh. Pages restored from the back/forward cache refresh the host and the panel.

On **Tailor resume**, the extension fetches the selected posting through authenticated `POST /api/v1/jobs/linkedin/{externalJobId}/posting`. This calls the same `TailorService.fetchPosting` and `WorkerJobFetcher` as the web app, including canonical LinkedIn URLs, the ten-second request timeout, HTML-to-text conversion, and text limits. The widget host content script only hosts the isolated widget or panel frame; it never reads job descriptions or account data. `activeTab` and `scripting` only let the toolbar add that host to the current page. Before submitting, it rechecks the active tab, selected job, returned posting URL, and account. Existing bindings skip fetching; retries reuse the saved description. Rebuild and reload the extension after updating the backend to use this endpoint.

The panel reads persisted status on opening and focus. While open on a supported job, the service worker subscribes to RLS-scoped Supabase Realtime changes for that job's binding and current operation, then tells the panel to fetch a fresh snapshot. A disconnected subscription falls back to a ten-second check. The panel keeps its current content visible during refresh. Transport errors remain distinct from generation failure. API calls and account storage are restricted to the service worker; only an exact extension panel sender can invoke privileged messages. An embedded panel is trusted only while its tab shows the panel for the current page, and its snapshots, subscriptions, and URL-change refreshes stay bound to that tab. Supabase storage is restricted to trusted extension contexts. Last-base preferences and ambiguous-request keys are account-scoped.

The database owns `(user, platform, job)` uniqueness. Admission clones the source and snapshots it before parsing. Initial admission, retries, and all other agent runs share atomic hourly quota accounting. Each retry snapshots the current saved copy, preserves its ID, and reuses the stored job text. Generated output is staged under owner RLS. Success writes the head and immutable version only after checking the current attempt, deadline, deletion, and revision under a lock. Cancellation fences commits before best-effort workflow termination.

Ordinary assistant changes still require accepted patches. Explicit extension **Tailor resume** and **Retry** authorize this specific whole-document creation/recovery operation. They do not grant the chat assistant general write authority.

Workflows receive only an AES-GCM encrypted, operation-bound envelope containing a short-lived user access token. There is no background refresh token or service-role client. Attempts last five minutes and require a further minute of token validity. Model calls have a maximum 120-second deadline-aware signal and one SDK retry; workflow step retries are bounded and recheck the overall deadline. Checkpoint results contain only operation IDs. Staged content is purged on terminal transition. Fresh authenticated reads reconcile expired work if the workflow can no longer authenticate. An ambiguous dispatch retains the admission and reuses its workflow instance ID.

Legacy target identity is backfilled lazily under the caller's RLS credentials using the shared URL parser. Captures and associations are preserved. Lookup pins the newest live origin association, with stable ID tie-breaking, and only infers readiness from a completed tailoring run with a persisted version. A soft-deleted binding does not fall back to an older resume. Legacy synchronous runs are never dispatched as new workflow instances. Their existing request still performs the model work; its final write now shares the atomic cancellation and revision guards so adoption cannot let a late writer bypass cancellation.

## Autofill

The design is in `docs/superpowers/specs/2026-10-17-autofill-design.md`, with research notes for Greenhouse (`2026-10-18-autofill-greenhouse-research.md`) and Ashby (`2026-10-17-autofill-ashby-research.md`) in the same folder.

- **Where it runs.** Greenhouse new boards (`form#application-form`) and Ashby have adapters written from the research notes. Neither adapter has fixture tests yet, so both are unverified until a live run. Classic Greenhouse boards (`form#application_form`) use the generic extractor and are unverified. Lever, Workday, SmartRecruiters and iCIMS keep the placeholder. Forms embedded in company career sites are out of scope. The adapters' host list in `apps/extension/src/autofill/vendors/index.ts` copies the Greenhouse and Ashby hosts of `pages.ts`, because the content script cannot load Zod; no test compares the two, so keep them equal by hand.
- **The content script.** The autofill content script (`autofill.js`) runs in the top frame only and is added to open Greenhouse and Ashby tabs on install and update. It reports the form's structure and whether each field has a value, never the values. It receives only values to write, drafts and the resume file; it holds no token and makes no network requests. Its events are synthetic, so the user's typing (trusted events), **Clear**, or a value it did not write makes a field user-owned. User-owned fields are never written again, except by the user's own **Insert** in Write with AI.
- **What it never touches.** It never clicks Submit or Next and never sends `Enter`. It never touches "Locate me", Dropbox, Google Drive, "Enter manually", the phone flag picker, or Ashby's "Autofill from resume".
- **Session.** The session lives in `chrome.storage.session` under `autofill:<tabId>`, tied to the posting key. A reload puts back what autofill wrote, including the resume file, into fields that are empty again and that the user does not own, with no new AI pass. The session moves when Chrome replaces the tab and is removed when the tab closes.
- **Server and quota.** API calls happen in the service worker. Autofill has its own hourly quota of 60, separate from chat: each `infer`, `answer`, `notes.merge` or `generate` call that reaches a model costs one unit, and `plan`, `start` and `notes.undo` are free.
- **Panel and privacy.** The panel renders the resume PDF it attaches; the CSP adds `'wasm-unsafe-eval'` for the renderer's WebAssembly. There are no new permissions, and no field data is logged.

## Verification and manual acceptance

Automated coverage includes pure identity/contract tests, core lifecycle tests, envelope tamper/expiry tests, checkpoint replay tests, HTTP/direct-router tests, auth-boundary tests, shared posting fetch and selection-change tests, navigation mocks, panel interactions, transactional pgTAP tests, and real Supabase adapter concurrency checks. Workflow unit tests use injected checkpoints, not a deployed Cloudflare instance. Model-provider capacity and latency have not been benchmarked; the five-minute bound is enforced, not a throughput promise. Autofill adds rule, matching and Notes tests in `packages/autofill`; autofill service tests with in-memory doubles in `packages/resume-core`; pgTAP for run kinds, the snapshot guard and the autofill tables; and web tests for the Autofill profile page and Notes editor. The extension's autofill code (content script, adapters, writers, ownership, session, controller, overlay and panel view) and the `autofill.*` contracts and router have no automated tests yet, so the manual checks below are their only verification.

Run `bun run typecheck`, `bun run check`, `bun run test`, `bun run db:test`, and `bun run db:check` with the local fixture credentials described by the adapter script. SQL tests roll back their fixtures. Adapter checks create named test fixtures and soft-delete their test resumes, following the existing script's convention.

After configuring and building, verify:

- Connect the same Google account and compare base resumes with the main app. Test direct web page loading and client navigation for the migrated shared list.
- Open view/search forms of one job with different tracking parameters. Confirm the panel opens by itself without taking focus. Minimize it, then check right-edge placement, hover controls, vertical dragging, viewport resizing, and reopening from the widget. Close it, open another job in the same tab, and confirm it stays closed; a new tab opens it again. The toolbar icon toggles it.
- Open an application on Lever, Workday, SmartRecruiters and iCIMS. Confirm the autofill placeholder opens by itself and names the system, and that minimizing and closing work as on job pages without affecting job pages in the same tab.
- Open a live `job-boards.greenhouse.io/{board}/jobs/{id}` posting. The panel shows "Autofill · Greenhouse" and "{Company} · {Title}". **Autofill** fills first and last name, email, the phone country and number, the location, the links and the sponsorship question; each menu opens and closes briefly while its options are read. The two attestations appear under "Fill these on the page". "Locate me", Dropbox, Google Drive and Enter manually are untouched, and nothing is submitted. If the phone box rejects "(415) 555-0100" (its flag stays a globe), the fallback is "+1 415 555 0100".
- On a live `jobs.ashbyhq.com/{org}/{jobId}` Overview tab, the panel shows "Autofill · Ashby", "No application form detected" and **Open the application form**, which opens the Application tab. There, **Autofill** fills Name, Email and the link question; the Resume field shows `{name}-resume.pdf`; Ashby's "Autofill from resume" box stays empty; "What interests you about the role?" gets a **Write with AI** button. Nothing is submitted.
- Type into a filled field and click **Autofill** again; the typed value stays.
- Reload after a fill; the written values come back with no new AI pass.
- Answer questions with **Save and fill again**; **Review** then shows the diff and **Undo** restores Notes. After editing Notes in the app, **Undo** says "Notes changed since this update. Use History in Autofill profile."
- On an unsupported page, such as a news site or the LinkedIn feed, confirm nothing appears until the toolbar icon is clicked. The panel then shows **No job or application detected** and **Open VS:Résumé**, and goes away on the next click or on navigating elsewhere. Disconnected, every panel first asks to connect.
- Click the toolbar icon on `chrome://extensions` and on the Chrome Web Store. Confirm the tooltip says VS:Résumé can't run on this page and returns to normal after navigating elsewhere.
- Open a job in a background tab and confirm the panel loads when the tab is shown. Reload the extension and confirm open job tabs show exactly one working panel without a refresh. Leave a job page and come back with Back; confirm the panel still updates.
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

### Autofill release checklist

- Update the privacy policy and the Chrome Web Store data disclosures: the extension reads application form fields and sends application data to VS:Résumé and its AI providers (DeepSeek, TypeSafe). Both live outside this repository.
- Set the `TYPESAFE_API_KEY` Worker secret in production; without it `infer` degrades to rules and plain questions.
- Apply migrations `20261018120000`, `20261018120100` and `20261018120200` to production before deploying the Worker.
- Rebuild and reload the extension after the backend deploy.
