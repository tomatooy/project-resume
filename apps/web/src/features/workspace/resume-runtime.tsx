import { createContext, use, type ReactNode } from "react"
import type { ResumeRuntime } from "./store"

const Context = createContext<ResumeRuntime | null>(null)
export function useOptionalResumeRuntime(): ResumeRuntime | null {
  return use(Context)
}
export function ResumeRuntimeProvider({
  runtime,
  children,
}: {
  runtime: ResumeRuntime
  children: ReactNode
}) {
  return <Context value={runtime}>{children}</Context>
}
export function useResumeRuntime(): ResumeRuntime {
  const runtime = use(Context)
  if (!runtime) throw new Error("ResumeRuntimeProvider is required")
  return runtime
}
