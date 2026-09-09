import type {
  JobParser,
  ParseJobInput,
  ParseJobResult,
  ResumeTailor,
  TailorResumeInput,
  TailorResumeResult,
} from "@workspace/resume-core"
import { ParsedJobPostingSchema } from "@workspace/resume-core"
import { ParsedResumeSchema } from "@workspace/resume-schema"
import { Output, generateText } from "ai"

import type { Models } from "./models"
import { JOB_PARSE_PROMPT, TAILOR_PROMPT } from "./prompts/job"

/**
 * The `JobParser` port. Structured output, no tools, no loop: reading a posting
 * has nothing to negotiate, so there is no step budget to get wrong.
 */
export function createJobParser(models: Models): JobParser {
  return {
    async parse(input: ParseJobInput): Promise<ParseJobResult> {
      const result = await generateText({
        model: models.smart,
        output: Output.object({ schema: ParsedJobPostingSchema }),
        system: JOB_PARSE_PROMPT,
        prompt: `Job posting:\n\n${input.text}`,
        providerOptions: models.providerOptions,
        abortSignal: input.signal,
      })
      return { parsed: result.output, model: models.ids.smart }
    },
  }
}

/**
 * The `ResumeTailor` port. Same one-shot structured-output shape as the parser:
 * the model is given a document and a posting and returns a document.
 *
 * The resume goes in as JSON rather than rendered text because the model has to
 * return the same structure, and showing it the shape it must produce is worth
 * more than the tokens a prose rendering would save.
 */
export function createResumeTailor(models: Models): ResumeTailor {
  return {
    async tailor(input: TailorResumeInput): Promise<TailorResumeResult> {
      const { posting } = input
      const result = await generateText({
        model: models.smart,
        output: Output.object({ schema: ParsedResumeSchema }),
        system: TAILOR_PROMPT,
        prompt: [
          `Job title: ${posting.title}`,
          `Company: ${posting.company}`,
          posting.location ? `Location: ${posting.location}` : "",
          `Required: ${posting.mustHaves.join("; ") || "not stated"}`,
          `Preferred: ${posting.niceToHaves.join("; ") || "not stated"}`,
          `Keywords: ${posting.keywords.join(", ") || "not stated"}`,
          "",
          "Resume:",
          JSON.stringify(input.resume),
        ]
          .filter((line) => line !== "")
          .join("\n"),
        providerOptions: models.providerOptions,
        abortSignal: input.signal,
      })
      return { parsed: result.output, model: models.ids.smart }
    },
  }
}
