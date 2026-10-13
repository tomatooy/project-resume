import { AppError } from "../domain/errors"
import type { AutofillProfileRepository } from "../autofill-profile/service"
import type { AutofillProfile, ProfileData } from "../autofill-profile/schema"
import { reviewPolicy } from "../autofill/contract"
import type { ScopedAnswer } from "../autofill/contract"
import type { ScopedAnswerRepository } from "../autofill/answers"
import type {
  AutofillDecider,
  AutofillPolicyProvider,
  AutofillQuota,
  DecisionAnswer,
  DecisionQuestion,
} from "../autofill/ports"
export class InMemoryAutofillProfileRepository
  implements AutofillProfileRepository
{
  value: AutofillProfile | null = null
  async get() {
    return structuredClone(this.value)
  }
  async save(expectedRevision: number, data: ProfileData) {
    if ((this.value?.revision ?? 0) !== expectedRevision) return null
    this.value = {
      schemaVersion: 1,
      revision: expectedRevision + 1,
      data: structuredClone(data),
    }
    return structuredClone(this.value)
  }
}
export class InMemoryAutofillQuota implements AutofillQuota {
  readonly attempts: { kind: "plan" | "jev"; at: number }[] = []
  constructor(private readonly clock: () => number = Date.now) {}
  async reserve(kind: "plan" | "jev") {
    const window = kind === "plan" ? 60000 : 3600000
    if (
      this.attempts.filter(
        (a) => a.kind === kind && a.at > this.clock() - window
      ).length >= (kind === "plan" ? 20 : 120)
    )
      throw new AppError("RATE_LIMITED", "autofill_quota")
    this.attempts.push({ kind, at: this.clock() })
  }
}
export class StubAutofillDecider implements AutofillDecider {
  calls: DecisionQuestion[][] = []
  answers: DecisionAnswer[] = []
  async decide(
    questions: DecisionQuestion[],
    options: { signal: AbortSignal; beforeAttempt: () => Promise<void> }
  ) {
    options.signal.throwIfAborted()
    await options.beforeAttempt()
    this.calls.push(questions)
    return this.answers
  }
}
export class InMemoryAutofillPolicy implements AutofillPolicyProvider {
  value = reviewPolicy()
  async get() {
    return structuredClone(this.value)
  }
}

export class InMemoryScopedAnswerRepository implements ScopedAnswerRepository {
  readonly answers = new Map<string, ScopedAnswer>()
  async list() {
    return structuredClone([...this.answers.values()])
  }
  async save(answer: ScopedAnswer, expectedRevision: number) {
    if ((this.answers.get(answer.id)?.revision ?? 0) !== expectedRevision)
      return null
    const saved = { ...structuredClone(answer), revision: expectedRevision + 1 }
    this.answers.set(saved.id, saved)
    return structuredClone(saved)
  }
  async remove(id: string, expectedRevision: number) {
    if (this.answers.get(id)?.revision !== expectedRevision) return false
    return this.answers.delete(id)
  }
}
