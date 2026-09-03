import { describe, expect, it } from "vitest"

import { skills } from "../src/skills/index"
import { fixture } from "./mock"

describe("skill scope", () => {
  const { resume, bullet, otherBullet } = fixture()

  it("narrows a node-scoped skill to the containing item plus the headline", () => {
    const scope = skills.bullet_rewrite.scope({
      resume,
      userMessage: "x",
      selectedNodeId: bullet.id,
    })
    expect(scope.scopeNodeId).toBe(bullet.itemId)
    const json = JSON.stringify(scope.resumeContext)
    expect(json).toContain(bullet.text)
    expect(json).toContain(resume.basics.headline)
    expect(json).not.toContain(otherBullet.text)
    expect(json).not.toContain(resume.basics.email)
  })

  it("sends the whole document when nothing is selected", () => {
    const scope = skills.bullet_rewrite.scope({ resume, userMessage: "x" })
    expect(scope.scopeNodeId).toBeUndefined()
    expect(scope.resumeContext).toBe(resume)
  })

  it("scopes to the item itself when an item is selected", () => {
    const scope = skills.grammar_clarity.scope({
      resume,
      userMessage: "x",
      selectedNodeId: bullet.itemId,
    })
    expect(scope.scopeNodeId).toBe(bullet.itemId)
  })

  it("scopes to basics when basics is selected", () => {
    const scope = skills.grammar_clarity.scope({
      resume,
      userMessage: "x",
      selectedNodeId: "basics",
    })
    expect(scope.scopeNodeId).toBe("basics")
    expect(JSON.stringify(scope.resumeContext)).toContain(resume.basics.name)
    expect(JSON.stringify(scope.resumeContext)).not.toContain(bullet.text)
  })

  it("ignores the selection for whole-document skills", () => {
    const scope = skills.jd_match.scope({
      resume,
      userMessage: "x",
      selectedNodeId: bullet.id,
      jobDescription: "Staff engineer",
    })
    expect(scope.scopeNodeId).toBeUndefined()
    expect(scope.resumeContext).toBe(resume)
  })

  it("falls back to the whole document for an unknown selection", () => {
    const scope = skills.bullet_rewrite.scope({
      resume,
      userMessage: "x",
      selectedNodeId: "blt_missing",
    })
    expect(scope.scopeNodeId).toBeUndefined()
    expect(scope.resumeContext).toBe(resume)
  })
})

describe("skill registry", () => {
  it("registers every skill id with its status, ops and requirements", () => {
    expect(Object.keys(skills).sort()).toEqual([
      "ats_keyword",
      "bullet_rewrite",
      "condense_to_pages",
      "grammar_clarity",
      "impact_quantification",
      "jd_match",
      "summary_optimize",
    ])
    expect(skills.jd_match.requires).toEqual(["jobDescription"])
    expect(skills.condense_to_pages.requires).toEqual(["targetPages"])
    expect(skills.condense_to_pages.tools).toContain("check_fit")
    expect(skills.bullet_rewrite.tools).toEqual(["propose_patches"])
    expect(skills.ats_keyword.status).toBe("phase2")
    expect(skills.jd_match.allowedOps).toContain("move")
  })

  it("puts the job description and page target in the prompt", () => {
    const { resume } = fixture()
    const jd = skills.jd_match.systemPrompt({
      resume,
      userMessage: "x",
      jobDescription: "Kubernetes and Go required",
    })
    expect(jd).toContain("Kubernetes and Go required")
    const pages = skills.condense_to_pages.systemPrompt({
      resume,
      userMessage: "x",
      targetPages: 2,
    })
    expect(pages).toContain("2 page")
    expect(pages).toContain("check_fit")
  })
})
