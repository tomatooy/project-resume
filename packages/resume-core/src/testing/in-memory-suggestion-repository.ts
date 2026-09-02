import type { Suggestion } from "../domain/suggestion"
import type {
  DecideInput,
  DecideOutcome,
  NewSuggestion,
  SuggestionRepository,
} from "../ports/suggestion-repository"
import type { InMemoryDb, SuggestionRow } from "./db"
import { InMemoryVersionRepository } from "./in-memory-version-repository"

export class InMemorySuggestionRepository implements SuggestionRepository {
  private readonly versions: InMemoryVersionRepository

  constructor(private readonly db: InMemoryDb) {
    this.versions = new InMemoryVersionRepository(db)
  }

  async insertMany(
    runId: string,
    resumeId: string,
    suggestions: NewSuggestion[]
  ): Promise<Suggestion[]> {
    const rows = suggestions.map<SuggestionRow>((input) => ({
      id: this.db.uuid(),
      runId,
      resumeId,
      ordinal: input.ordinal,
      patch: input.patch,
      targetNodeId: input.targetNodeId,
      status: "pending",
    }))
    this.db.suggestions.push(...rows)
    return rows.map(toSuggestion)
  }

  async listForRun(runId: string): Promise<Suggestion[]> {
    return this.db.suggestions
      .filter((s) => s.runId === runId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(toSuggestion)
  }

  async decide(input: DecideInput): Promise<DecideOutcome> {
    const run = this.db.runs.find((r) => r.id === input.runId)
    if (!run) throw new Error(`run ${input.runId} not found`)
    const resume = this.db.resumes.find((r) => r.id === run.resumeId)
    if (!resume) throw new Error(`resume ${run.resumeId} not found`)

    for (const decision of input.decisions) {
      const row = this.db.suggestions.find(
        (s) => s.id === decision.suggestionId
      )
      if (row) row.status = decision.status
    }

    if (!input.newContent || !input.contentHash) {
      return {
        version: null,
        revision: resume.revision,
        updatedAt: resume.updatedAt,
      }
    }

    const result = await this.versions.create({
      resumeId: run.resumeId,
      content: input.newContent,
      schemaVersion: input.newContent.schemaVersion,
      contentHash: input.contentHash,
      label: "AI suggestions accepted",
      createdBy: "agent",
      agentRunId: run.id,
    })

    return {
      version: result.version,
      revision: result.revision,
      updatedAt: result.updatedAt,
    }
  }
}

function toSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    runId: row.runId,
    ordinal: row.ordinal,
    patch: row.patch,
    status: row.status,
  }
}
