import {
  contentHash,
  migrateResume,
  regenerateIds,
  type Resume,
} from "@workspace/resume-schema"
import { starter } from "@workspace/resume-schema/fixtures"
import {
  defaultTemplateOptions,
  type TemplateId,
} from "@workspace/resume-render"

import { seedResumes } from "./seed"
import type { ResumeRecord, Suggestion, VersionSummary } from "./types"

/**
 * In-memory store standing in for Supabase until the back-end spec is built.
 *
 * Every function in `api.ts` has the signature the back-end spec gives its
 * matching server function, so swapping this out is a change to `api.ts` only.
 * The browser copy is mirrored to localStorage so edits survive a reload.
 */

const STORAGE_KEY = "resume-studio.store.v1"

export type Version = VersionSummary & {
  resumeId: string
  content: Resume
  hash: string
}

export type Conversation = { id: string; resumeId: string }

export type StoredMessage = {
  id: string
  conversationId: string
  seq: number
  role: "user" | "assistant"
  parts: unknown[]
}

export type Store = {
  resumes: ResumeRecord[]
  versions: Version[]
  conversations: Conversation[]
  messages: StoredMessage[]
  suggestions: Suggestion[]
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function seed(): Store {
  const resumes: ResumeRecord[] = seedResumes.map((entry) => ({
    id: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    templateId: entry.templateId,
    updatedAt: isoMinutesAgo(entry.updatedMinutesAgo),
    data: entry.data,
    schemaVersion: 1,
    templateOptions: defaultTemplateOptions,
    currentVersionId: null,
  }))
  return {
    resumes,
    versions: [],
    conversations: [],
    messages: [],
    suggestions: [],
  }
}

let store: Store | null = null

function load(): Store {
  if (store) return store
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Store
        // Documents are re-validated on read so a stale localStorage copy from
        // an older schema cannot poison the editor.
        parsed.resumes = parsed.resumes.map((r) => ({
          ...r,
          data: migrateResume(r.data),
        }))
        store = parsed
        return store
      }
    } catch {
      // Corrupt or outdated: fall through and reseed.
    }
  }
  store = seed()
  persist()
  return store
}

function persist(): void {
  if (typeof localStorage === "undefined" || !store) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota or private mode. The in-memory copy still works for this session.
  }
}

export function read(): Store {
  return load()
}

export function write<T>(mutate: (store: Store) => T): T {
  const current = load()
  const result = mutate(current)
  persist()
  return result
}

/** Wipes the demo data. Exposed for the "Reset demo data" action. */
export function resetStore(): void {
  store = seed()
  persist()
}

export function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`
}

export function blankResume(): Resume {
  return regenerateIds(starter)
}

export async function snapshot(
  store: Store,
  resumeId: string,
  label: string,
  createdBy: VersionSummary["createdBy"]
): Promise<Version | undefined> {
  const resume = store.resumes.find((r) => r.id === resumeId)
  if (!resume) return undefined

  const hash = await contentHash(resume.data)
  const existing = store.versions.find(
    (v) => v.resumeId === resumeId && v.hash === hash
  )
  if (existing) return existing

  const versionNo =
    store.versions.filter((v) => v.resumeId === resumeId).length + 1
  const version: Version = {
    id: nextId("ver"),
    resumeId,
    versionNo,
    label,
    createdBy,
    createdAt: new Date().toISOString(),
    content: structuredClone(resume.data),
    hash,
  }
  store.versions.push(version)
  resume.currentVersionId = version.id
  return version
}

export function templateIdOf(value: string): TemplateId {
  return value as TemplateId
}
