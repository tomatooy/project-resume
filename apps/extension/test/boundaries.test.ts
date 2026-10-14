// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"
import { z } from "zod"
import { AUTOFILL_APPLICATION_MATCHES } from "../src/autofill/sites"
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(path, entry.name))
      : [resolve(path, entry.name)]
  )
}
it("keeps panel, widget and content imports away from privileged clients", () => {
  for (const file of files(resolve("src")).filter(
    (f) =>
      /\/(panel|widget|content)\//.test(f) ||
      /\/autofill\/(?:Panel|content|scanner|registry|executor|messages)\./.test(
        f
      )
  )) {
    const source = readFileSync(file, "utf8")
    expect(source).not.toMatch(
      /from ["'][^"']*(?:lib\/(?:auth|api)|apps\/web|@workspace\/agent|server\/)/
    )
  }
  for (const file of files(resolve("src")))
    expect(readFileSync(file, "utf8")).not.toContain("apps/web")
})
it("keeps the debugger session and its transport out of anything a page runs", () => {
  const pageSide = files(resolve("src")).filter(
    (file) =>
      /\/(?:panel|widget|content)\//.test(file) ||
      /\/autofill\/(?:Panel|content|scanner|registry|executor|messages)\./.test(
        file
      )
  )
  expect(pageSide.length).toBeGreaterThan(0)
  for (const file of pageSide)
    expect(readFileSync(file, "utf8")).not.toMatch(/dom-agent\/(?:session|cdp)/)
})
it("keeps the page runtime free of extension APIs and of the worker's modules", () => {
  const runtime = files(resolve("src/dom-agent/runtime"))
  expect(runtime.length).toBeGreaterThan(0)
  for (const file of runtime) {
    const source = readFileSync(file, "utf8")
    // The bundle runs in a page's main world, where no extension API exists.
    expect(source).not.toMatch(/\bchrome\./)
    expect(source).not.toMatch(/from "\.\.?\/(?:cdp|session)"/)
    // The bundle inlines what it imports, so a value import from the workspace
    // would drag the schema library into every page. Types are erased.
    expect(source).not.toMatch(/^import (?!type\b)[^;]*@workspace\//m)
  }
})
it("wires the page runtime as its own self-contained bundle", () => {
  const config = readFileSync("vite.config.ts", "utf8")
  expect(config).toContain("src/dom-agent/runtime/main.ts")
  expect(config).toContain("RUNTIME_BUNDLE_FILE")
  expect(config).toContain("must be self-contained")
})
it("declares only required privileges and existing entrypoints", () => {
  const manifest = z
    .object({
      minimum_chrome_version: z.string(),
      permissions: z.array(z.string()),
      host_permissions: z.array(z.string()),
      optional_host_permissions: z.array(z.string()),
      action: z.object({ default_popup: z.string().optional() }),
      side_panel: z.object({ default_path: z.string() }).optional(),
      content_scripts: z.array(
        z.object({
          matches: z.array(z.string()),
          js: z.array(z.string()),
          run_at: z.string(),
          all_frames: z.boolean().optional(),
        })
      ),
      web_accessible_resources: z.array(
        z.object({
          resources: z.array(z.string()),
          matches: z.array(z.string()),
        })
      ),
      background: z.object({ service_worker: z.string(), type: z.string() }),
    })
    .parse(JSON.parse(readFileSync("manifest.json", "utf8")))
  expect(manifest.permissions.sort()).toEqual([
    "activeTab",
    "alarms",
    // Required, not optional: Chrome refuses to list debugger in
    // optional_permissions, which is why attaching is bounded to a run
    // instead of being gated behind a runtime permission request.
    "debugger",
    "identity",
    "offscreen",
    "scripting",
    "storage",
    "webNavigation",
  ])
  expect(manifest.host_permissions).toEqual([
    "https://www.linkedin.com/*",
    ...AUTOFILL_APPLICATION_MATCHES,
  ])
  expect(manifest.optional_host_permissions).toEqual(["https://*/*"])
  expect(manifest.minimum_chrome_version).toBe("127")
  expect(manifest.action.default_popup).toBeUndefined()
  expect(manifest.side_panel).toBeUndefined()
  expect(readFileSync("panel.html", "utf8")).toContain("src/panel/main.tsx")
  expect(manifest.content_scripts).toEqual([
    {
      matches: ["https://www.linkedin.com/*"],
      js: ["widget-host.js"],
      run_at: "document_idle",
    },
    {
      matches: [...AUTOFILL_APPLICATION_MATCHES],
      js: ["autofill-content.js"],
      run_at: "document_idle",
      all_frames: false,
    },
  ])
  expect(manifest.web_accessible_resources).toEqual([
    {
      matches: ["https://www.linkedin.com/*"],
      resources: ["widget.html"],
    },
    { resources: ["panel.html"], matches: ["https://*/*"] },
  ])
  expect(readFileSync("src/content/widget-host.ts", "utf8")).not.toMatch(
    /^import /m
  )
  expect(manifest.background).toEqual({
    service_worker: "background.js",
    type: "module",
  })
  expect(readFileSync("vite.config.ts", "utf8")).toContain(
    "src/background/index.ts"
  )
})
