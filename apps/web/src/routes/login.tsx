import { createFileRoute, redirect } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { useState } from "react"

import { DEFAULT_NEXT, safeNextPath } from "@/lib/next-path"
import { supabaseBrowser } from "@/lib/supabase-browser"
import { getSession } from "@/server/fns/session"

// Official Google "G", rendered as the sign-in button's leading mark.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.28 1.48-1.14 2.73-2.4 3.58v2.98h3.88c2.26-2.09 3.54-5.17 3.54-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.01c-1.08.72-2.45 1.16-4.05 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28c-.25-.72-.38-1.49-.38-2.28s.14-1.56.38-2.28V6.63H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.37l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.63l3.98 3.09C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  )
}

const ERRORS: Record<string, string> = {
  missing_code: "Google did not send a sign-in code back. Please try again.",
  exchange_failed: "That sign-in link has expired. Please try again.",
}

export const Route = createFileRoute("/login")({
  // The return type is annotated so `error` stays optional: the guard in
  // `_app.tsx` redirects here with only `next`, and an inferred type would
  // make the key required.
  validateSearch: (
    search: Record<string, unknown>
  ): { next: string; error?: string } => ({
    next: safeNextPath(search.next),
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: async ({ search }) => {
    // Landing here with a live session means the guard sent someone who is
    // already signed in, usually by going Back after signing in.
    const session = await getSession()
    if (session) throw redirect({ href: search.next })
  },
  component: LoginScreen,
})

function LoginScreen() {
  const { next, error } = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  async function signIn() {
    setPending(true)
    setFailed(null)

    const redirectTo = new URL("/auth/callback", window.location.origin)
    redirectTo.searchParams.set("next", next)

    const { error: signInError } = await supabaseBrowser().auth.signInWithOAuth(
      {
        provider: "google",
        options: { redirectTo: redirectTo.toString() },
      }
    )

    // On success the browser has already left for Google, so reaching this line
    // at all means the redirect never started.
    if (signInError) {
      setPending(false)
      setFailed("Could not reach Google. Check your connection and try again.")
    }
  }

  const message = failed ?? (error ? ERRORS[error] : undefined)

  return (
    <main className="flex h-svh flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-[9px]">
          <span className="flex size-[26px] items-center justify-center rounded-[7px] bg-primary font-heading text-[13px] font-bold text-primary-foreground">
            R
          </span>
          <span className="font-heading text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">
            Résumé Studio
          </span>
        </div>

        <h1 className="mt-6 font-heading text-[20px] font-semibold tracking-[-0.01em] text-foreground">
          Sign in
        </h1>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">
          Your resumes are private to your account.
        </p>

        {message ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] leading-[1.45] text-destructive"
          >
            {message}
          </p>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="mt-6 h-10 w-full justify-center gap-2.5 border-[#747775] bg-white text-[14px] font-medium tracking-[-0.01em] text-[#1f1f1f] hover:border-[#747775] hover:bg-[#f7fafe] hover:text-[#1f1f1f]"
          disabled={pending}
          onClick={signIn}
        >
          <GoogleIcon className="size-[18px]" />
          {pending ? "Redirecting…" : "Continue with Google"}
        </Button>
      </div>
    </main>
  )
}

export { DEFAULT_NEXT }
