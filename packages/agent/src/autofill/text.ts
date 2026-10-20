import {
  type Json,
  NoteMergeProposalSchema,
  ProfileFieldKeySchema,
} from "@workspace/autofill"
import type {
  AutofillModels,
  ModelField,
  ModelUsage,
  NumberedQuestion,
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
    async shortText({ signal, context, fields }) {
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
      const { output, usage } = await ask(
        ShortTextSchema,
        SHORT_TEXT_PROMPT,
        prompt,
        signal
      )
      return {
        answers: output.answers.map((answer) => ({
          key: answer.key,
          value: orNull(answer.value),
          evidence: unique(
            answer.evidence.flatMap((source) => {
              const known = SourceSchema.safeParse(source.trim().toLowerCase())
              return known.success ? [known.data] : []
            })
          ),
          applicant: answer.applicant,
        })),
        usage,
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
