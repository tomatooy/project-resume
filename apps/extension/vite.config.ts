import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build, defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwind from "@tailwindcss/vite"
import { z } from "zod"

const root = fileURLToPath(new URL(".", import.meta.url))
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "VITE_")
  const origin = z.url().parse(env.VITE_APP_ORIGIN)
  const supabase = z.url().parse(env.VITE_SUPABASE_URL)
  return {
    plugins: [
      react(),
      tailwind(),
      {
        name: "extension-manifest",
        async generateBundle(_options, bundle) {
          const content = await build({
            configFile: false,
            logLevel: "error",
            build: {
              write: false,
              lib: {
                entry: `${root}/src/autofill/content.ts`,
                name: "VsAutofill",
                formats: ["iife"],
              },
              rollupOptions: { output: { inlineDynamicImports: true } },
            },
          })
          const outputs = Array.isArray(content) ? content : [content]
          for (const result of outputs) {
            if (!("output" in result))
              throw new Error("Autofill bundle is unavailable")
            for (const chunk of result.output) {
              if (chunk.type !== "chunk") continue
              if (chunk.imports.length || chunk.dynamicImports.length)
                throw new Error(
                  "Autofill content script must be self-contained"
                )
              this.emitFile({
                type: "asset",
                fileName: "autofill-content.js",
                source: chunk.code,
              })
            }
          }

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
          offscreen: `${root}/offscreen.html`,
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
