/**
 * react-pdf resolves colors through a CSS color parser that does not know
 * `oklch`, so the console's oklch palette is converted to sRGB hex once, here.
 * Keep these in step with `packages/ui/src/styles/globals.css`.
 */
export const ink = {
  black: "#0a0a0a",
  strong: "#171717",
  body: "#292929",
  muted: "#737373",
  faint: "#a1a1a1",
  rule: "#e5e5e5",
  wash: "#f5f5f5",
  canvas: "#fafafa",
  white: "#ffffff",
} as const

/** Accent per template, taken from the design's template picker. */
export const accents = {
  lisbon: "#0069a8",
  meridian: "#0084d1",
  plainsong: "#0a0a0a",
  harbor: "#00a6f4",
  ledger: "#00598a",
  atlas: "#74d4ff",
} as const

/** 72pt to the inch. Everything in the templates is expressed in points. */
export const pt = (inches: number) => Math.round(inches * 72)
