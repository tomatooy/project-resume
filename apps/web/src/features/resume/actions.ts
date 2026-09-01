import {
  findNode,
  newId,
  type Item,
  type ResumePatch,
  type Resume,
  type SectionTypeName,
} from "@workspace/resume-schema"

import type { ResumeSession } from "./store"

/**
 * Editor gestures expressed as patches.
 *
 * Manual edits use the same contract as AI edits, so there is one mutation
 * path, one undo mechanism, and one place where a change can be rejected.
 */

const MANUAL = { reason: "Manual edit", skillId: "manual" } as const

/** Sets a single text field. Consecutive edits to the same field undo together. */
export function setText(
  session: ResumeSession,
  nodeId: string,
  field: string,
  value: string
): void {
  const ref = findNode(session.state.doc, nodeId)
  if (!ref) return
  const before = (ref.node as Record<string, unknown>)[field]
  if (typeof before !== "string" || before === value) return

  // `replace_text` requires a non-empty result, so clearing an optional field
  // goes through `update_fields` instead.
  const patch: ResumePatch =
    value.trim() === ""
      ? {
          ...MANUAL,
          op: "update_fields",
          targetNodeId: nodeId,
          before: { [field]: before },
          after: { [field]: value },
        }
      : {
          ...MANUAL,
          op: "replace_text",
          targetNodeId: nodeId,
          field,
          before,
          after: value,
        }

  session.apply([patch], { coalesceKey: `${nodeId}:${field}` })
}

/** Sets several non-text fields at once, e.g. a date range or a skills array. */
export function setFields(
  session: ResumeSession,
  nodeId: string,
  after: Record<string, unknown>
): void {
  const ref = findNode(session.state.doc, nodeId)
  if (!ref) return
  const current = ref.node as Record<string, unknown>
  const before: Record<string, unknown> = {}
  let changed = false
  for (const key of Object.keys(after)) {
    before[key] = current[key]
    if (JSON.stringify(current[key]) !== JSON.stringify(after[key]))
      changed = true
  }
  if (!changed) return
  session.apply([
    { ...MANUAL, op: "update_fields", targetNodeId: nodeId, before, after },
  ])
}

export function insertAfter(
  session: ResumeSession,
  parentId: string,
  afterNodeId: string | null,
  node: unknown
): void {
  session.apply([
    { ...MANUAL, op: "insert_after", parentId, afterNodeId, node },
  ])
}

export function removeNode(session: ResumeSession, nodeId: string): void {
  const ref = findNode(session.state.doc, nodeId)
  if (!ref) return
  session.apply([
    { ...MANUAL, op: "delete", targetNodeId: nodeId, before: ref.node },
  ])
  if (session.state.selectedNodeId === nodeId) session.select(null)
}

export function moveNode(
  session: ResumeSession,
  nodeId: string,
  toIndex: number
): void {
  session.apply([{ ...MANUAL, op: "move", targetNodeId: nodeId, toIndex }])
}

export function addBullet(
  session: ResumeSession,
  itemId: string,
  afterBulletId: string | null = null,
  text = ""
): void {
  // The schema forbids an empty bullet, so a new one starts with a space that
  // the field immediately replaces once the user types.
  insertAfter(session, itemId, afterBulletId, { text: text || " " })
}

export function addLink(session: ResumeSession): void {
  const links = session.state.doc.basics.links
  insertAfter(session, "basics", links.at(-1)?.id ?? null, {
    label: "New link",
    url: "https://example.com",
  })
}

const NEW_ITEM: Record<SectionTypeName, () => Omit<Item, "id">> = {
  experience: () => ({
    kind: "experience",
    company: "Company",
    role: "Role",
    start: currentMonth(),
    end: "present",
    bullets: [{ id: newId("bul"), text: " " }],
  }),
  education: () => ({
    kind: "education",
    school: "School",
    bullets: [],
  }),
  projects: () => ({ kind: "project", name: "Project", bullets: [] }),
  skills: () => ({ kind: "skills", label: "Group", skills: [] }),
  custom: () => ({ kind: "custom", title: "Entry", bullets: [] }),
}

export function addItem(
  session: ResumeSession,
  sectionId: string,
  type: SectionTypeName
): void {
  const section = session.state.doc.sections.find((s) => s.id === sectionId)
  insertAfter(
    session,
    sectionId,
    section?.items.at(-1)?.id ?? null,
    NEW_ITEM[type]()
  )
}

const SECTION_TITLE: Record<SectionTypeName, string> = {
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  custom: "More",
}

/**
 * Sections are not patchable nodes at the document root, so adding one is a
 * whole-document replacement rather than an `insert_after`.
 */
export function addSection(
  session: ResumeSession,
  type: SectionTypeName
): string | undefined {
  const sectionId = newId("sec")
  const next: Resume = {
    ...session.state.doc,
    sections: [
      ...session.state.doc.sections,
      { id: sectionId, type, title: SECTION_TITLE[type], items: [] },
    ],
  }
  session.replaceDocument(next)
  return sectionId
}

export function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}
