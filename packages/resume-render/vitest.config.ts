import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

/**
 * `?url` imports normally resolve to a served path, which does not exist on
 * disk under Node. react-pdf's Node font loader reads plain filesystem paths,
 * so rewrite them to absolute paths for tests.
 */
function ttfAsAbsolutePath() {
  return {
    name: "ttf-as-absolute-path",
    enforce: "pre" as const,
    resolveId(id: string, importer?: string) {
      if (!id.endsWith(".ttf?url")) return null
      const bare = id.slice(0, -"?url".length)
      const abs = bare.startsWith(".")
        ? resolve(importer ? resolve(importer, "..") : process.cwd(), bare)
        : bare
      return `\0ttfurl:${abs}`
    },
    load(id: string) {
      if (!id.startsWith("\0ttfurl:")) return null
      return `export default ${JSON.stringify(id.slice("\0ttfurl:".length))}`
    },
  }
}

export default defineConfig({
  plugins: [ttfAsAbsolutePath()],
  test: { environment: "node", testTimeout: 60_000 },
})
