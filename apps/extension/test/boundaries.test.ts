// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"
import { z } from "zod"
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(path, entry.name))
      : [resolve(path, entry.name)]
  )
}
it("keeps panel, widget and content imports away from privileged clients", () => {
  for (const file of files(resolve("src")).filter((f) =>
    /\/(panel|widget|content)\//.test(f)
  )) {
    const source = readFileSync(file, "utf8")
    expect(source).not.toMatch(
      /from ["'][^"']*(?:lib\/(?:auth|api)|apps\/web|@workspace\/agent|server\/)/
    )
  }
  for (const file of files(resolve("src")))
    expect(readFileSync(file, "utf8")).not.toContain("apps/web")
})
it("declares only required privileges and existing entrypoints", () => {
  const manifest = z
    .object({
      minimum_chrome_version: z.string(),
      permissions: z.array(z.string()),
      host_permissions: z.array(z.string()),
      action: z.object({ default_popup: z.string().optional() }),
      side_panel: z.object({ default_path: z.string() }).optional(),
      content_scripts: z.array(
        z.object({ matches: z.array(z.string()), js: z.array(z.string()) })
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
    "identity",
    "storage",
    "webNavigation",
  ])
  expect(manifest.host_permissions).toEqual(["https://www.linkedin.com/*"])
  expect(manifest.minimum_chrome_version).toBe("127")
  expect(manifest.action.default_popup).toBeUndefined()
  expect(manifest.side_panel).toBeUndefined()
  expect(readFileSync("panel.html", "utf8")).toContain("src/panel/main.tsx")
  expect(manifest.content_scripts).toEqual([
    { matches: ["https://www.linkedin.com/*"], js: ["widget-host.js"] },
  ])
  expect(manifest.web_accessible_resources).toEqual([
    {
      matches: ["https://www.linkedin.com/*"],
      resources: ["widget.html", "panel.html"],
    },
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
