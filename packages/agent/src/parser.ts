import type {
  ParseResumeInput,
  ParseResumeResult,
  ResumeParser,
} from "@workspace/resume-core"
import { ParsedResumeSchema } from "@workspace/resume-schema"
import { Output, generateText } from "ai"

import type { Models } from "./models"
import { IMPORT_PROMPT } from "./prompts/import"

/**
 * The `ResumeParser` port. One structured-output call, no tools and no loop:
 * import has nothing to negotiate with the model, so there is no step budget
 * and no stop condition to get wrong.
 */
export function createResumeParser(models: Models): ResumeParser {
  return {
    async parse(input: ParseResumeInput): Promise<ParseResumeResult> {
      const result = await generateText({
        model: models.smart,
        output: Output.object({ schema: ParsedResumeSchema }),
        system: IMPORT_PROMPT,
        prompt: `Resume text:\n\n${input.text}`,
        providerOptions: models.providerOptions,
        abortSignal: input.signal,
      })
      return { parsed: result.output, model: models.ids.smart }
    },
  }
}
