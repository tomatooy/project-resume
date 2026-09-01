import { CURRENT_SCHEMA_VERSION, ResumeSchema, type Resume } from "./schema"

type Step = {
  from: number
  up: (data: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Ordered upgrade steps. Adding a schema version means appending a step here
 * and bumping `CURRENT_SCHEMA_VERSION`; nothing else reads `schemaVersion`.
 */
const STEPS: Step[] = []

/**
 * Upgrades any stored document to the current version and validates it.
 * Throws on documents that cannot be repaired, which surfaces as a 500 rather
 * than silently serving a broken resume.
 */
export function migrateResume(data: unknown): Resume {
  if (typeof data !== "object" || data === null) {
    throw new Error("Resume data is not an object")
  }

  let current = { ...(data as Record<string, unknown>) }
  let version =
    typeof current.schemaVersion === "number" ? current.schemaVersion : 1

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = STEPS.find((s) => s.from === version)
    if (!step) throw new Error(`No migration from schema version ${version}`)
    current = step.up(current)
    version += 1
    current.schemaVersion = version
  }

  return ResumeSchema.parse({
    ...current,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  })
}

/** True when the stored document is behind and `migrateResume` would change it. */
export function needsMigration(schemaVersion: number): boolean {
  return schemaVersion < CURRENT_SCHEMA_VERSION
}
