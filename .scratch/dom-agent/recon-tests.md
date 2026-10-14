# Recon: test + build infra for autofill extension rewrite

## 1. Autofill test files

**apps/extension/test/** (23 files, jsdom unless noted; run via `vitest run`)

- `autofill-dom.test.ts` (678 loc) - Executor + Scanner + Registry + PDF upload: 30 cases (attach/readback, shadow roots, combobox/listbox, ARIA controls, stale guards, audit). The dense core.
- `autofill-session.test.ts` (1284 loc) - background session orchestration, panel registration, cancellation generations, auto-upload/fill, worker restarts (28 cases).
- `autofill-page-reader.test.ts` (287) - `PageReader`/`Scanner` graph, shadow/portal labels, byte budget, password redaction.
- `autofill-panel.test.tsx` (439), `panel.test.tsx` (359) - Panel/App UI + queries.
- `autofill-batches.test.ts`, `autofill-button-choice.test.ts`, `autofill-confirmed-answers.test.ts`, `autofill-profile-answer.test.ts`, `autofill-application.test.ts`, `autofill-api-account.test.ts`, `autofill-pdf-background.test.ts`, `autofill-pdf-render.test.ts`, `autofill-sites.test.ts`, `messages.test.ts`, `boundaries.test.ts` (@vitest-environment node, import-privilege audit), plus widget/nav/auth/updates.

**packages/resume-core/src/autofill/** (contract, planner, rules, answers, page-contract, page-projection, facts, upload) covered by `test/autofill.test.ts` (23 cases, profile+planner) and `test/autofill-data.test.ts` (23 cases, interpretation/answers). Testing doubles: `src/testing/autofill.ts` (InMemoryAutofillProfileRepository/Quota/Policy, StubAutofillDecider).

**packages/agent** - `test/autofill.test.ts` (option picker), `autofill-drafter.test.ts`, `page-interpreter.test.ts` (model page interpretation + cache).

**apps/web** - `src/server/adapters/autofill.test.ts`, `features/autofill-profile/{AutofillProfileScreen,editor,SavedAnswers}.test.tsx`.

## 2. Recorded DOM/AX fixtures

Essentially none. Only one HTML capture: `apps/extension/test/fixtures/ashby-application.html` (1.9KB, reduced Ashby yes/no form). No HAR, `.webarchive`, `.snap`, JSON page captures, or per-ATS recordings anywhere. All other DOM is inline `document.body.innerHTML = ...` strings inside tests (e.g. `autofill-page-reader.test.ts:18`). No accessibility-tree dumps.

## 3. Extension build

Bundler: **Vite 8** + `@vitejs/plugin-react` + `@tailwindcss/vite`. Single config `apps/extension/vite.config.ts`. Entry points (`rollupOptions.input`): `panel.html`, `offscreen.html`, `widget.html`, `src/content/widget-host.ts`, `src/background/index.ts`. A custom `extension-manifest` plugin emits `autofill-content.js` via a **nested `vite build`** IIFE (`src/autofill/content.ts`) and injects env origins/public key into `manifest.json`; it asserts content scripts are self-contained (no imports/dynamic imports). No separate content-script vite config.
`apps/extension/package.json` scripts: `dev` (`vite build --watch`), `build`, `typecheck` (`tsc --noEmit`), `lint`/`format` (biome), `test` (`vitest run`). Root has `build:extension`.

## 4. Extension test harness

`apps/extension/vitest.config.ts`: `environment: "jsdom"`, `include: ["test/**/*.test.{ts,tsx}"]`, `@workspace/ui` alias, and a `local-test-fonts` plugin stubbing `.ttf?url`. `@testing-library/react` + `@testing-library/jest-dom` (web only) available.
**No shared chrome mock/stub file exists.** Chrome is hand-stubbed inline per test with `vi.stubGlobal("chrome", {...})` in 14 files (`autofill-session`, `auth`, `apply-link`, `navigation`, `messages`, `updates`, `widget*`, `panel`, `autofill-panel`, `autofill-pdf-background`, `autofill-dom`, `widget-background`). No `chrome.*` mock module, no MSW, no fetch mock helper except `vi.fn` modules.

## 5. Commands / suites

Root `package.json`: `build|dev|lint|format|typecheck|test` = `turbo <task>`; `check` = `biome check .`; `db:test`, `db:check`, `build:extension`. `turbo.json`: `test` dependsOn `^test`, `outputs: []`; `typecheck`/`lint`/`format` dependOn `^`; build outputs `.output/**`,`dist/**`.
Vitest suites: `resume-schema`(5), `resume-render`(2), `resume-core`(21), `agent`(14), `api`(1), `typesafe`(2), `web`(42), `extension`(23). `packages/ui` and `supabase` have no vitest.

## 6. Performance/benchmark harness

**None.** No `performance.now`, `perf_hooks`, `bench`, tinybench, mitata, or `console.time` in source or tests (one incidental `assistant-runtime.ts`). No size/perf budgets beyond the byte-budget assertions embedded in `autofill-batches` / `page-reader` tests.

## What does NOT exist

Recorded ATS page/AX fixtures beyond one Ashby snippet; a shared chrome API mock; a benchmark/measurement harness; a separate autofill build config; a DOM-fixture loader.
