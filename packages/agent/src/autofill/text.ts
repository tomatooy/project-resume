import {
  applicantEvidence,
  type Json,
  notesOf,
  NoteMergeProposalSchema,
  ProfileFieldKeySchema,
  relevantEvidence,
} from "@workspace/autofill"
import type {
  AutofillModels,
  ModelField,
  ModelUsage,
  NumberedQuestion,
  ShortTextOutput,
} from "@workspace/resume-core"
import { Output, generateText } from "ai"
import { z } from "zod"

import type { Models } from "../models"
import {
  FILL_FROM_ANSWER_PROMPT,
  GENERATE_PROMPT,
  MERGE_NOTES_PROMPT,
  QUESTIONS_PROMPT,
  SHORT_TEXT_PROMPT,
  dataBlock,
} from "../prompts/autofill"
import { beforeDeadline } from "./deadline"

/*
 * Output schemas stay flat for the reason `job.ts` gives: objects of strings,
 * numbers and booleans in plain arrays, with no unions and no optional
 * fields. An empty string stands for "no answer", and each result is mapped
 * onto the port's own shape afterwards.
 */

const ShortTextSchema = z.object({
  answers: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      evidence: z.array(z.string()),
      applicant: z.boolean(),
      blocked: z.boolean(),
    })
  ),
})

const QuestionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      keys: z.array(z.string()),
      options: z.array(z.string()),
      companySpecific: z.boolean(),
    })
  ),
})

const FillSchema = z.object({
  answers: z.array(z.object({ key: z.string(), value: z.string() })),
})

/** The three operation kinds come back as three lists, not a union. */
const MergeSchema = z.object({
  add: z.array(z.object({ heading: z.string(), text: z.string() })),
  replace: z.array(z.object({ line: z.number().int(), text: z.string() })),
  delete: z.array(z.number().int()),
  hints: z.array(z.string()),
})

const DraftSchema = z.object({ text: z.string() })

const SourceSchema = z.enum(["resume", "profile", "notes"])
type Source = z.infer<typeof SourceSchema>

const unique = <T>(values: T[]): T[] => [...new Set(values)]

const orNull = (value: string): string | null =>
  value.trim() === "" ? null : value

const usageOf = (usage: {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
}): ModelUsage => ({
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
})

/* ------------------------------------------------------------- rendering */

const records = (context: Json): string =>
  `Applicant records (JSON):\n${dataBlock(JSON.stringify(context))}`

const company = (name: string | null): string =>
  name
    ? `Company of the page: ${dataBlock(name)}`
    : "Company of the page: not known"

const optionsLine = (options: string[]): string[] =>
  options.length > 0 ? [`Options: ${options.map(dataBlock).join(" / ")}`] : []

function fieldBlock(
  field: ModelField,
  kind: string | null,
  options: string[] = []
): string {
  return [
    kind ? `Field ${field.key} (${kind})` : `Field ${field.key}`,
    `Label: ${dataBlock(field.label)}`,
    ...(field.help ? [`Help text: ${dataBlock(field.help)}`] : []),
    ...optionsLine(options),
  ].join("\n")
}

/** "1. text (Yes / No)", as the panel numbers it (spec 8.2). */
const questionLine = ({ number, text, options }: NumberedQuestion): string =>
  `${number}. ${dataBlock(options.length > 0 ? `${text} (${options.join(" / ")})` : text)}`

const section = (title: string, lines: string[]): string =>
  lines.length > 0 ? `${title}\n${lines.join("\n\n")}` : `${title}\nNone.`

/* ----------------------------------------------------------------- calls */

/**
 * The DeepSeek side of the `AutofillModels` port (spec 12.2): single
 * structured calls on the fast model, no tools and no loop.
 */
export function createAutofillText(
  models: Models
): Pick<
  AutofillModels,
  "shortText" | "questions" | "fillFromAnswer" | "mergeNotes" | "generate"
> {
  async function ask<T>(
    schema: z.ZodType<T>,
    system: string,
    prompt: string,
    signal: AbortSignal
  ): Promise<{ output: T; usage: ModelUsage }> {
    const result = await generateText({
      model: models.fast,
      output: Output.object({ schema }),
      system,
      prompt,
      providerOptions: models.providerOptions.fast,
      abortSignal: signal,
      maxRetries: 1,
    })
    return { output: result.output, usage: usageOf(result.usage) }
  }

  return {
    async shortText({ signal, deadline, context, fields }) {
      const evidence = applicantEvidence(context)
      const notes = notesOf(context)
      const sent = new Map(
        fields.map((field) => [
          field.key,
          {
            profile: relevantEvidence(evidence.profile, field).map(
              ({ ref, value }) => ({ ref, value })
            ),
            resume: relevantEvidence(evidence.resume, field).map(
              ({ ref, value }) => ({ ref, value })
            ),
          },
        ])
      )
      const focused: Json = Object.fromEntries(sent)
      /**
       * The sources an answer cites. The model may name a source or cite a
       * ref it was sent for that field, as in `resume.sections.1.items.0`,
       * or a part of one. The Notes are sent whole, so any `notes.` ref
       * counts. A ref that was not sent for the field is dropped.
       */
      const sourcesOf = (
        key: string,
        cited: string[],
        allowed: Source[]
      ): Source[] => {
        const given = sent.get(key)
        const refs = [...(given?.profile ?? []), ...(given?.resume ?? [])].map(
          ({ ref }) => ref.toLowerCase()
        )
        return unique(
          cited.flatMap((entry) => {
            const name = entry.trim().toLowerCase()
            const source = SourceSchema.safeParse(name.split(".", 1)[0])
            if (!source.success || !allowed.includes(source.data)) return []
            const known =
              name === source.data ||
              source.data === "notes" ||
              refs.some((ref) => name === ref || name.startsWith(`${ref}.`))
            return known ? [source.data] : []
          })
        )
      }
      const read = async (
        context: Json,
        allowed: Source[]
      ): Promise<ShortTextOutput> => {
        const prompt = [
          records(context),
          section(
            "Fields:",
            fields.map((field) =>
              fieldBlock(
                field,
                field.maxLength === undefined
                  ? field.control
                  : `${field.control}, at most ${field.maxLength} characters`
              )
            )
          ),
        ].join("\n\n")
        const { output, usage } = await beforeDeadline(
          { signal, deadline: deadline - 50 },
          (call) => ask(ShortTextSchema, SHORT_TEXT_PROMPT, prompt, call.signal)
        )
        return {
          answers: output.answers.map((answer) => ({
            key: answer.key,
            value: orNull(answer.value),
            evidence: sourcesOf(answer.key, answer.evidence, allowed),
            applicant: answer.applicant,
            blocked: answer.blocked,
          })),
          usage,
        }
      }
      const empty = (): ShortTextOutput => ({
        answers: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      })
      const [noted, recorded] = await Promise.allSettled([
        notes.trim() ? read({ notes }, ["notes"]) : Promise.resolve(empty()),
        evidence.profile.length + evidence.resume.length
          ? read({ fields: focused }, ["profile", "resume"])
          : Promise.resolve(empty()),
      ])
      const noteOutput = noted.status === "fulfilled" ? noted.value : null
      const recordOutput =
        recorded.status === "fulfilled" ? recorded.value : null
      const answers: ShortTextOutput["answers"] = fields.map(({ key }) => {
        const record = recordOutput?.answers.find(
          (answer) => answer.key === key
        )
        const note = noteOutput?.answers.find((answer) => answer.key === key)
        const missing = {
          key,
          value: null,
          evidence: [],
          applicant: false,
          blocked: true,
        }
        if (
          record?.applicant ||
          (record?.blocked && !record.evidence.includes("resume")) ||
          record?.evidence.includes("profile")
        )
          return record
        if (evidence.profile.length > 0 && (!recordOutput || !record))
          return missing
        if (
          note?.applicant ||
          note?.blocked ||
          (note?.value && note.evidence.includes("notes"))
        )
          return note
        if (!noteOutput || (notes.trim() && !note)) return missing
        if (!recordOutput || (evidence.resume.length > 0 && !record))
          return missing
        if (note?.value && note.evidence.length === 0) return missing
        return record ?? { ...missing, blocked: false }
      })
      return {
        answers,
        degraded: !noteOutput || !recordOutput,
        usage: {
          inputTokens:
            (noteOutput?.usage.inputTokens ?? 0) +
            (recordOutput?.usage.inputTokens ?? 0),
          outputTokens:
            (noteOutput?.usage.outputTokens ?? 0) +
            (recordOutput?.usage.outputTokens ?? 0),
        },
      }
    },

    async questions({ signal, context, company: name, fields }) {
      const prompt = [
        company(name),
        records(context),
        section(
          "Fields:",
          fields.map((field) => fieldBlock(field, null, field.options))
        ),
      ].join("\n\n")
      const { output, usage } = await ask(
        QuestionsSchema,
        QUESTIONS_PROMPT,
        prompt,
        signal
      )
      return { questions: output.questions, usage }
    },

    async fillFromAnswer({ signal, context, text, questions, fields }) {
      const prompt = [
        records(context),
        section(
          "Questions the applicant was shown:",
          questions.map(
            (question) =>
              `${questionLine(question)}\nFields: ${question.keys.join(", ") || "none"}`
          )
        ),
        section(
          "Fields:",
          fields.map((field) => fieldBlock(field, field.control, field.options))
        ),
        `The applicant's answer:\n${dataBlock(text)}`,
      ].join("\n\n")
      const { output, usage } = await ask(
        FillSchema,
        FILL_FROM_ANSWER_PROMPT,
        prompt,
        signal
      )
      return {
        answers: output.answers.map(({ key, value }) => ({
          key,
          value: orNull(value),
        })),
        usage,
      }
    },

    async mergeNotes({ signal, numbered, questions, text, company: name }) {
      const prompt = [
        company(name),
        numbered === ""
          ? "Notes, numbered:\nEmpty."
          : `Notes, numbered:\n${dataBlock(numbered)}`,
        section(
          "Questions the applicant was shown:",
          questions.map(questionLine)
        ),
        `What the applicant wrote:\n${dataBlock(text)}`,
      ].join("\n\n")
      const { output, usage } = await ask(
        MergeSchema,
        MERGE_NOTES_PROMPT,
        prompt,
        signal
      )
      // The server still checks every line number when it applies the ops.
      const proposal = NoteMergeProposalSchema.parse({
        ops: [
          ...output.add.map(({ heading, text }) => ({
            op: "add",
            heading,
            text,
          })),
          ...output.replace.map(({ line, text }) => ({
            op: "replace",
            line,
            text,
          })),
          ...output.delete.map((line) => ({ op: "delete", line })),
        ],
        hints: unique(
          output.hints.flatMap((hint) => {
            const key = ProfileFieldKeySchema.safeParse(hint.trim())
            return key.success ? [key.data] : []
          })
        ).slice(0, 10),
      })
      return { proposal, usage }
    },

    async generate({ signal, context, field, limit, instruction }) {
      const prompt = [
        records(context),
        [
          `Question: ${dataBlock(field.label)}`,
          ...(field.help ? [`Help text: ${dataBlock(field.help)}`] : []),
          field.singleLine
            ? "Field: a single-line input."
            : "Field: a multi-line text box.",
          limit
            ? `Length limit: at most ${limit.value} ${limit.kind}.`
            : "Length limit: none stated.",
          ...(instruction
            ? [`The applicant's instruction: ${instruction}`]
            : []),
        ].join("\n"),
      ].join("\n\n")
      const { output, usage } = await ask(
        DraftSchema,
        GENERATE_PROMPT,
        prompt,
        signal
      )
      return { text: output.text.trim(), usage }
    },
  }
}
