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
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"] },
})
