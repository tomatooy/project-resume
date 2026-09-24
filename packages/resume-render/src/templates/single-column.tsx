import { Document, Link, Page, Text, View } from "@react-pdf/renderer"
import type { Section } from "@workspace/resume-schema"

import type { ResolvedFonts } from "../fonts"

import {
  Bullets,
  bulletsOf,
  ContactLine,
  Heading,
  itemLines,
  scaler,
  visibleSections,
} from "../primitives"
import { ink } from "../tokens"
import type { TemplateProps } from "../types"

type FontRole = "sans" | "serif"

export type SingleTheme = {
  bodyFont: FontRole
  headFont: FontRole
  /** `null` for deliberately monochrome templates. */
  accent: string | null
  base: number
  nameSize: number
  margin: number
  header: "left" | "centered" | "band"
  /** A short accent bar under the header, as in the design's Lisbon preview. */
  headerBar: boolean
  sectionRule: boolean
  sectionGap: number
  itemGap: number
  marker: string
}

/**
 * The layout shared by Lisbon, Plainsong, Harbor and Ledger. They differ in
 * typography, density and how the header is treated, not in structure, so one
 * engine keeps them consistent and keeps the page-break rules in one place.
 */
export function SingleColumn({
  resume,
  options,
  fonts,
  theme,
}: TemplateProps & { theme: SingleTheme }) {
  const s = scaler(options)
  const accent = theme.accent ?? ink.black
  const headingColor = theme.accent ?? ink.black
  const banded = theme.header === "band"
  const centered = theme.header === "centered"
  const sections = visibleSections(resume)
  const { basics } = resume

  return (
    <Document
      title={`${basics.name} resume`}
      author={basics.name}
      creator="VS:Résumé"
      producer="VS:Résumé"
    >
      <Page
        size={options.pageSize}
        style={{
          fontFamily: fonts[theme.bodyFont],
          fontSize: s(theme.base),
          color: ink.body,
          paddingTop: banded ? 0 : theme.margin,
          paddingBottom: theme.margin,
          paddingHorizontal: banded ? 0 : theme.margin,
        }}
      >
        <View
          style={
            banded
              ? {
                  backgroundColor: accent,
                  paddingVertical: s(18),
                  paddingHorizontal: theme.margin,
                  marginBottom: s(14),
                }
              : { marginBottom: s(4) }
          }
        >
          <Text
            style={{
              fontFamily: fonts[theme.headFont],
              fontSize: s(theme.nameSize),
              fontWeight: 700,
              letterSpacing: -0.4,
              color: banded ? ink.white : ink.black,
              textAlign: centered ? "center" : "left",
            }}
          >
            {basics.name}
          </Text>

          {basics.headline ? (
            <Text
              style={{
                fontSize: s(theme.base + 0.5),
                color: banded ? ink.white : ink.muted,
                marginTop: s(3),
                textAlign: centered ? "center" : "left",
              }}
            >
              {basics.headline}
            </Text>
          ) : null}

          <View
            style={{
              marginTop: s(4),
              alignItems: centered ? "center" : "flex-start",
            }}
          >
            <ContactLine
              basics={basics}
              size={s(theme.base - 0.7)}
              color={banded ? ink.white : ink.muted}
              linkColor={banded ? ink.white : accent}
            />
          </View>
        </View>

        {theme.headerBar && !banded ? (
          <View
            style={{
              width: s(34),
              height: 1.6,
              backgroundColor: accent,
              marginTop: s(8),
            }}
          />
        ) : null}

        <View style={banded ? { paddingHorizontal: theme.margin } : undefined}>
          {basics.summary?.trim() ? (
            <View>
              <Heading
                size={s(theme.base - 1.5)}
                color={headingColor}
                rule={theme.sectionRule ? ink.rule : false}
                marginTop={s(theme.sectionGap)}
              >
                Summary
              </Heading>
              <Text
                style={{
                  fontSize: s(theme.base),
                  lineHeight: 1.5,
                  marginTop: s(5),
                  flexShrink: 1,
                }}
              >
                {basics.summary}
              </Text>
            </View>
          ) : null}

          {sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              theme={theme}
              fonts={fonts}
              s={s}
              headingColor={headingColor}
              accent={accent}
            />
          ))}
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

function SectionBlock({
  section,
  theme,
  fonts,
  s,
  headingColor,
  accent,
}: {
  section: Section
  theme: SingleTheme
  fonts: ResolvedFonts
  s: (n: number) => number
  headingColor: string
  accent: string
}) {
  const skillsOnly = section.type === "skills"

  return (
    <View>
      <Heading
        size={s(theme.base - 1.5)}
        color={headingColor}
        rule={theme.sectionRule ? ink.rule : false}
        marginTop={s(theme.sectionGap)}
      >
        {section.title}
      </Heading>

      <View
        style={{
          display: "flex",
          flexDirection: "column",
          gap: s(skillsOnly ? 3 : theme.itemGap),
          marginTop: s(5),
        }}
      >
        {section.items.map((item) => {
          const lines = itemLines(item)
          const bullets = bulletsOf(item)

          if (item.kind === "skills") {
            return (
              <View
                key={item.id}
                wrap={false}
                style={{ display: "flex", flexDirection: "row", gap: s(5) }}
              >
                <Text
                  style={{
                    fontSize: s(theme.base - 0.5),
                    fontWeight: 600,
                    color: ink.strong,
                  }}
                >
                  {lines.primary}
                </Text>
                <Text
                  style={{
                    fontSize: s(theme.base - 0.5),
                    color: ink.body,
                    flexShrink: 1,
                    flex: 1,
                    lineHeight: 1.45,
                  }}
                >
                  {lines.secondary}
                </Text>
              </View>
            )
          }

          return (
            // An item never splits across pages. A single item taller than one
            // page still breaks, which is accepted.
            <View key={item.id} wrap={false}>
              <View
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "baseline",
                  gap: s(6),
                }}
              >
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
                {lines.secondary ? (
                  <Text
                    style={{
                      fontSize: s(theme.base),
                      color: ink.muted,
                      flexShrink: 1,
                    }}
                  >
                    {lines.href ? (
                      <Link
                        src={lines.href}
                        style={{ color: accent, textDecoration: "none" }}
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
                      color: ink.muted,
                    }}
                  >
                    {lines.dates}
                  </Text>
                ) : null}
              </View>

              {lines.tertiary ? (
                <Text
                  style={{
                    fontSize: s(theme.base - 1),
                    color: ink.faint,
                    marginTop: s(1),
                  }}
                >
                  {lines.tertiary}
                </Text>
              ) : null}

              <Bullets
                texts={bullets}
                size={s(theme.base - 0.5)}
                marker={theme.marker}
                gap={s(2.5)}
              />
            </View>
          )
        })}
      </View>
    </View>
  )
}

export const lisbonTheme: SingleTheme = {
  bodyFont: "sans",
  headFont: "sans",
  accent: "#0069a8",
  base: 10.5,
  nameSize: 21,
  margin: 40,
  header: "left",
  headerBar: true,
  sectionRule: false,
  sectionGap: 13,
  itemGap: 9,
  marker: "·",
}

export const plainsongTheme: SingleTheme = {
  bodyFont: "serif",
  headFont: "serif",
  accent: null,
  base: 10.8,
  nameSize: 22,
  margin: 48,
  header: "centered",
  headerBar: false,
  sectionRule: true,
  sectionGap: 14,
  itemGap: 10,
  marker: "–",
}

export const harborTheme: SingleTheme = {
  bodyFont: "sans",
  headFont: "sans",
  accent: "#00a6f4",
  base: 10.2,
  nameSize: 23,
  margin: 40,
  header: "band",
  headerBar: false,
  sectionRule: true,
  sectionGap: 13,
  itemGap: 9,
  marker: "•",
}

export const ledgerTheme: SingleTheme = {
  bodyFont: "sans",
  headFont: "sans",
  accent: "#00598a",
  base: 9,
  nameSize: 17,
  margin: 30,
  header: "left",
  headerBar: false,
  sectionRule: true,
  sectionGap: 9,
  itemGap: 6,
  marker: "·",
}

export const Lisbon = (props: TemplateProps) => (
  <SingleColumn {...props} theme={lisbonTheme} />
)
export const Plainsong = (props: TemplateProps) => (
  <SingleColumn {...props} theme={plainsongTheme} />
)
export const Harbor = (props: TemplateProps) => (
  <SingleColumn {...props} theme={harborTheme} />
)
export const Ledger = (props: TemplateProps) => (
  <SingleColumn {...props} theme={ledgerTheme} />
)
