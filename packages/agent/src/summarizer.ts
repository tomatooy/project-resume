import {
  MemorySummarySchema,
  type SummarizeInput,
  type SummarizeResult,
  type Summarizer,
} from "@workspace/resume-core"
import { Output, generateText } from "ai"

import { toModelMessages } from "./messages"
import type { Models } from "./models"

const SUMMARY_PROMPT = [
  "You maintain a compact memory of a conversation between a user and a resume assistant. Produce the updated memory as an object with these fields: user_goal (one sentence, the role or outcome the user is after), resume_focus (sections or items the user keeps returning to), preferences (how they want text written), decisions (changes they accepted or refused, and why), open_tasks (things they said they would do or asked for later).",
  "Merge the previous memory with the new transcript. Keep only what the transcript supports; never add facts. Drop open tasks the transcript shows as done. Keep every entry short.",
].join("\n\n")

/** The `Summarizer` port on the fast model, with structured output. */
export function createSummarizer(models: Models): Summarizer {
  return {
    async summarize(input: SummarizeInput): Promise<SummarizeResult> {
      const transcript = toModelMessages(input.messages)
        .map((message) =>
          typeof message.content === "string"
            ? `${message.role}: ${message.content}`
            : ""
        )
        .filter((line) => line.length > 0)
        .join("\n")

      const previous = input.previous
        ? `Previous memory:\n${JSON.stringify(input.previous)}`
        : "No previous memory."

      const result = await generateText({
        model: models.fast,
        output: Output.object({ schema: MemorySummarySchema }),
        system: SUMMARY_PROMPT,
        prompt: `${previous}\n\nTranscript:\n${transcript}`,
        providerOptions: models.providerOptions,
      })
      return { summary: result.output, model: models.ids.fast }
    },
  }
}
