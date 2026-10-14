import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { capturePage, describeFixture } from "./capture-page"
import { connectCdp, listTargets, pickPageTarget } from "./cdp-client"
import { decodeFixture, fixturePath, FIXTURES_RELATIVE } from "./fixture-format"

/**
 * The recorder, run by hand against a page the user has open.
 *
 *     bun apps/extension/tools/capture-fixture.ts --site ashby --match ashbyhq.com
 *
 * Nothing imports this file. It is an entry point, not a module, so a normal
 * run of the extension cannot reach it and neither can a test; the parts worth
 * testing live in `capture-page.ts` and are exercised there with a scripted
 * connection.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = dirname(HERE)
const FIXTURES_DIR = join(PACKAGE_ROOT, ...FIXTURES_RELATIVE.split("/"))

const USAGE = `Capture one open page into a fixture the driver replays offline.

  bun apps/extension/tools/capture-fixture.ts --site <name> [options]

  --site <name>     the application to record, used as the directory
  --match <text>    choose the page whose URL contains this text
  --name <label>    the page within the site (default: application)
  --port <number>   the browser's debugging port (default: 9222)
  --out <path>      write here instead of test/fixtures
  --dry-run         print what was read and write nothing

Chrome needs to be started with the port open, on a profile of its own:

  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
    --remote-debugging-port=9222 --user-data-dir=/tmp/dom-agent-capture

Then open the application page, fill nothing, and run this.`

type Options = {
  site: string
  match: string | null
  name: string
  port: number
  out: string | null
  dryRun: boolean
}

function parseArgs(argv: string[]): Options | null {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    return index >= 0 ? (argv[index + 1] ?? null) : null
  }
  const site = value("--site")
  if (!site) return null
  const port = Number(value("--port") ?? 9222)
  if (!Number.isInteger(port) || port <= 0) return null
  return {
    site,
    match: value("--match"),
    name: value("--name") ?? "application",
    port,
    out: value("--out"),
    dryRun: argv.includes("--dry-run"),
  }
}

/** The version the recording is stamped with, taken from the shipped manifest. */
function extensionVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "manifest.json"), "utf8")
  )
  const version = (manifest as { version?: unknown }).version
  return typeof version === "string" && version ? version : "unknown"
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    return 0
  }
  const options = parseArgs(argv)
  if (!options) {
    console.error(USAGE)
    return 2
  }

  const targets = await listTargets(options.port)
  const page = pickPageTarget(targets, options.match)
  if (!page.webSocketDebuggerUrl)
    throw new Error(`${page.url} exposes no debugging websocket`)

  const connection = await connectCdp(page.webSocketDebuggerUrl)
  try {
    const fixture = await capturePage({
      connection,
      site: options.site,
      url: page.url,
      name: options.name,
      extensionVersion: extensionVersion(),
      log: (line) => console.error(`  ${line}`),
    })

    const relative = fixturePath({
      site: options.site,
      name: options.name,
      capturedAt: fixture.capture.capturedAt,
    })
    const target = options.out
      ? resolve(options.out)
      : join(FIXTURES_DIR, relative)
    const body = `${JSON.stringify(fixture, null, 2)}\n`

    console.log(describeFixture(fixture))
    if (options.dryRun) {
      console.log(`  not written (--dry-run); ${body.length} bytes as recorded`)
      return 0
    }

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
    // Read back through the same decoder a test uses, because a fixture that
    // cannot be loaded is worse than no fixture: it looks like evidence.
    const decoded = decodeFixture(JSON.parse(readFileSync(target, "utf8")))
    if (!decoded.ok)
      throw new Error(`the recording did not load back: ${decoded.problem}`)
    console.log(`  wrote ${target} (${body.length} bytes)`)
    return 0
  } finally {
    connection.close()
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
