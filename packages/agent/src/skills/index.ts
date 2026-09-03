import type { SkillId } from "@workspace/resume-core"

import { bulletRewrite } from "./bullet-rewrite"
import { condenseToPages } from "./condense-to-pages"
import { grammarClarity } from "./grammar-clarity"
import { jdMatch } from "./jd-match"
import { atsKeyword, impactQuantification, summaryOptimize } from "./phase2"
import type { ResumeSkill } from "./types"

export const skills: Record<SkillId, ResumeSkill> = {
  bullet_rewrite: bulletRewrite,
  jd_match: jdMatch,
  grammar_clarity: grammarClarity,
  condense_to_pages: condenseToPages,
  ats_keyword: atsKeyword,
  impact_quantification: impactQuantification,
  summary_optimize: summaryOptimize,
}

export type {
  ResumeSkill,
  SkillContext,
  SkillScope,
  SkillToolName,
} from "./types"
