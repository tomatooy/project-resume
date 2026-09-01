import { Document, Link, Page, Text, View } from "@react-pdf/renderer"
import type { Section } from "@workspace/resume-schema"

import {
  Bullets,
  bulletsOf,
  contactParts,
  itemLines,
  prettyUrl,
  scaler,
  visibleSections,
} from "../primitives"
import { ink } from "../tokens"
import type { TemplateProps } from "../types"

type FontRole = "sans" | "serif"

export type TwoColTheme = {
  bodyFont: FontRole
  headFont: FontRole
  accent: string
  base: number
  nameSize: number
  margin: number
  /** Fraction of the content width given to the sidebar. */
  sidebar: number
  /** Tints the sidebar rather than leaving it on white. */
  sidebarWash: boolean
  marker: string
}

/** Section types that belong in the narrow column. */
const SIDEBAR_TYPES = new Set(["skills", "education"])

/**
 * Meridian and Atlas. The sidebar carries contact, skills and education; the
 * wide column carries the narrative. react-pdf lays columns out with Yoga, so
 * both are plain flex children with fixed percentage widths.
 */
export function TwoColumn({
  resume,
  options,
  fonts,
  theme,
}: TemplateProps & { theme: TwoColTheme }) {
  const s = scaler(options)
  const { basics } = resume
  const sections = visibleSections(resume)
  const aside = sections.filter((x) => SIDEBAR_TYPES.has(x.type))
  const main = sections.filter((x) => !SIDEBAR_TYPES.has(x.type))

  return (
    <Document
      title={`${basics.name} resume`}
      author={basics.name}
      creator="Résumé Studio"
      producer="Résumé Studio"
    >
      <Page
        size={options.pageSize}
        style={{
          fontFamily: fonts[theme.bodyFont],
          fontSize: s(theme.base),
          color: ink.body,
          padding: theme.margin,
        }}
      >
        <View style={{ marginBottom: s(12) }}>
          <Text
            style={{
              fontFamily: fonts[theme.headFont],
              fontSize: s(theme.nameSize),
              fontWeight: 700,
              letterSpacing: -0.4,
              color: ink.black,
            }}
          >
            {basics.name}
          </Text>
          {basics.headline ? (
            <Text
              style={{
                fontSize: s(theme.base + 0.5),
                color: theme.accent,
                marginTop: s(2),
              }}
            >
              {basics.headline}
            </Text>
          ) : null}
          <View
            style={{
              height: 1.6,
              backgroundColor: theme.accent,
              marginTop: s(8),
            }}
          />
        </View>

        <View style={{ display: "flex", flexDirection: "row", gap: s(18) }}>
          <View
            style={{
              width: `${Math.round(theme.sidebar * 100)}%`,
              flexShrink: 0,
              ...(theme.sidebarWash
                ? {
                    backgroundColor: ink.canvas,
                    padding: s(10),
                    borderRadius: 3,
                  }
                : {}),
            }}
          >
            <AsideHeading theme={theme} s={s}>
              Contact
            </AsideHeading>
            <View
              style={{ display: "flex", flexDirection: "column", gap: s(2) }}
            >
              {contactParts(basics).map((part) => (
                <Text
                  key={part}
                  style={{
                    fontSize: s(theme.base - 1),
                    color: ink.body,
                    flexShrink: 1,
                  }}
                >
                  {part}
                </Text>
              ))}
              {basics.links.map((link) => (
                <Link
                  key={link.id}
                  src={link.url}
                  style={{
                    fontSize: s(theme.base - 1),
                    color: theme.accent,
                    textDecoration: "none",
                  }}
                >
                  {link.label || prettyUrl(link.url)}
                </Link>
              ))}
            </View>

            {aside.map((section) => (
              <View key={section.id}>
                <AsideHeading theme={theme} s={s}>
                  {section.title}
                </AsideHeading>
                <AsideSection section={section} theme={theme} s={s} />
              </View>
            ))}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            {basics.summary?.trim() ? (
              <View>
                <MainHeading theme={theme} s={s}>
                  Summary
                </MainHeading>
                <Text
                  style={{
                    fontSize: s(theme.base),
                    lineHeight: 1.5,
                    marginTop: s(4),
                    flexShrink: 1,
                  }}
                >
                  {basics.summary}
                </Text>
              </View>
            ) : null}

            {main.map((section) => (
              <View key={section.id}>
                <MainHeading theme={theme} s={s}>
                  {section.title}
                </MainHeading>
                <View
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: s(9),
                    marginTop: s(5),
                  }}
                >
                  {section.items.map((item) => {
                    const lines = itemLines(item)
                    return (
                      <View key={item.id} wrap={false}>
                        <Text
                          style={{
                            fontFamily: fonts[theme.headFont],
                            fontSize: s(theme.base + 1),
                            fontWeight: 600,
                            color: ink.black,
                          }}
                        >
                          {lines.primary}
                        </Text>
                        <View
                          style={{
                            display: "flex",
                            flexDirection: "row",
                            gap: s(6),
                            marginTop: s(1),
                          }}
                        >
                          {lines.secondary ? (
                            <Text
                              style={{
                                fontSize: s(theme.base - 0.5),
                                color: ink.muted,
                                flexShrink: 1,
                              }}
                            >
                              {lines.href ? (
                                <Link
                                  src={lines.href}
                                  style={{
                                    color: theme.accent,
                                    textDecoration: "none",
                                  }}
                                >
                                  {lines.secondary}
                                </Link>
                              ) : (
                                lines.secondary
                              )}
                            </Text>
                          ) : null}
                          {lines.dates ? (
                            <Text
                              style={{
                                marginLeft: "auto",
                                fontSize: s(theme.base - 1),
                                color: ink.faint,
                              }}
                            >
                              {lines.dates}
                            </Text>
                          ) : null}
                        </View>
                        <Bullets
                          texts={bulletsOf(item)}
                          size={s(theme.base - 0.5)}
                          marker={theme.marker}
                          gap={s(2.5)}
                        />
                      </View>
                    )
                  })}
                </View>
              </View>
            ))}
          </View>
        </View>

        <Text
          fixed
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${pageNumber} / ${totalPages}` : ""
          }
          style={{
            position: "absolute",
            bottom: theme.margin / 2,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: s(7.5),
            color: ink.faint,
          }}
        />
      </Page>
    </Document>
  )
}

function AsideHeading({
  children,
  theme,
  s,
}: {
  children: string
  theme: TwoColTheme
  s: (n: number) => number
}) {
  return (
    <Text
      minPresenceAhead={30}
      style={{
        fontSize: s(theme.base - 2),
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: theme.accent,
        marginTop: s(12),
        marginBottom: s(4),
      }}
    >
      {children}
    </Text>
  )
}

function MainHeading({
  children,
  theme,
  s,
}: {
  children: string
  theme: TwoColTheme
  s: (n: number) => number
}) {
  return (
    <View
      minPresenceAhead={40}
      style={{
        marginTop: s(12),
        paddingBottom: 2.5,
        borderBottomWidth: 0.75,
        borderBottomColor: ink.rule,
        borderBottomStyle: "solid",
      }}
    >
      <Text
        style={{
          fontSize: s(theme.base - 1.5),
          fontWeight: 700,
          letterSpacing: 0.9,
          textTransform: "uppercase",
          color: ink.black,
        }}
      >
        {children}
      </Text>
    </View>
  )
}

function AsideSection({
  section,
  theme,
  s,
}: {
  section: Section
  theme: TwoColTheme
  s: (n: number) => number
}) {
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: s(6) }}>
      {section.items.map((item) => {
        const lines = itemLines(item)
        if (item.kind === "skills") {
          return (
            <View key={item.id} wrap={false}>
              <Text
                style={{
                  fontSize: s(theme.base - 1),
                  fontWeight: 600,
                  color: ink.strong,
                }}
              >
                {lines.primary}
              </Text>
              <Text
                style={{
                  fontSize: s(theme.base - 1),
                  color: ink.body,
                  lineHeight: 1.45,
                  flexShrink: 1,
                }}
              >
                {lines.secondary}
              </Text>
            </View>
          )
        }
        return (
          <View key={item.id} wrap={false}>
            <Text
              style={{
                fontSize: s(theme.base - 0.5),
                fontWeight: 600,
                color: ink.black,
              }}
            >
              {lines.primary}
            </Text>
            {lines.secondary ? (
              <Text
                style={{
                  fontSize: s(theme.base - 1.5),
                  color: ink.muted,
                  flexShrink: 1,
                }}
              >
                {lines.secondary}
              </Text>
            ) : null}
            {lines.dates ? (
              <Text style={{ fontSize: s(theme.base - 1.5), color: ink.faint }}>
                {lines.dates}
              </Text>
            ) : null}
            <Bullets
              texts={bulletsOf(item)}
              size={s(theme.base - 1.5)}
              marker={theme.marker}
              gap={s(2)}
            />
          </View>
        )
      })}
    </View>
  )
}

export const meridianTheme: TwoColTheme = {
  bodyFont: "sans",
  headFont: "sans",
  accent: "#0084d1",
  base: 9.8,
  nameSize: 20,
  margin: 38,
  sidebar: 0.32,
  sidebarWash: true,
  marker: "·",
}

export const atlasTheme: TwoColTheme = {
  bodyFont: "serif",
  headFont: "serif",
  accent: "#74d4ff",
  base: 10,
  nameSize: 21,
  margin: 44,
  sidebar: 0.3,
  sidebarWash: false,
  marker: "–",
}

export const Meridian = (props: TemplateProps) => (
  <TwoColumn {...props} theme={meridianTheme} />
)
export const Atlas = (props: TemplateProps) => (
  <TwoColumn {...props} theme={atlasTheme} />
)
