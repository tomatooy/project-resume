import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { tailorInstructionsQuery, useSaveTailorInstructions } from "./queries"

type Draft = { accountId: string; instructions: string }

export function useTailorInstructions(accountId: string | undefined) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const saved = useQuery(tailorInstructionsQuery(accountId))
  const save = useSaveTailorInstructions(accountId)
  const current = draft?.accountId === accountId ? draft : null
  const saveError = save.variables?.accountId === accountId && save.isError
  return {
    value: current?.instructions ?? saved.data ?? "",
    loading: saved.isPending,
    error: saved.isError
      ? "Could not load your saved instructions."
      : saveError
        ? "Could not save your instructions."
        : null,
    change(instructions: string) {
      if (!accountId) return
      const next = { accountId, instructions }
      setDraft(next)
      save.mutate(next)
    },
    async persist(instructions: string) {
      if (!accountId)
        throw new Error("Connect your account to save instructions.")
      await save.mutateAsync({ accountId, instructions })
    },
    retry() {
      if (saved.isError) void saved.refetch()
      else if (current) save.mutate(current)
    },
  }
}
