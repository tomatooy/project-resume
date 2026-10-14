import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build, defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwind from "@tailwindcss/vite"
import { z } from "zod"
import {
  RUNTIME_BUNDLE_FILE,
  RUNTIME_LIB_NAME,
} from "./src/dom-agent/runtime/protocol"

const root = fileURLToPath(new URL(".", import.meta.url))

/**
 * Build one bundle that runs where the extension's own modules are not there: a
 * content script in a page, or the DOM agent's runtime in a main world. A
 * surviving import would fail at runtime rather than at build time, so the
 * assertion is the reason this is built here instead of imported.
 */
async function selfContainedBundle(input: {
  entry: string
  name: string
  label: string
}): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      lib: {
        entry: `${root}/${input.entry}`,
        name: input.name,
        formats: ["iife"],
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const chunks: string[] = []
  for (const output of outputs) {
    if (!("output" in output)) throw new Error(`${input.label} is unavailable`)
    for (const chunk of output.output) {
      if (chunk.type !== "chunk") continue
      if (chunk.imports.length || chunk.dynamicImports.length)
        throw new Error(`${input.label} must be self-contained`)
      chunks.push(chunk.code)
    }
  }
  if (chunks.length === 0) throw new Error(`${input.label} produced no code`)
  return chunks.join("\n")
}
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
          this.emitFile({
            type: "asset",
            fileName: "autofill-content.js",
            source: await selfContainedBundle({
              entry: "src/autofill/content.ts",
              name: "VsAutofill",
              label: "Autofill content script",
            }),
          })
          // Injected as text into a page's main world, so it carries its own
          // copy of everything it uses.
          this.emitFile({
            type: "asset",
            fileName: RUNTIME_BUNDLE_FILE,
            source: await selfContainedBundle({
              entry: "src/dom-agent/runtime/main.ts",
              name: RUNTIME_LIB_NAME,
              label: "DOM agent runtime",
            }),
          })

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
