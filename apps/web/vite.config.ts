import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
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
