# Front-end Spec

Spec version 1.0, 2026-09-01. Read `over-all-design.md` first. Types referenced here are defined in `back-end.md` section 5 (document schema) and section 6 (patch contract); do not redefine them.

---

## 1. Stack

| Concern | Choice | Package | Notes |
| --- | --- | --- | --- |
| Framework | TanStack Start on Cloudflare Workers | `@tanstack/react-start`, `@tanstack/react-router`, `@cloudflare/vite-plugin`, `wrangler` | Vite 8, React 19 |
| Language | TypeScript 6 strict | | `noUncheckedIndexedAccess` on |
| Styling (app chrome) | Tailwind v4 + shadcn on Base UI | `@workspace/ui` (existing) | Never used inside templates |
| Icons | Phosphor | `@phosphor-icons/react` | existing |
| Live document state | TanStack Store | `@tanstack/react-store` | one store per open resume |
| Server state | TanStack Query | `@tanstack/react-query` | lists, versions, messages; never the live document |
| Forms | TanStack Form + Zod | `@tanstack/react-form` | schemas imported from `@workspace/resume-schema` |
| Drag and drop | dnd-kit | `@dnd-kit/core`, `@dnd-kit/sortable` | sections, items, bullets |
| PDF generation | react-pdf renderer | `@react-pdf/renderer` | in `packages/resume-render` only |
| PDF display | react-pdf viewer (pdf.js) | `react-pdf` | in `features/resume/preview` only |
| Chat | AI SDK UI | `@ai-sdk/react`, `ai` | `useChat` with `DefaultChatTransport` |
| Text diff | | `diff` | word-level diff for `replace_text` cards |
| Auth client | | `@supabase/ssr`, `@supabase/supabase-js` | browser client for the login form only |
| IDs | | `nanoid` | via `@workspace/resume-schema` helpers |

**Naming trap.** `@react-pdf/renderer` and `react-pdf` both export `Document` and `Page`. Rule: a file imports from at most one of them. The renderer is imported only inside `packages/resume-render`; the viewer only inside `apps/web/src/features/resume/preview/PdfViewer.tsx`.

Versions: pin exact versions in `package.json` (no `latest`). Replace the existing `"latest"` entries in `apps/web/package.json` at step 3 of the build order.

---

## 2. Routes

File routes under `apps/web/src/routes/`:

```text
__root.tsx                 html shell, providers (Query, theme), global error boundary
index.tsx                  /             landing; redirects to /dashboard when signed in
login.tsx                  /login        email + password and magic link (Supabase)
auth.callback.tsx          /auth/callback  server route: exchanges the PKCE code, sets cookies, redirects
logout.tsx                 /logout       server route POST: signs out, clears cookies
_app.tsx                   layout: requires a session (beforeLoad -> redirect to /login)
_app.dashboard.tsx         /dashboard    resume list
_app.r.$resumeId.tsx       /r/:resumeId  editor shell: loads resume, creates the store, mounts preview
_app.r.$resumeId.index.tsx    ./         redirects to ./edit
_app.r.$resumeId.edit.tsx     ./edit     section forms
_app.r.$resumeId.design.tsx   ./design   template picker, page size, font scale
_app.r.$resumeId.history.tsx  ./history  versions list, compare, restore
_app.r.$resumeId.chat.tsx     ./chat     chat panel (also openable as a drawer from ./edit)
api.chat.ts                POST /api/chat   server route (see back-end.md section 8)
```

`_app.r.$resumeId.tsx` is the shell. Its `loader` calls `resumes.get` and `conversations.getOrCreate`. It renders a two-pane layout: children on the left, `<PreviewPane/>` on the right. The preview persists across child navigation because it is rendered by the parent.

Route guards: `_app.tsx` `beforeLoad` calls the `getSession` server function; if null, `throw redirect({ to: '/login', search: { next } })`.

---

## 3. Application shell and state

### 3.1 Resume store

`apps/web/src/features/resume/store.ts`

```ts
import { Store } from '@tanstack/store'
import type { Resume, ResumePatch } from '@workspace/resume-schema'

type ResumeState = {
  resumeId: string
  doc: Resume                         // the live document
  savedDoc: Resume                    // last document acknowledged by the server
  updatedAt: string                   // server updatedAt of savedDoc (optimistic concurrency)
  templateId: string
  templateOptions: TemplateOptions    // pageSize, fontScale
  saveStatus: 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'
  selectedNodeId: string | null       // for scoping AI requests
  previewPatches: ResumePatch[]       // pending suggestions hovered/selected for preview
}
```

Mutations go through `apps/web/src/features/resume/actions.ts`, which are thin wrappers over `applyPatches` from `@workspace/resume-schema`. Manual edits are therefore also expressed as patches (`replace_text`, `update_fields`, `insert_after`, `delete`, `move`). This keeps one mutation path and makes undo trivial (keep a stack of inverse patches; `applyPatches` returns the inverse).

### 3.2 Autosave

- Debounce 800ms after the last mutation.
- Call `resumes.update({ id, data: doc, expectedUpdatedAt: updatedAt })`.
- On success: `savedDoc = doc`, `updatedAt = result.updatedAt`, `saveStatus = 'saved'`.
- On `CONFLICT` (409): `saveStatus = 'conflict'`, show a banner with "Reload" (discard local) and "Overwrite" (resend without `expectedUpdatedAt`). This only happens with two tabs open.
- On network error: `saveStatus = 'error'`, retry with backoff (1s, 2s, 4s, max 30s), keep editing.
- `beforeunload` warns when `saveStatus !== 'saved'`.

### 3.3 Server state

TanStack Query keys:

```text
['resumes']                      list
['resume', id]                   get (used only to seed the store)
['versions', resumeId]           list
['version', versionId]           content for compare
['messages', conversationId]     initial chat history
```

Server functions are called directly inside `queryFn` and `mutationFn`. Invalidate `['resumes']` after create, rename, duplicate, delete; `['versions', id]` after accept, save version, restore.

---

## 4. Editor (`/r/:resumeId/edit`)

### 4.1 Layout

Left pane, scrollable, width 480px minimum. Sections rendered in document order as collapsible cards. A "Add section" button at the bottom offers the five section types. Each card has a drag handle, a title input, and its items. Each item has a drag handle, its fields, its bullets (sortable list with add/remove), and a delete button.

Basics is a fixed card at the top (not a section, cannot be moved or deleted).

### 4.2 Forms

One form component per item kind in `features/resume/editor/forms/`:

```text
BasicsForm.tsx        name, headline, email, phone, location, links[], summary
ExperienceItemForm    company, role, location, start, end|present, bullets
EducationItemForm     school, degree, field, start, end, bullets
ProjectItemForm       name, url, start, end, bullets
SkillsGroupForm       label, skills (chip input)
CustomItemForm        title, subtitle, start, end, bullets
BulletList            sortable textareas, Enter adds a bullet, Backspace on empty removes
```

Fields validate with the per-node Zod schemas from `@workspace/resume-schema` (`BasicsSchema`, `ExperienceItemSchema`, and so on). Validation is on blur; errors render under the field; invalid values are still written to the store (so the preview reflects typing) but autosave is skipped while any field is invalid and the status shows "Fix errors to save".

Date fields: a month picker producing `YYYY-MM`; a "Present" checkbox on `end` writes `'present'`.

### 4.3 Node selection

Clicking an item card or focusing a bullet sets `selectedNodeId`. The selected node shows a highlight ring and a "Ask AI about this" button that opens the chat drawer with the node pre-scoped. Selection is cleared by Escape or clicking the pane background.

### 4.4 Reordering

dnd-kit sortable contexts at three levels: sections, items within a section, bullets within an item. Dropping dispatches a `move` patch. Cross-container moves are not supported in the MVP (items stay in their section).

---

## 5. Preview pane

### 5.1 Pipeline

```text
store.doc + templateId + templateOptions
  -> useDebouncedValue(300ms)
  -> const element = <ResumeDocument resume={doc} templateId={id} options={opts} />   (packages/resume-render)
  -> const [instance, update] = usePDF({ document: element })                          (@react-pdf/renderer)
  -> instance.blob (previous blob kept while instance.loading)
  -> <PdfViewer blob={blob} />                                                          (react-pdf, pdf.js)
```

`usePDF` returns `{ loading, error, blob, url }` and an `update(element)` function. Call `update` in an effect keyed on the debounced inputs. Keep the last successful blob in local state so the viewer never blanks. Show a thin progress bar at the top of the pane while `loading` is true. Show `error.message` in a non-blocking toast if rendering fails and keep the old blob.

The `previewPatches` from the store (see section 7.4) are applied to a copy of `doc` before rendering, so hovering a suggestion shows its effect.

### 5.2 Viewer

`features/resume/preview/PdfViewer.tsx` wraps `react-pdf`:

- `pdfjs.GlobalWorkerOptions.workerSrc` set from the package's bundled worker via a Vite `?url` import.
- Renders every page vertically with a page gap; width fits the pane; zoom controls at 50, 75, 100, 125, 150 percent; page count badge.
- `renderTextLayer` on (accessibility and copy), annotations off.

### 5.3 Download

The Download button creates an object URL from the current blob and triggers a download named `${slug(basics.name)}-resume.pdf`. No server call.

### 5.4 `check_fit` execution

The chat feature registers an `onToolCall` handler (section 7.3). For `check_fit` it:

1. Applies the proposed patches to a copy of `doc` with `applyPatches`.
2. Renders `pdf(<ResumeDocument .../>).toBlob()` off the main pane (not through `usePDF`, so the visible preview is untouched).
3. Loads the blob with `pdfjs.getDocument` and reads `numPages`.
4. Returns `{ pageCount, pageSize }`.

Time budget: under 2 seconds for a two-page resume. If rendering throws, return `state: 'output-error'` with a short message so the model can proceed without the number.

---

## 6. Templates (`packages/resume-render`)

### 6.1 Package API

```ts
export type TemplateOptions = {
  pageSize: 'A4' | 'LETTER'
  fontScale: 0.9 | 1 | 1.1
  accent?: string            // hex, templates may ignore
}

export type TemplateDefinition = {
  id: 'modern' | 'classic' | 'compact'
  name: string
  description: string
  thumbnail: string          // data URI, generated at build time from the fixture resume
  Document: React.FC<{ resume: Resume; options: TemplateOptions }>
}

export const templates: Record<TemplateDefinition['id'], TemplateDefinition>
export function ResumeDocument(props: { resume: Resume; templateId: TemplateDefinition['id']; options: TemplateOptions }): JSX.Element
export const defaultTemplateOptions: TemplateOptions
```

`ResumeDocument` looks up the template and renders its `Document`. Unknown `templateId` falls back to `modern` and logs a warning.

### 6.2 Constraints every template must follow

- Layout is Yoga flexbox only: no grid, no floats, no absolute positioning except for page numbers.
- Two-column layouts use `flexDirection: 'row'` with fixed column widths in points.
- Every item wrapper uses `wrap={false}` so a job or project never splits across pages. If a single item is taller than a page, react-pdf will still break it; this is accepted.
- Section headings use `minPresenceAhead={40}` so a heading is never orphaned at the bottom of a page.
- Text nodes never overflow their container: set `flexShrink: 1` on text containers and never fix a height on text. This avoids the documented overlap bug.
- All sizes in points; margins 36pt default (0.5in), configurable per template.
- Fonts registered once in `packages/resume-render/src/fonts.ts` (section 6.3).
- Hyphenation disabled globally: `Font.registerHyphenationCallback((word) => [word])`.
- Links rendered with `<Link src={url}>`.
- Empty sections (no items) and empty fields are skipped, never rendered as blank space.
- Date display: `formatRange(start, end, locale)` from `@workspace/resume-schema` (`Jan 2024 - Present`).

### 6.3 Fonts

react-pdf requires TTF or OTF. `@fontsource` packages ship woff2, which does not work. Font files are vendored under `packages/resume-render/fonts/` and imported with Vite `?url`:

```text
fonts/Inter-Variable.ttf       (SIL OFL)
fonts/SourceSerif4-Variable.ttf (SIL OFL)
```

`Font.register({ family: 'Inter', fonts: [{ src: interUrl, fontWeight: 400 }, { src: interUrl, fontWeight: 600 }, { src: interUrl, fontWeight: 700 }] })` on module load. Variable fonts are registered once per weight used. `modern` and `compact` use Inter; `classic` uses Source Serif 4 for headings and Inter for body.

### 6.4 The three templates

| ID | Layout | Distinguishing traits |
| --- | --- | --- |
| `modern` | single column | accent color on name and section rules; 10.5pt body |
| `classic` | single column | serif headings, centered header, hairline section rules; 11pt body |
| `compact` | two columns (68/32) | skills, education, links in the narrow right column; 9.5pt body; tuned for one page |

### 6.5 Template tests

`packages/resume-render/test/`:

- For each template and each fixture in `@workspace/resume-schema/fixtures` (`minimal`, `one-page`, `two-page`, `long-bullets`, `unicode`), render to a buffer with `renderToBuffer` (Node) and assert the page count matches the fixture's expectation table.
- Extract text with `pdf-parse` and assert every bullet's text appears exactly once (catches dropped or duplicated content).
- Snapshot the first page as PNG via `pdf-to-img` and compare with a 0.5 percent pixel tolerance; snapshots are committed.

Runs under Vitest in Node. The browser path is covered by the Playwright test in section 10.

---

## 7. Chat (`features/chat`)

### 7.1 Panel layout

Header: the scoped-node chip when `selectedNodeId` is set (with a clear button), or the hinted playbook's name and when-to-use line. A clear control sits with the maximize and close buttons: it confirms first, then deletes the conversation's transcript and the memory summary behind it, and is disabled while a turn is running, since a stream cannot be cleared mid-flight. Body: message list. Footer: playbook chips (each writes its starter into the box and becomes the turn's hint), the structural toggle, then the textarea, Send button and Stop button while streaming. The structural toggle is off by default and travels with every send; it is the only way a turn may propose adding or removing a whole entry (see `back-end.md` section 8.5). There is no job-description box and no page-target box: a posting is pasted into the message, and the page count is measured only when the turn asks about length.

### 7.2 Transport

```ts
const chat = useChat({
  id: conversationId,
  messages: initialMessages,                 // from ['messages', conversationId]
  transport: new DefaultChatTransport({
    api: '/api/chat',
    body: { conversationId, resumeId },      // static for the life of the panel
  }),
  sendAutomaticallyWhen: checkFitAnswered,   // section 7.3
  onToolCall: handleClientTool,              // section 7.3
})

// Per-request values are passed at send time, never at hook level, to avoid stale values.
chat.sendMessage(
  { text },
  { body: { hintSkillId, selectedNodeId: store.state.selectedNodeId, structural } },
)
```

The client-tool continuation triggered by `sendAutomaticallyWhen` reuses the transport-level body only. The server therefore reads `hintSkillId`, `structural` and the other per-request fields from the running `agent_runs` row on continuation, not from the request (see `back-end.md` section 8.2 step 5). `checkFitAnswered` is a local predicate rather than the SDK's `lastAssistantMessageIsCompleteWithToolCalls`, which fires on any tool result and would resubmit the turn that `propose_patches` just ended.

The full UI message list is sent on every request (default transport behavior). The server treats only the last message as new and rebuilds history from Postgres; see `back-end.md` section 8.3.

### 7.3 Client-side tools

```ts
async function handleClientTool({ toolCall }) {
  if (toolCall.toolName !== 'check_fit') return
  try {
    const output = await checkFit(toolCall.input)      // section 5.4
    chat.addToolOutput({ tool: 'check_fit', toolCallId: toolCall.toolCallId, output })
  } catch (err) {
    chat.addToolOutput({ tool: 'check_fit', toolCallId: toolCall.toolCallId, state: 'output-error', errorText: 'Could not render preview' })
  }
}
```

Do not `await` inside `onToolCall` before calling `addToolOutput`; call it from the promise continuation as shown to avoid the documented deadlock.

### 7.4 Rendering messages

Each assistant message's parts are rendered in order:

- `text` parts: markdown (headings and code disabled), streamed.
- `tool-plan` parts: the turn's opening line, rendered as "Plan." followed by its summary, with the playbooks the turn actually loaded (`tool-load_skill` results, `loaded` plus `alreadyLoaded`) as small chips beside it. A chip asks for that one playbook alone.
- `tool-check_fit` parts: a small inline chip "Checked fit: 2 pages".
- `tool-propose_patches` parts with `state: 'output-available'`: the turn's `summary` as a bubble, then a **suggestion group** rendered from `output.suggestions` (each already validated and persisted by the server, with a `suggestionId`), then `gaps`, then `followUpQuestion`. Rejected-by-validation items in `output.rejected` render as a collapsed "N suggestions were discarded" line with reasons on expand; when a rejection is `STRUCTURAL_NOT_REQUESTED` the panel also offers a button that turns the structural toggle on and re-sends the same turn.

Suggestion card:

```text
[ attribution: playbook name ] [ node breadcrumb: Experience > Acme > bullet 2 ]
before / after   (word diff for replace_text; field table for update_fields; full node for insert/delete; from-to for move)
reason
[ Accept ] [ Reject ]        group footer: [ Accept all ] [ Reject all ]
```

The attribution is the patch's optional `skillId` resolved through the catalog in `@workspace/agent/skills`; a patch the model left untagged has no playbook named on it. A **structural** card, decided by `structuralReason(resume, patch)`, uses the destructive token and leads with a verb that names its target ("Remove Experience > Acme", "Move bullet 2 to Other role") instead of the breadcrumb line, and is excluded from "Accept all".

Hovering a card sets `store.previewPatches = [patch]` so the preview shows the effect; leaving clears it. Cards for suggestions whose status is no longer `pending` render read-only with a status badge.

### 7.5 Decide

Accept and Reject buttons call `suggestions.decide({ runId, decisions: [{ suggestionId, status }] })`. On success the server returns the new head and version; the client replaces `store.doc` and `savedDoc` with the returned head, updates `updatedAt`, invalidates `['versions', resumeId]`, and marks the cards. Decisions are batched per click (single, or all).

If the server returns `stale` for a suggestion (the target node changed since the run), the card shows "Outdated" and cannot be accepted.

### 7.6 Errors

- 401: redirect to login.
- 429: toast "You have reached the hourly AI limit" with the reset time from the response.
- Stream error: message bubble with "Something went wrong" and a Retry button that resends the last user message.
- Abort (Stop button): the partial assistant message is kept and marked "stopped".

---

## 8. Dashboard, design, history

### 8.1 Dashboard

Grid of resume cards: title, template thumbnail, updated time. Actions: Open, Rename (inline), Duplicate, Delete (confirm dialog; soft delete). "New resume" creates one from the `starter` fixture and navigates to `/r/:id/edit`.

### 8.2 Design

Template picker: three cards with thumbnails; selecting calls `resumes.setTemplate`. Page size and font scale controls write `templateOptions`. All three affect the preview immediately and persist through `resumes.setTemplate`.

### 8.3 History

List of versions (`version_no`, label, `created_by`, time). Selecting a version renders it read-only in the preview pane (replaces the live doc in the preview only, not in the store). Compare mode shows a node-level diff between the selected version and the head using `diffDocuments` from `@workspace/resume-schema`. Restore calls `versions.restore` and reloads the store.

---

## 9. Auth UI

`/login`: email and password form and a "Send magic link" option, using `createBrowserClient` from `@supabase/ssr` with the public URL and publishable key from `import.meta.env.PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. After `signInWithPassword` succeeds the client navigates to `next` or `/dashboard`. Magic link and OAuth land on `/auth/callback`, which is a server route (`back-end.md` section 4.3).

---

## 10. Testing

| Layer | Tool | What |
| --- | --- | --- |
| Store and actions | Vitest | patches produce the expected doc; inverse patches restore it |
| Forms | Vitest + Testing Library | validation messages; date field writes `YYYY-MM`; bullets add/remove |
| Templates | Vitest (Node) | section 6.5 |
| Chat rendering | Vitest + Testing Library | given a fixed UI message with a `tool-propose_patches` part, cards render with correct diff |
| End to end | Playwright against `wrangler dev` with a local Supabase | 1) sign in, create resume, edit a bullet, preview updates, download produces a PDF with the bullet text; 2) open chat, pick `bullet_rewrite` with a mocked model endpoint, accept a card, History shows a new version |

The mocked model endpoint for e2e is an environment flag `AI_MOCK=1` that makes the server use `MockLanguageModelV2` from `ai/test` with canned tool calls.

---

## 11. Environment (client-visible)

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
PUBLIC_APP_NAME
```

Nothing else is exposed to the browser.

---

## 12. Performance budgets

- Keystroke to store update: under 16ms.
- Store update to new preview blob (two-page resume): under 600ms including the 300ms debounce.
- Initial editor route load (SSR, warm): under 1.5s on a mid-range laptop.
- Chat: first streamed token under 2s p50 (dominated by the model).

If the preview render blocks typing, move `usePDF` rendering into a Web Worker (phase 2) rather than lengthening the debounce.
