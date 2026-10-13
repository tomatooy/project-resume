import type { AutofillPolicy } from "./contract"

export type DecisionQuestion = {
  id: string
  kind: "semantic" | "record" | "option"
  instructions: string
  candidates: Record<string, string>
  state: string
}
export type DecisionAnswer = {
  id: string
  choice: string
  probability: number
  margin: number
  tied: boolean
}
export interface AutofillDecider {
  decide(
    questions: DecisionQuestion[],
    options: { signal: AbortSignal; beforeAttempt: () => Promise<void> }
  ): Promise<DecisionAnswer[]>
}
export interface AutofillQuota {
  reserve(kind: "plan" | "jev"): Promise<void>
}
export interface AutofillPolicyProvider {
  get(): Promise<AutofillPolicy>
}
