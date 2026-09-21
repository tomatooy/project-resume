/**
 * Everything the app is allowed to know about the model side, and nothing
 * else. The prompts, the tool bodies and the visibility rule stay inside; a
 * caller gets a turn, a parser, a summarizer, the models, and the message
 * conversions. The library is reached through `mergeSkills` / `resolveSkills`,
 * which is also how the turn's playbooks are resolved; no playbook text is on
 * this surface, and none reaches the browser.
 */
export { fromUIMessage, toModelMessages, toUIMessage } from "./messages"
export { type Models, type ModelTier, createModels } from "./models"
export { createJobParser, createResumeTailor } from "./job"
export { createResumeParser } from "./parser"
export {
  mergeSkills,
  resolveSkills,
  type Skill,
  type SkillEntry,
} from "./skills/index"
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
