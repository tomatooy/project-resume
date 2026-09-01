---
category: Actions
---

# Button

The primary action control. Wraps Base UI's `Button` primitive and applies the
design system's variant and size classes, so it keeps native `<button>`
semantics and keyboard behaviour while styling comes from the DS tokens.

## Choosing a variant

| Variant | Use for |
|---|---|
| `default` | The single most important action in a view (filled, brand colour). |
| `outline` | Secondary actions that still need a visible boundary, e.g. toolbar controls. |
| `secondary` | Lower-emphasis actions sitting next to a `default` button. |
| `ghost` | Dense or repeated actions where chrome would be noisy, e.g. table row actions, icon buttons. |
| `destructive` | Deleting or otherwise irreversible actions. Tinted, not filled, so it does not outrank the primary action. |
| `link` | Navigation rendered inline in text. |

Use exactly one `default` button per view or dialog. Pair it with `outline` or
`ghost` for the cancel/secondary action.

## Sizing

`xs`, `sm`, `default`, and `lg` set height and horizontal padding. The matching
`icon-xs`, `icon-sm`, `icon`, and `icon-lg` sizes render a square button for a
single icon child. Icon-only buttons must carry an `aria-label`.

Icons are sized automatically: any `svg` child without its own `size-*` class is
set to a size matching the button, so icons do not need explicit dimensions.

## Examples

```jsx
// Primary action
<Button>Save changes</Button>

// Primary + secondary pairing
<div className="flex items-center gap-2">
  <Button>Publish</Button>
  <Button variant="outline">Save draft</Button>
</div>

// Destructive
<Button variant="destructive">Delete project</Button>

// Icon-only, label required
<Button variant="ghost" size="icon" aria-label="More options">
  <DotsThreeIcon />
</Button>

// Button with a leading icon
<Button>
  <PlusIcon />
  New item
</Button>

// Rendered as a link
<Button variant="link" render={<a href="/docs" />}>Read the docs</Button>
```

## Accessibility

- Icon-only buttons require `aria-label`.
- Prefer `disabled` for genuinely unavailable actions. When the button must stay
  reachable by screen readers, add `focusableWhenDisabled`.
- For a button that opens a menu or dialog, set `aria-haspopup` and
  `aria-expanded`; the DS styles the expanded state for `outline`, `secondary`,
  and `ghost`.
- `aria-invalid` switches the focus ring to the destructive colour.

## Related

`buttonVariants` is exported alongside `Button` for composing the same classes
onto another element.
