# Extension panel states by page category

Date: 2026-10-17. Status: implemented.

## 1. Goal

The extension decides what to show from the category of the page in each tab:

1. **Job pages** (LinkedIn job view and job search results) open the resume
   tailoring panel automatically.
2. **Application pages** on a known applicant tracking system (ATS) open an
   autofill panel automatically. Autofill itself is a placeholder for now.
3. **Every other page** shows nothing. The toolbar icon opens a panel there
   that checks the account connection, says no job or application was
   detected, and links to VS:Résumé.

On job and application pages the panel can be minimized to the floating widget
and closed for the tab.

Non-goals: a global auto-open setting, pushing page content aside,
`use_dynamic_url`, progress on the widget, ATS forms embedded in iframes on
company sites, a keyboard shortcut, and real autofill.

## 2. Decisions

| Topic | Decision |
|---|---|
| Job pages | HTTPS `www.linkedin.com`: `/jobs/view/<id>` (slugs allowed) and `/jobs/search-results` (trailing slash optional) with a query, including the "select a job" state |
| Application pages | Any HTTPS page on a known ATS host, with the vendor recorded |
| ATS hosts | Workday `*.myworkdayjobs.com`, `*.myworkdaysite.com`; Greenhouse `boards.greenhouse.io`, `job-boards.greenhouse.io`, `boards.eu.greenhouse.io`, `job-boards.eu.greenhouse.io`; Lever `jobs.lever.co`, `jobs.eu.lever.co`; Ashby `jobs.ashbyhq.com`; SmartRecruiters `jobs.smartrecruiters.com`, `careers.smartrecruiters.com`; iCIMS `*.icims.com` except `www.icims.com` |
| Wildcard hosts | Need a subdomain; the bare domain is unsupported |
| Classification | Background only (`src/lib/pages.ts`); the panel reads it from its snapshot |
| Per-tab state | `chrome.storage.session`, key `tab:<tabId>`: a mode for job pages, a mode for application pages, the manual panel location, and a blocked flag |
| Modes | `panel`, `widget`, `closed`; both default to `panel` |
| Location | Origin plus pathname; query and hash are ignored |
| Widget position | Global in `chrome.storage.local`, unchanged |
| Toolbar | Closes a showing panel; otherwise opens one, injecting the host if needed |
| Restricted pages | Toolbar does nothing except set the tab's tooltip to "VS:Résumé can't run on this page" until the next document loads |
| Focus | Auto-open never moves focus; a panel loads only once its tab is visible |
| Session reset | Browser restart and extension update clear session storage, so defaults apply again |
| Disconnect | Signs out only; it no longer clears session storage |

## 3. Display

The background computes one view per tab from the stored state and the
current page:

- Job or application page: that category's mode. `closed` shows nothing.
- Unsupported page: the panel if the stored manual location equals the current
  location, otherwise nothing.

The content script host renders the view: the widget, the panel docked to the
right edge, or nothing.

## 4. Transitions

| Event | Job or application page | Unsupported page |
|---|---|---|
| Widget click | Category becomes `panel` | Not possible |
| Panel "Minimize to widget" | Category becomes `widget` | Control hidden |
| Panel "Close for this tab", widget close | Category becomes `closed` | Manual location cleared |
| Toolbar while the panel shows | Category becomes `closed` | Manual location cleared |
| Toolbar otherwise | Category becomes `panel`; host injected if missing | Manual location set; host injected |
| Toolbar, injection fails | Tooltip set, tab marked blocked | Same, manual location cleared |

Navigation:

- Without a manual location nothing changes. The new page shows its own
  category's mode, so moving between job pages keeps the panel, widget, or
  closed state the user chose for that tab.
- With a manual location, reaching a job or application page sets that
  category to `panel` and clears the manual location, so the open panel stays
  open.
- With a manual location on an unsupported page, a different location or a new
  document (reload included) clears it.
- A new document clears the blocked flag and restores the default tooltip.

## 5. Panel content

The panel checks, in order:

1. Loading: "Checking this page…".
2. Error. On job pages: "Could not check this job" / "Your saved resume may
   still be processing." Elsewhere: "Could not reach VS:Résumé" / "Check your
   connection and try again." The button reconnects the account for
   authentication errors and retries otherwise.
3. No account: "Connect your account" / "Connect your existing VS:Résumé
   account to get started." / **Connect account**.
4. Search page without a selected job: unchanged.
5. Job page: the existing tailoring flow.
6. Application page: eyebrow "Autofill", title "Autofill is coming soon", body
   "We recognized this {Vendor} application. Soon VS:Résumé will fill it in
   from your resume.", button **Open VS:Résumé**. "This" avoids choosing
   between "a" and "an" for vendor names.
7. Unsupported page: no eyebrow, title "No job or application detected", body
   listing LinkedIn and the supported ATS vendors, button **Open VS:Résumé**.

The eyebrow follows the category: "Resume tailoring" on job pages, "Autofill"
on application pages. The header shows **Minimize to widget** once the page is
known and supported, and **Close for this tab** always. Both go to the
background, which updates the tab state and tells the host.

## 6. Components

- **Manifest.** Permissions `activeTab`, `identity`, `scripting`, `storage`,
  `webNavigation`. Host permissions and content script matches: LinkedIn plus
  the twelve ATS patterns. `widget.html` is web accessible on those pages;
  `panel.html` on all URLs, because a manual panel can open on any page.
- **`src/lib/pages.ts`.** ATS table, `classifyPage`, page categories, and the
  match patterns the manifest must equal.
- **`src/background/tab-state.ts`.** Pure `view` and `transition` functions,
  plus validated session storage updated through a per-tab queue.
- **`src/background/widget.ts`.** Messages from the host, widget, and panel
  header; the toolbar; injection on install and update; tab replacement and
  removal.
- **`src/background/navigation.ts`.** `webNavigation` events become
  navigation transitions and host refreshes.
- **`src/background/messages.ts`.** `trustedPanel` is asynchronous: a panel
  subframe is trusted only in a tab whose current view is the panel.
- **`src/content/widget-host.ts`.** One host per document. It asks the
  background for the view, recreates its iframe when the view changes, answers
  toolbar pings, and removes itself once its extension context is gone.

## 7. Lifecycle and edge cases

- **Install and update.** The background injects the host into open,
  non-discarded LinkedIn and ATS tabs. A new host announces itself with a
  cancelable DOM event; a live host cancels it, an orphaned host removes itself.
  Orphans also clean up on visibility changes and failed sends.
- **Back/forward cache.** The host refreshes on restore. The panel refetches
  and reconnects its realtime port, which Chrome closes when a page is cached.
- **Background tabs.** An auto-opened panel is created only when the tab first
  becomes visible.
- **History.** The host replaces the iframe element instead of changing its
  `src`, so the page's Back button never navigates the extension frame.
- **Prerendering.** Prerendered documents are ignored until they become the
  tab's main frame.
- **Tabs.** A replaced tab's state moves to the new tab ID; a closed tab's
  state is deleted.
- **Panel refresh.** A panel refetches on URL changes of its own tab only, and
  on becoming visible, so many open panels do not refetch on every tab event.

## 8. Not doing

- A global setting to turn auto-open off.
- Pushing page content aside instead of overlaying it.
- `use_dynamic_url` for web accessible resources.
- Job progress on the widget.
- ATS forms embedded in iframes on company career sites.
- A keyboard shortcut.
