import { useChat } from "@ai-sdk/react"
import { useStore } from "@tanstack/react-store"
import type { AssistantRuntime } from "./assistant-runtime"

export { checkFitAnswered, type SendOptions } from "./assistant-runtime"

export function useAssistant(runtime: AssistantRuntime) {
  const chat = useChat({ chat: runtime.chat })
  const state = useStore(runtime.store)
  return {
    ...state,
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    send: runtime.send,
    retry: runtime.retry,
    decide: runtime.decide,
    stop: () => runtime.stop(),
  }
}
