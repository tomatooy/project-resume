import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
export default defineConfig({
  resolve: {
    alias: {
      "@workspace/ui": fileURLToPath(
        new URL("../../packages/ui/src", import.meta.url)
      ),
    },
  },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"] },
})
