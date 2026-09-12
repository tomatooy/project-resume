# Merge Editor / Versions / Export / Interview into VS Code style tabs

## Context

An open resume has four ways of being looked at, but the switches for them sit in two
different places. Editor / Export / Interview live in `ModeSwitcher`, a dropdown in the
center of the status bar. Versions lives in `?view=versions`, a toggle on the right of the
same bar. This is exactly P6 in `docs/design/ui-redesign-brief.md`, "view switching is
split across two places".

The three screens are also structurally unlike each other. Editor is a middle column plus a
resizable side column. Export builds its own second split and renders its *own*
`PreviewPane`. Interview is a single centered column with no preview at all. Four views of
one document, and the user re-learns the layout on every switch.

The change: put a VS Code style tab strip at the top of the middle column. All four views
share one shell (rail, middle column, side column). Switching tabs swaps only the middle
column. The resume tree in the rail and the Preview / Assistant panes on the right do not
move.

This round is **structure only**. The visual work in section 8 of the brief (the surface
hierarchy of main line A, type and radius consolidation, Export's primary/secondary
hierarchy, Interview's empty state) is out of scope.

## Decisions already settled

| Decision | Outcome |
| --- | --- |
| Tab semantics | Four fixed tabs, not closable, not reorderable |
| Tab order | Editor / Versions / Export / Interview |
| Tab strip position | Inside the middle panel, at its top, `h-11`, level with the side column's `PaneTitle` row |
| Tab appearance | Active tab `bg-paper`, joined to the content below; the strip itself `bg-canvas` |
| Icons | None, text labels only |
| URL | Four route segments; Versions gets a new `/r/:id/versions` |
| Inactive tabs | Unmounted, not kept alive |
| Side column | Present on all four tabs |
| Middle column width | One shared split (`resume-studio.column-split`); dragging on any tab drags that one |
| Narrow screen | The tab strip is always present; when the middle column collapses it renders full width on its own |
| Maximize | The tab strip hides with everything else, true fullscreen |
| Keyboard shortcuts | None, left for a later Cmd+K round |

## Changes

### 1. New: tab definitions and the tab strip

**`apps/web/src/features/shell/resume-tabs.ts`** (new)

One source of truth, read by all four call sites:

```ts
export const RESUME_TABS = [
  { to: "/r/$resumeId/edit", label: "Editor" },
  { to: "/r/$resumeId/versions", label: "Versions" },
  { to: "/r/$resumeId/export", label: "Export" },
  { to: "/r/$resumeId/interview", label: "Interview" },
] as const
```

Plus `useResumeTab(resumeId?)`, resolving the active entry with `useMatchRoute` and falling
back to Editor when nothing matches or no resume is open. The resolution logic is the one
already in `ModeSwitcher.tsx:26-28`.

**`apps/web/src/features/shell/ResumeTabs.tsx`** (new)

An `h-11` row, `bg-canvas`, four `Link`s. The active tab is `bg-paper` and draws no bottom
border, so it joins the white middle column below it. Inactive tabs are
`text-muted-foreground`, going to `text-foreground` on hover. Type carries over from
`ModeSwitcher`: `font-heading text-[12px] font-semibold`. The active tab is marked with
`aria-current="page"`.

### 2. Lift the shell: `apps/web/src/routes/_app.r.$resumeId.tsx`

This is the core of the change. `ResumeShell` currently supplies providers and emits an
`<Outlet/>`. It takes ownership of the tab strip and the whole middle/side split instead,
leaving the four routes responsible for middle column content only.

```
ResumeShell
├─ ResumeSessionProvider / PreviewProvider / ResumeWorkspaceProvider (unchanged)
├─ RailSlotContent → ResumeTree (unchanged)
├─ StatusBarExtra → PreflightIndicator   ← lifted from the edit route
└─ div ref={layout.ref}
   ├─ maximized: one pane fills the row, no tab strip
   ├─ centerOpen && rightOpen: ResizablePanelGroup
   │  ├─ Panel id="editor" minSize={300} bg-paper
   │  │  ├─ <ResumeTabs/>
   │  │  └─ <Outlet/>            ← middle column content of the four screens
   │  └─ Panel id="side" → preview / assistant (existing `side` logic, moved)
   ├─ centerOpen alone: same without the split
   └─ centerOpen false (narrow): a full width <ResumeTabs/> first, then `side`
```

The `preview()` / `assistant` factories and the vertical `side` group move across verbatim
from `_app.r.$resumeId.edit.tsx:71-103`.

### 3. Rename and lift the layout hook

**`apps/web/src/features/resume/editor/use-editor-layout.ts`**
→ **`apps/web/src/features/resume/use-workspace-layout.ts`**

It serves four tabs now, so it is no longer the editor's own. Changes:

- The `{ versionsOpen }` argument becomes `{ tab }` (from `useResumeTab`).
- `centerOpen` becomes `tab !== "editor" || !(collapsed && rightOpen)`.
  **This deliberately preserves today's behavior**: only Editor yields its middle column to
  the side panels below 980px. Versions is already exempt via `versionsOpen ||`, and Export
  and Interview never had the logic at all. Keying it to the tab keeps all four screens
  behaving exactly as they do now, and keeps Export's download buttons from vanishing on a
  narrow window.
- The `pane` / `setPane` pass-through can go; `EditorPane` reads `useResumeWorkspace()`
  itself.
- Everything else is untouched: the `columnSplit` localStorage read/write and the
  `columnsRef.current.setLayout` push, the `maximized` `useState` and its cleanup effect,
  and `useElementWidth`.

### 4. Versions becomes a route

**New `apps/web/src/routes/_app.r.$resumeId.versions.tsx`**: seven lines,
`component: VersionsPanel`, matching the shape of the export and interview route files.

**`_app.r.$resumeId.edit.tsx`**: keep `validateSearch` (it is what recognizes old links) and
add a `beforeLoad` that throws `redirect({ to: "/r/$resumeId/versions" })` when
`search.view === "versions"`. The route body shrinks to `ConflictBanner` + `EditorPane` plus
the Cmd+Z / Esc `useEffect`.

**`_app.r.$resumeId.history.tsx`**: retarget the redirect at `/r/$resumeId/versions` and drop
its `search`.

### 5. Export gives up its own split and preview

**`apps/web/src/features/export/ExportScreen.tsx`**: delete the outer
`ResizablePanelGroup` / `ResizableHandle`, the right-hand `<PreviewPane/>`, and
`useExportSplit()`. Keep only the `max-w-[880px]` scrolling column that currently lives
inside the `id="export"` panel.

Add an on-mount effect. Since inactive tabs unmount, mounting is the same event as entering
the tab:

```tsx
// An Export screen with no preview is pointless: confirming the finished PDF is
// the whole reason this screen exists.
useEffect(() => {
  if (!panels.preview) togglePanel("preview")
}, [])
```

**Delete `apps/web/src/features/export/use-export-split.ts`**; the
`resume-studio.export-split` key retires with it.

> Visible consequence: Export's middle column background goes from `bg-canvas` to the
> column's uniform `bg-paper`, so the format cards become white cards on white. They already
> carry 1px borders, and `VersionsPanel` already looks exactly like this today (`bg-paper`
> cards inside the `bg-paper` middle column), so this is consistent rather than a regression.

### 6. Status bar

**`apps/web/src/features/shell/StatusBar.tsx`**:

- Drop `<ModeSwitcher>` from the center cell and leave it empty. (Brief 8.1 wants save status
  there; that is a later round.)
- Change the right cell's condition from `editing` (a `matchRoute` against the edit route) to
  `Boolean(resumeId)`, so Preview / Assistant are available on all four tabs. **This is
  required**: the side column is permanent now, so the toggles that control it have to be
  permanent too, or the user cannot close the preview from Export.
- Keep the Versions `BarButton` as a shortcut, but point it at
  `navigate({ to: "/r/$resumeId/versions" })` and read `pressed` from
  `useResumeTab() === "versions"`. It is now a second entry point to the same view; both
  highlights derive from the same `useResumeTab` value, so they cannot drift apart.

**Delete `apps/web/src/features/shell/ModeSwitcher.tsx`**.

### 7. Navigation preserves the current tab

**`apps/web/src/features/shell/ResumeRail.tsx:160`**: change the row's
`to="/r/$resumeId/edit"` to the tab returned by `useResumeTab()`. Switching resumes from
Export keeps you in Export.

**`apps/web/src/features/resume/ResumeTree.tsx`**:
- The versions check at `:80-83` (a `matchRoute` against edit with
  `search: { view: "versions" }`) becomes a match against `/r/$resumeId/versions`.
- The section-click `navigate` at `:119-122` drops `search: {}`; the target stays `/edit`.
  **Deliberately unchanged**: clicking a section means "I want to edit this", so landing in
  Editor is correct.

### 8. PreflightIndicator becomes global

Move it from `_app.r.$resumeId.edit.tsx:38-42` up to `ResumeShell`, so the status bar carries
it on all four tabs. Export's detailed `<Preflight/>` card in the middle column stays; the two
already share `PreflightList`.

## One adjacent bug (please confirm whether to fix it here)

`use-editor-layout.ts:81-86` builds `side` with `defaultLayout: sideSplit` but **no
`groupRef`** and no matching `setLayout` effect, while `sideSplit` is `undefined` on first
render (localStorage is read in an effect). The result is that
`resume-studio.right-split` is written but never restored. The `columns` object in the same
file does it correctly at `:48-54`, with a comment explaining why the push is needed.

This code is moving houses in this change anyway, and the fix is roughly four lines: a
`useResizableGroupRef()` and one effect. It is outside "structure only", so it is called out
separately rather than folded in.

## Not doing

- Brief 8.7, the internal rework of Export and Interview
- Brief 8.6, the two-column Versions rework; `VersionsPanel` moves across as is
- Any visual token consolidation (type scale, radii, surfaces)
- Keyboard shortcuts
- `docs/specs/front-end.md`, which has other stale sections and deserves its own pass

## Documentation

Only these sections of `docs/design/ui-redesign-brief.md`:

- **3, Information architecture**: add `/r/:resumeId/versions` to the route table and mark
  `edit?view=versions` as a redirect.
- **5.1, Global shell**: the mode capsule paragraph is already stale (the code moved to a
  status bar dropdown some time ago). Rewrite it as "four tabs at the top of the middle
  column plus the panel toggles in the status bar".
- **6, P6**: mark it resolved, and note that the resolution is the tab strip rather than the
  rail's Views group.
- **8.1 / 8.3**: delete the left-rail `Views` group item and rewrite it as the tab strip
  approach. In the 8.3 ASCII diagram, drop the Views block from the rail and add the tab
  strip at the top of the middle column.

## Tests

`apps/web` already has a Vitest + Testing Library suite (`apps/web/vitest.config.ts`, jsdom).
Follow the existing pattern and stub router hooks with
`vi.mock("@tanstack/react-router", ...)`; the precedent is
`apps/web/src/features/resume/ResumeTree.test.tsx:16-20`.

New `apps/web/src/features/shell/ResumeTabs.test.tsx`:

1. All four tabs render in the order Editor / Versions / Export / Interview.
2. The tab matching the current route carries `aria-current="page"` and the others do not.
3. Each tab's `href` carries the current `resumeId`.

Update `apps/web/src/features/export/PreflightIndicator.test.tsx` if it depends on the edit
route being the mount point.

## Verification

Per `AGENTS.md`, no browser automation. Static checks only:

```
bun run typecheck
bun run check
bun run test
```

After those pass, here is what to look at yourself:

1. `/r/<id>/edit` shows four tabs at the top of the middle column. The active Editor tab is
   white and joined to the form below it, the strip's right edge lines up with the middle
   column's drag handle, and its height matches the Preview title row on the right.
2. Click Export: the middle column swaps to the export content and **the preview and
   assistant on the right do not move**. If the preview was switched off, entering Export
   turns it back on.
3. Click Versions: the middle column swaps to the version list, and the Versions button on
   the right of the status bar lights up at the same time.
4. On the Export tab, click a different resume in the rail: you should stay on Export rather
   than being thrown back to Editor.
5. On the Export tab, click a section in the rail: you should jump to Editor with that pane
   open.
6. Drag the handle between the middle and side columns, then switch tabs: the width holds and
   the handle does not jump.
7. Narrow the window below 980px: Editor's middle column yields to the side panels but the
   tab strip stays (rendered full width). Export / Versions / Interview are unaffected by the
   narrow width.
8. Maximize the preview: the tab strip and middle column both disappear, and restoring brings
   back the previous arrangement.
9. Old links `/r/<id>/edit?view=versions` and `/r/<id>/history` both land on
   `/r/<id>/versions`.
10. The center cell of the status bar is now empty and the mode dropdown is gone.
