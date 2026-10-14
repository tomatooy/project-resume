import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
export default defineConfig({
  plugins: [
    {
      name: "local-test-fonts",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".ttf?url"))
          return `export default ${JSON.stringify(id.slice(0, -4))}`
      },
    },
  ],
  resolve: {
    alias: {
      "@workspace/ui": fileURLToPath(
        new URL("../../packages/ui/src", import.meta.url)
      ),
    },
  },
  // Real work in jsdom: PDF rendering, attachment reads and 20-field runs. The
  // 5s default is below what these take under a parallel full-suite run, which
  // showed up as a changing set of "failures" that each passed in isolation.
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
  },
})
