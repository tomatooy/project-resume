import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/**
 * The app's own Vite config pulls in Cloudflare and TanStack Start, which want
 * a server to build, so component tests get a standalone config. There is no
 * React plugin here on purpose: tests need the JSX transform, which esbuild
 * already does from `jsx: react-jsx` in tsconfig, not Fast Refresh.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@workspace/ui": fileURLToPath(
        new URL("../../packages/ui/src", import.meta.url)
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
