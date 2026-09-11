/**
 * Everything the app is allowed to know about the model side, and nothing
 * else. The prompts, the tool bodies and the visibility rule stay inside; a
 * caller gets a turn, a parser, a summarizer, the models, and the message
 * conversions. The playbook catalog has its own subpath (`./skills`), which is
 * the client-safe half of the library.
 */
export { fromUIMessage, toModelMessages, toUIMessage } from "./messages"
export { type Models, type ModelTier, createModels } from "./models"
export { createJobParser, createResumeTailor } from "./job"
export { createResumeParser } from "./parser"
export { createSummarizer } from "./summarizer"
export type { AgentTools, TurnState } from "./tools"
export {
  TURN_ERROR_TEXT,
  type TurnOutcome,
  checkFitAnswer,
  checkFitState,
  parseUIMessages,
  startTurn,
} from "./turn"
