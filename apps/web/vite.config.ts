import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { z } from "zod"

const ProductionEnvironment = z.object({
  PUBLIC_SUPABASE_URL: z.url(),
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
})

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  environments: {
    ssr: { build: { sourcemap: true } },
  },
  // `.env.local` lives at the monorepo root, next to `supabase/`, because the
  // Supabase CLI reads the same file for the Google OAuth credentials. Vite
  // would otherwise look in `apps/web` and silently find nothing, which shows
  // up much later as "PUBLIC_SUPABASE_URL is not set" on the first request.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  // `front-end.md` section 11 reads config as `import.meta.env.PUBLIC_*`.
  // Vite only exposes VITE_-prefixed vars unless the prefix list says
  // otherwise, so without this the Supabase URL and key are undefined in
  // the browser and every sign-in fails with no clue why.
  envPrefix: ["VITE_", "PUBLIC_"],
  optimizeDeps: {
    // The pdf.js worker is imported for its URL, not to be executed in the
    // page. Left to itself the dependency scanner treats that import as a
    // package entry and pre-bundles it, then warns on every request that
    // `.vite/deps/pdf.worker.min.mjs` is missing. In dev that warning is
    // echoed back through the server-to-client log bridge and re-triggers
    // itself, which is enough to wedge the whole dev server.
    exclude: ["pdfjs-dist"],
  },
  plugins: [
    {
      name: "validate-production-environment",
      configResolved(config) {
        if (config.command !== "build" || config.mode !== "production") return
        const result = ProductionEnvironment.safeParse(config.env)
        if (!result.success) {
          throw new Error(
            "Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY in the root .env.production.local or the build environment."
          )
        }
        const url = new URL(result.data.PUBLIC_SUPABASE_URL)
        if (
          url.protocol !== "https:" ||
          url.hostname === "localhost" ||
          url.hostname.endsWith(".localhost") ||
          url.hostname.startsWith("127.") ||
          url.hostname === "[::1]" ||
          url.hostname === "0.0.0.0"
        ) {
          throw new Error(
            "Production builds require a hosted HTTPS Supabase URL."
          )
        }
        if (
          result.data.PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_secret_")
        ) {
          throw new Error(
            "Use a Supabase publishable key in public build configuration."
          )
        }
      },
    },
    // Must come before `tanstackStart()`: it claims the ssr environment
    // that Start then builds into.
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    devtools({
      // Console piping is bidirectional and on by default: client logs go to
      // the server terminal, and the server terminal goes back to the client.
      // A single client warning therefore echoes between the two forever. It
      // is not theoretical, it happened twice while building this app and
      // produced a 615 MB and then a 1.4 GB log before the server was killed.
      // Nothing here needs client logs in the terminal, so the loop goes away
      // with the feature.
      consolePiping: { enabled: false },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
