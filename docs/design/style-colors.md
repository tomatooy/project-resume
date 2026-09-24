# UI color conventions

The palette lives in `packages/ui/src/styles/globals.css`. Each theme defines
nine base roles. Shared shadcn variables alias those roles or derive a color
from them. Components use semantic Tailwind utilities.

The base palette follows Cursor Light and Cursor Dark, sourced from the
installed app's `theme-cursor` theme files. Keep the brighter GitHub-style
`success` greens for saved states and additions. Warning and destructive
colors retain the original Resume Studio palette in both themes.

| Role | Usage |
| --- | --- |
| `background` | App canvas, sidebar, PDF preview canvas |
| `card` | Editor, cards, inputs, top and bottom bars, skill pages |
| `foreground` | Primary text |
| `muted-foreground` | Secondary text |
| `primary` | Main actions, focus, active indicators |
| `border` | Dividers and input outlines |
| `success` | Saved state and additions |
| `warning` | Flags and pending attention |
| `destructive` | Errors, removals, destructive actions |

## Tints and emphasis

- Use `bg-primary/10`, `bg-success/10`, or `bg-destructive/10` for tinted
  backgrounds. Use `border-primary/30` or `ring-primary/20` for emphasis.
- Prefer 5%, 10%, and 15% for new background tints; 20%, 30%, and 40% for new
  border and focus treatments. Existing values may stay when the visual
  distinction is intentional.
- Keep `text-foreground` and `text-muted-foreground` for normal text. Use
  `text-success`, `text-warning`, and `text-destructive` for status text.
- `text-primary-text` is the shared readable accent text color. It derives
  from `primary` and `foreground` for each theme. Do not recreate
  `primary-deep` or `primary-strong` variants.
- An opacity modifier changes transparency, not lightness. Its visible color
  depends on the surface beneath it. Keep opaque `bg-background`, `bg-card`,
  `bg-popover`, and `bg-muted` on structural surfaces that must hide content.
- `muted` derives from foreground and card. `secondary` aliases muted.
  `accent` is an opaque neutral tint for shared menu and selection components.
  `input` and `ring` use the theme's neutral input and focus outlines.

## Reuse rules

- Name colors by meaning, not by component. A new panel does not need a new
  background variable when it uses an existing surface.
- Add a new base role only for a distinct semantic purpose that needs its own
  light and dark values. Use an alias or opacity modifier for existing roles.
- Keep literal UI color values in the palette. Shadow colors use utilities
  such as `shadow-foreground/25`. The app header and status bar use the shared
  `surface-metal` white metallic treatment, derived from card and foreground.
  Dark mode keeps those surfaces flat. Inactive tab strips use `bg-background`,
  matching the sidebar.
- Rebind derived aliases at both `:root` and `.dark` so nested theme scopes
  use the correct palette.
- Provider brand artwork and PDF template colors are separate systems. Do not
  replace Google brand colors or resume rendering palettes with UI colors.

## Typography

Use the system UI font for both body text and headings, matching Cursor's
workbench: `-apple-system` / `BlinkMacSystemFont` on macOS, with Segoe UI,
system UI and Chinese font fallbacks. Both `font-sans` and `font-heading`
resolve to this stack. The base size is 13px with a 1.4 line height;
components retain their explicit size hierarchy. PDF template fonts remain
independent.

## Verification

Run Biome and typecheck, and search for removed token names after migrations.
Visually review the editor, navigation, preview, suggestion diffs, and menus
manually in light and dark themes. Do not use browser automation or run a build
for a styling change.

Tailwind v4 references: [theme variables](https://tailwindcss.com/docs/theme)
and [color opacity](https://tailwindcss.com/docs/colors).
