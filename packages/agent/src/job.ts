import type {
  JobParser,
  ParseJobInput,
  ParseJobResult,
} from "@workspace/resume-core"
import { ParsedJobPostingSchema } from "@workspace/resume-core"
import { Output, generateText } from "ai"

import type { Models } from "./models"
import { JOB_PARSE_PROMPT } from "./prompts/job"

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
