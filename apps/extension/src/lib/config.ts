import { z } from "zod"
const PublicConfig = z.object({
  appOrigin: z.url(),
  supabaseUrl: z.url(),
  supabaseKey: z.string().min(1),
})
export function config() {
  const value = PublicConfig.parse({
    appOrigin: import.meta.env.VITE_APP_ORIGIN,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  })
  for (const input of [value.appOrigin, value.supabaseUrl]) {
    const url = new URL(input)
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error("Configure a secure app origin")
  }
  return { ...value, appOrigin: new URL(value.appOrigin).origin }
}
