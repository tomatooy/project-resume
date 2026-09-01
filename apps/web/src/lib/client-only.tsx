import { useEffect, useState, type ReactNode } from "react"

/**
 * Renders children only after hydration. The PDF engine and the pdf.js viewer
 * both touch browser-only APIs, so they must never run during SSR.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return <>{mounted ? children : fallback}</>
}
