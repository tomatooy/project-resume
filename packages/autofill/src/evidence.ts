import { compactJson, type Json } from "./context"

export type ApplicantSource = "profile" | "notes" | "resume"
export type ApplicantEvidence = { ref: string; value: Json }
type Field = { label: string; help?: string; options?: string[] }

export const jsonObject = (value: Json | undefined): { [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}

export function notesOf(context: Json): string {
  const notes = jsonObject(context).notes
  return typeof notes === "string" ? notes : ""
}

/** Complete records retain dates, negations, scope and relationships. */
export function applicantEvidence(
  context: Json
): Record<ApplicantSource, ApplicantEvidence[]> {
  const records = jsonObject(context)
  const profile = Object.entries(jsonObject(records.profile)).flatMap(
    ([key, value]) => {
      const compact = compactJson(value)
      return compact === undefined
        ? []
        : [{ ref: `profile.${key}`, value: compact }]
    }
  )
  const resume = jsonObject(records.resume)
  const facts: ApplicantEvidence[] = Object.entries(
    jsonObject(resume.basics)
  ).flatMap(([key, value]) => {
    const compact = compactJson(value)
    return compact === undefined
      ? []
      : [{ ref: `resume.basics.${key}`, value: compact }]
  })
  if (Array.isArray(resume.sections)) {
    for (const [i, section] of resume.sections.entries()) {
      const object = jsonObject(section)
      if (!Array.isArray(object.items)) continue
      for (const [j, item] of object.items.entries()) {
        const value = compactJson({
          section: object.title ?? "",
          type: object.type ?? "",
          ...jsonObject(item),
        })
        if (value !== undefined)
          facts.push({ ref: `resume.sections.${i}.items.${j}`, value })
      }
    }
  }
  // Keep sections and ancestor headings together so qualifiers survive retrieval.
  const notes: ApplicantEvidence[] = []
  let headings: { level: number; text: string }[] = []
  let lines: string[] = []
  let start = 1
  const flush = () => {
    if (lines.some((line) => line.trim()))
      notes.push({
        ref: `notes.line.${start}`,
        value: [...headings.map(({ text }) => text), ...lines].join("\n"),
      })
    lines = []
  }
  for (const [index, line] of notesOf(context).split("\n").entries()) {
    const heading = /^\s*(#{1,6})\s/.exec(line)
    if (heading) {
      flush()
      const level = heading[1]?.length ?? 1
      headings = [
        ...headings.filter((entry) => entry.level < level),
        { level, text: line },
      ]
      start = index + 2
    } else lines.push(line)
  }
  flush()
  return { profile, notes, resume: facts }
}

const STOP = new Set(
  "a an and are as at be by can do for from have how i if in is it of on or our please the their this to us what when which with would you your yes no".split(
    " "
  )
)

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((word) => word.length > 1 && !STOP.has(word))
  )
}

/** Retrieval is conservative: no lexical match keeps all facts. */
export function relevantEvidence(
  facts: ApplicantEvidence[],
  field: Field
): ApplicantEvidence[] {
  const text = `${field.label} ${field.help ?? ""}`
  const terms = words(`${text} ${(field.options ?? []).join(" ")}`)
  const aliases: [RegExp, string][] = [
    [
      /degree|education|school|university|college|discipline|study|graduat/i,
      "education school degree field end",
    ],
    [
      /notice|start|availab|relocat|remote|hybrid|onsite|work mode/i,
      "preferences startKind startDate noticeWeeks workModes cities relocation",
    ],
    [
      /authori[sz]|sponsor|citizen|visa|eligible/i,
      "workAuth authorized sponsorshipNow sponsorshipFuture status",
    ],
    [
      /country|location|address|city|state|postal|zip/i,
      "contact location country city state",
    ],
    [
      /experience|skill|language|tool|proficien|program|develop/i,
      "experience skills summary",
    ],
    [/name|pronoun/i, "personal name pronouns"],
    [/phone|email|contact/i, "contact email phone"],
    [/portfolio|website|linkedin|github|url/i, "links"],
  ]
  for (const [pattern, extra] of aliases) {
    if (pattern.test(text)) for (const term of words(extra)) terms.add(term)
  }
  const matched = facts.filter((fact) => {
    const tokens = words(`${fact.ref} ${JSON.stringify(fact.value)}`)
    return [...terms].some((term) => tokens.has(term))
  })
  return matched.length ? matched : facts
}

export function evidenceContext(
  source: ApplicantSource,
  evidence: ApplicantEvidence[]
): Json {
  return {
    source,
    evidence: evidence.map(({ ref, value }) => ({ ref, value })),
  }
}
