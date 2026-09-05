import {
  indexNodes,
  type Resume,
  type ResumePatch,
} from "@workspace/resume-schema"

import { createServices } from "../src/services/index"
import { InMemoryBackground, inMemoryPorts } from "../src/testing/index"

/** The ports by name, and the services wired the way the app wires them. */
export function harness() {
  const ports = inMemoryPorts()
  const services = createServices(ports)
  return {
    ...ports,
    background: new InMemoryBackground(),
    resumeService: services.resumes,
    importService: services.imports,
    versionService: services.versions,
    suggestionService: services.suggestions,
    runService: services.runs,
    memoryService: services.memory,
  }
}

/** The first bullet of the first experience item, which every fixture has. */
export function firstBullet(resume: Resume): { id: string; text: string } {
  for (const ref of indexNodes(resume).values()) {
    if (ref.kind === "bullet") return ref.node
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
