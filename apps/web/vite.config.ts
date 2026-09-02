import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
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
