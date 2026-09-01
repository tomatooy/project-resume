import { Font } from "@react-pdf/renderer"

import interRegular from "../fonts/Inter-400Regular.ttf?url"
import interMedium from "../fonts/Inter-500Medium.ttf?url"
import interSemiBold from "../fonts/Inter-600SemiBold.ttf?url"
import interBold from "../fonts/Inter-700Bold.ttf?url"
import serifRegular from "../fonts/SourceSerif4-400Regular.ttf?url"
import serifItalic from "../fonts/SourceSerif4-400Regular_Italic.ttf?url"
import serifSemiBold from "../fonts/SourceSerif4-600SemiBold.ttf?url"
import serifBold from "../fonts/SourceSerif4-700Bold.ttf?url"

export const SANS = "Inter"
export const SERIF = "Source Serif 4"

let registered = false

/**
 * Registers the two vendored families. Called on module load below; exported so
 * Node tests can re-run it after a font store reset.
 *
 * react-pdf only accepts TTF and OTF, which is why these are static TTFs rather
 * than the woff2 that `@fontsource` ships.
 */
export function registerFonts(): void {
  if (registered) return
  registered = true

  Font.register({
    family: SANS,
    fonts: [
      { src: interRegular, fontWeight: 400 },
      { src: interMedium, fontWeight: 500 },
      { src: interSemiBold, fontWeight: 600 },
      { src: interBold, fontWeight: 700 },
    ],
  })

  Font.register({
    family: SERIF,
    fonts: [
      { src: serifRegular, fontWeight: 400 },
      { src: serifItalic, fontWeight: 400, fontStyle: "italic" },
      { src: serifSemiBold, fontWeight: 600 },
      { src: serifBold, fontWeight: 700 },
    ],
  })

  // Hyphenation off. A resume reads worse with words broken across lines, and
  // the default callback also mangles technology names like "Kubernetes".
  Font.registerHyphenationCallback((word) => [word])
}

registerFonts()

export const CJK = "Noto Sans SC"

/**
 * Inter and Source Serif 4 carry no CJK glyphs, so a resume written in Chinese,
 * Japanese or Korean renders as mojibake without a second family. Noto Sans SC
 * is ~10 MB, far too large to load for every document, so it is registered only
 * when the document actually needs it and referenced through a `fontFamily`
 * array, which react-pdf resolves per glyph.
 *
 * The default source is a CDN. Call `setCjkFontSource` with a vendored file (or
 * a self-hosted URL) to remove that network dependency.
 */
let cjkSource =
  "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.4.1/400Regular/NotoSansSC_400Regular.ttf"
let cjkRegistered = false

export function setCjkFontSource(src: string): void {
  if (src === cjkSource) return
  cjkSource = src
  cjkRegistered = false
}

export function ensureCjkFont(): void {
  if (cjkRegistered) return
  cjkRegistered = true
  Font.register({ family: CJK, src: cjkSource })
}

// CJK ideographs, kana, Hangul, and the full-width forms that come with them.
const CJK_PATTERN = /[ᄀ-ᇿ⺀-⻿　-〿぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿︰-﹏＀-￯]/

export function containsCjk(text: string): boolean {
  return CJK_PATTERN.test(text)
}

/** react-pdf accepts a family list at runtime; its types only declare a string. */
export type FontFamily = string
export function familyList(...families: string[]): FontFamily {
  return (families.length === 1
    ? families[0]
    : families) as unknown as FontFamily
}

export type ResolvedFonts = { sans: FontFamily; serif: FontFamily }

export function resolveFonts(needsCjk: boolean): ResolvedFonts {
  if (!needsCjk) return { sans: SANS, serif: SERIF }
  ensureCjkFont()
  return { sans: familyList(SANS, CJK), serif: familyList(SERIF, CJK) }
}
