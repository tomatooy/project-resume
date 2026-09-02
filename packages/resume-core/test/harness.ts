import {
  indexNodes,
  type Resume,
  type ResumePatch,
} from "@workspace/resume-schema"

import {
  InMemoryAgentRunRepository,
  InMemoryConversationRepository,
  InMemoryDb,
  InMemoryResumeRepository,
  InMemorySuggestionRepository,
  InMemoryVersionRepository,
} from "../src/testing/index"
import {
  ResumeService,
  SuggestionService,
  VersionService,
} from "../src/services/index"

export function harness() {
  const db = new InMemoryDb()
  const resumes = new InMemoryResumeRepository(db)
  const versions = new InMemoryVersionRepository(db)
  const runs = new InMemoryAgentRunRepository(db)
  const suggestions = new InMemorySuggestionRepository(db)
  const conversations = new InMemoryConversationRepository(db)

  return {
    db,
    resumes,
    versions,
    runs,
    suggestions,
    conversations,
    resumeService: new ResumeService(resumes),
    versionService: new VersionService(resumes, versions),
    suggestionService: new SuggestionService(resumes, runs, suggestions),
  }
}

/** The first bullet of the first experience item, which every fixture has. */
export function firstBullet(resume: Resume): { id: string; text: string } {
  for (const ref of indexNodes(resume).values()) {
    if (ref.kind === "bullet") {
      const node = ref.node as { id: string; text: string }
      return { id: node.id, text: node.text }
    }
  }
  throw new Error("fixture has no bullets")
}

export function rewriteBullet(
  bullet: { id: string; text: string },
  after: string,
  skillId = "bullet_rewrite"
): ResumePatch {
  return {
    op: "replace_text",
    targetNodeId: bullet.id,
    field: "text",
    before: bullet.text,
    after,
    reason: "Tighter wording.",
    skillId,
  }
}

export function allNodeIds(resume: Resume): string[] {
  return [...indexNodes(resume).keys()]
}

/** Narrows an array element that the test knows exists, without a `!`. */
export function only<T>(items: T[], index = 0): T {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at index ${index}`)
  return item
}
