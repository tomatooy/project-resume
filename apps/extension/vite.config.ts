import { readFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import { build, defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwind from "@tailwindcss/vite"
import { z } from "zod"

const root = fileURLToPath(new URL(".", import.meta.url))

/**
 * Bundles the autofill content script on its own, as one IIFE. In the main
 * build, modules it shares with the service worker (`match.ts`) would become
 * shared chunks, and a classic content script cannot import them. The IIFE
 * also gives it its own scope in the isolated world it shares with the widget
 * host and any reinjected copy.
 */
function contentScript(root: string, mode: string): Plugin {
  let code = ""
  return {
    name: "content-script",
    apply: "build",
    async buildStart() {
      const result = await build({
        root,
        mode,
        configFile: false,
        logLevel: "warn",
        build: {
          write: false,
          copyPublicDir: false,
          rolldownOptions: {
            input: `${root}/src/content/autofill.ts`,
            output: { format: "iife" },
          },
        },
      })
      if (
        Array.isArray(result) ||
        !("output" in result) ||
        result.output.length !== 1
      )
        throw new Error("Content script autofill.js must be one file")
      const [chunk] = result.output
      // Lets `bun run dev` rebuild on content script edits.
      for (const id of chunk.moduleIds)
        if (isAbsolute(id)) this.addWatchFile(id)
      code = chunk.code
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "autofill.js", source: code })
    },
  }
}
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "VITE_")
  const origin = z.url().parse(env.VITE_APP_ORIGIN)
  const supabase = z.url().parse(env.VITE_SUPABASE_URL)
  const key = z.string().trim().min(1).parse(env.VITE_SUPABASE_PUBLISHABLE_KEY)
  if (mode === "production") {
    for (const value of [origin, supabase]) {
      const url = new URL(value)
      if (
        url.protocol !== "https:" ||
        url.hostname === "localhost" ||
        url.hostname.endsWith(".localhost") ||
        url.hostname.startsWith("127.") ||
        url.hostname === "[::1]" ||
        url.hostname === "0.0.0.0"
      ) {
        throw new Error(
          "Production extension builds require hosted HTTPS VITE_APP_ORIGIN and VITE_SUPABASE_URL. Set apps/extension/.env.production.local."
        )
      }
    }
    if (key.startsWith("sb_secret_")) {
      throw new Error(
        "Use a Supabase publishable key in public build configuration."
      )
    }
  }
  return {
    optimizeDeps: { exclude: ["pdfjs-dist"] },
    plugins: [
      react(),
      tailwind(),
      contentScript(root, mode),
      {
        name: "extension-manifest",
        generateBundle(_options, bundle) {
          const host = bundle["widget-host.js"]
          if (
            host?.type !== "chunk" ||
            host.imports.length ||
            host.dynamicImports.length ||
            host.exports.length
          )
            throw new Error("Widget content script must be self-contained")
          const manifest = z
            .looseObject({
              host_permissions: z.array(z.string()),
              key: z.string().optional(),
            })
            .parse(
              JSON.parse(
                readFileSync(new URL("manifest.json", import.meta.url), "utf8")
              )
            )
          manifest.host_permissions.push(
            `${new URL(origin).origin}/*`,
            `${new URL(supabase).origin}/*`
          )
          if (env.VITE_EXTENSION_PUBLIC_KEY)
            manifest.key = env.VITE_EXTENSION_PUBLIC_KEY
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(manifest, null, 2),
          })
        },
      },
    ],
    resolve: {
      alias: {
        "@workspace/ui/globals.css": fileURLToPath(
          new URL("../../packages/ui/src/styles/globals.css", import.meta.url)
        ),
        "@workspace/ui": fileURLToPath(
          new URL("../../packages/ui/src", import.meta.url)
        ),
      },
    },
    build: {
      rollupOptions: {
        input: {
          panel: `${root}/panel.html`,
          widget: `${root}/widget.html`,
          "widget-host": `${root}/src/content/widget-host.ts`,
          background: `${root}/src/background/index.ts`,
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
        },
      },
    },
  }
})
