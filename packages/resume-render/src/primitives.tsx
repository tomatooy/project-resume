import { Link, Text, View } from "@react-pdf/renderer"
import {
  formatRange,
  hasBullets,
  type Basics,
  type Bullet,
  type Item,
  type Resume,
  type Section,
} from "@workspace/resume-schema"

import { ink } from "./tokens"
import type { TemplateOptions } from "./types"

/** Multiplies every size by the user's font scale and rounds to a tenth. */
export function scaler(options: TemplateOptions) {
  return (size: number) => Math.round(size * options.fontScale * 10) / 10
}

/** Non-empty contact fields in the order the design shows them. */
export function contactParts(basics: Basics): string[] {
  return [basics.location, basics.email, basics.phone].filter(
    (part): part is string => Boolean(part?.trim())
  )
}

/** Trim `https://` and a trailing slash so links read as labels on paper. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

export type ItemLines = {
  /** The bold line: role, school, project or custom title. */
  primary: string
  /** The lighter line beside or under it. */
  secondary?: string
  /** Usually a location. */
  tertiary?: string
  dates: string
  href?: string
}

/** Flattens the five item kinds into one shape the templates can lay out. */
export function itemLines(item: Item, locale = "en-US"): ItemLines {
  switch (item.kind) {
    case "experience":
      return {
        primary: item.role,
        secondary: item.company,
        tertiary: item.location,
        dates: formatRange(item.start, item.end, locale),
      }
    case "education":
      return {
        primary: item.school,
        secondary:
          [item.degree, item.field].filter(Boolean).join(", ") || undefined,
        dates: formatRange(item.start, item.end, locale),
      }
    case "project":
      return {
        primary: item.name,
        secondary: item.url ? prettyUrl(item.url) : undefined,
        href: item.url,
        dates: formatRange(item.start, item.end, locale),
      }
    case "custom":
      return {
        primary: item.title,
        secondary: item.subtitle,
        dates: formatRange(item.start, item.end, locale),
      }
    case "skills":
      return {
        primary: item.label,
        secondary: item.skills.join(" · "),
        dates: "",
      }
  }
}

/** Sections that would render as a heading with nothing under it. */
export function visibleSections(resume: Resume): Section[] {
  return resume.sections.filter((section) => section.items.length > 0)
}

export function bulletsOf(item: Item): Bullet[] {
  if (!hasBullets(item)) return []
  return item.bullets.filter((bullet) => bullet.text.trim().length > 0)
}

type BulletsProps = {
  texts: Bullet[]
  size: number
  color?: string
  markerColor?: string
  gap?: number
  lineHeight?: number
  /** Bullet glyph. Templates use a middot, a dash, or a filled dot. */
  marker?: string
}

export function Bullets({
  texts,
  size,
  color = ink.body,
  markerColor = ink.faint,
  gap = 2.5,
  lineHeight = 1.42,
  marker = "·",
}: BulletsProps) {
  if (texts.length === 0) return null
  return (
    <View
      style={{ display: "flex", flexDirection: "column", gap, marginTop: 4 }}
    >
      {texts.map((bullet) => (
        <View
          key={bullet.id}
          style={{ display: "flex", flexDirection: "row", gap: size * 0.55 }}
        >
          <Text style={{ fontSize: size, color: markerColor, lineHeight }}>
            {marker}
          </Text>
          {/* flexShrink keeps long words inside the column instead of
              overlapping the next one, which is a known react-pdf failure. */}
          <Text
            style={{
              fontSize: size,
              color,
              lineHeight,
              flexShrink: 1,
              flex: 1,
            }}
          >
            {bullet.text}
          </Text>
        </View>
      ))}
    </View>
  )
}

type HeadingProps = {
  children: string
  size: number
  color: string
  letterSpacing?: number
  rule?: string | false
  marginTop?: number
}

/**
 * A section heading. `minPresenceAhead` reserves space below it so a heading is
 * never left stranded at the foot of a page.
 */
export function Heading({
  children,
  size,
  color,
  letterSpacing = 0.9,
  rule = false,
  marginTop = 12,
}: HeadingProps) {
  return (
    <View
      minPresenceAhead={40}
      style={{
        marginTop,
        paddingBottom: rule ? 3 : 0,
        borderBottomWidth: rule ? 0.75 : 0,
        borderBottomColor: rule || undefined,
        borderBottomStyle: "solid",
      }}
    >
      <Text
        style={{
          fontSize: size,
          fontWeight: 700,
          letterSpacing,
          color,
          textTransform: "uppercase",
        }}
      >
        {children}
      </Text>
    </View>
  )
}

type LinkRowProps = {
  basics: Basics
  size: number
  color: string
  linkColor: string
  separator?: string
}

/** Contact details and profile links on one wrapping line. */
export function ContactLine({
  basics,
  size,
  color,
  linkColor,
  separator = "  ·  ",
}: LinkRowProps) {
  const parts = contactParts(basics)
  if (parts.length === 0 && basics.links.length === 0) return null

  return (
    <View
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {parts.map((part, i) => (
        <Text key={part} style={{ fontSize: size, color }}>
          {i > 0 ? separator : ""}
          {part}
        </Text>
      ))}
      {basics.links.map((link, i) => (
        <Text key={link.id} style={{ fontSize: size, color }}>
          {parts.length > 0 || i > 0 ? separator : ""}
          <Link
            src={link.url}
            style={{ color: linkColor, textDecoration: "none" }}
          >
            {link.label || prettyUrl(link.url)}
          </Link>
        </Text>
      ))}
    </View>
  )
}
