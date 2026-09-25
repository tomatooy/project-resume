import { createClient, type Session } from "@supabase/supabase-js"
import { config } from "./config"

const trusted = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
})
const settings = config()
const auth = createClient(settings.supabaseUrl, settings.supabaseKey, {
  auth: {
    flowType: "pkce",
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: "resume-extension-auth",
    storage: {
      async getItem(key) {
        await trusted
        const values = await chrome.storage.local.get(key)
        return typeof values[key] === "string" ? values[key] : null
      },
      async setItem(key, value) {
        await trusted
        await chrome.storage.local.set({ [key]: value })
      },
      async removeItem(key) {
        await trusted
        await chrome.storage.local.remove(key)
      },
    },
  },
})
let pending: Promise<Session | null> | null = null
export async function session(): Promise<Session | null> {
  if (pending) return pending
  pending = (async () => {
    const result = await auth.auth.getSession()
    if (result.error) throw new Error("Sign in again")
    const current = result.data.session
    if (!current) return null
    if ((current.expires_at ?? 0) * 1000 > Date.now() + 7 * 60_000)
      return current
    const refreshed = await auth.auth.refreshSession()
    if (refreshed.error || !refreshed.data.session)
      throw new Error("Sign in again")
    auth.realtime.setAuth(refreshed.data.session.access_token)
    return refreshed.data.session
  })()
  try {
    return await pending
  } finally {
    pending = null
  }
}
export async function account() {
  const current = await session()
  return current
    ? { id: current.user.id, email: current.user.email ?? "Connected account" }
    : null
}
export async function accessToken(): Promise<string> {
  const current = await session()
  if (!current) throw new Error("Connect your account")
  return current.access_token
}
export async function realtimeClient() {
  auth.realtime.setAuth(await accessToken())
  return auth
}
let connecting: Promise<void> | null = null
export async function connect(): Promise<void> {
  if (connecting) return connecting
  connecting = (async () => {
    const redirectTo = chrome.identity.getRedirectURL("auth/callback")
    const { data, error } = await auth.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    })
    if (error || !data.url) throw new Error("Could not connect account")
    const callback = await chrome.identity.launchWebAuthFlow({
      url: data.url,
      interactive: true,
    })
    if (!callback) throw new Error("Account connection cancelled")
    const url = new URL(callback)
    const expected = new URL(redirectTo)
    if (
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      url.searchParams.has("error")
    )
      throw new Error("Invalid sign-in callback")
    const code = url.searchParams.get("code")
    if (!code) throw new Error("Invalid sign-in callback")
    const exchanged = await auth.auth.exchangeCodeForSession(code)
    if (exchanged.error) throw new Error("Could not connect account")
  })()
  try {
    await connecting
  } finally {
    connecting = null
  }
}
export async function disconnect() {
  await auth.auth.signOut({ scope: "local" })
  await chrome.storage.session.clear()
}
