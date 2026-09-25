/**
 * Checks the Supabase adapters against the real schema.
 *
 * Run with `bun run db:check` while the local stack is up. It is deliberately
 * not part of `bun run test`: like `db:test`, it needs Docker and a running
 * database, and the unit suites must stay runnable without either.
 *
 * The pgTAP suites in supabase/tests prove the SQL is right. This proves the
 * TypeScript above it agrees with that SQL: a mistyped column or a renamed key
 * fails here rather than the first time somebody clicks the button.
 *
 * It signs its own JWTs rather than going through Google, because sign-in is
 * OAuth-only and there is no password to script. The values below are the fixed
 * ones every local Supabase stack prints; they are not secrets and they are
 * worthless against anything but 127.0.0.1.
 */
import { createClient } from "@supabase/supabase-js"
import {
  AppError,
  matchDocument,
  matchTokens,
  tokenize,
} from "@workspace/resume-core"
import { StubJobParser, StubResumeTailor } from "@workspace/resume-core/testing"

import { createServices, supabasePorts } from "@/server/container"

const URL_ = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long"

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

async function mint(sub: string): Promise<string> {
  const enc = new TextEncoder()
  const header = b64(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))
  const payload = b64(
    enc.encode(
      JSON.stringify({
        sub,
        role: "authenticated",
        aud: "authenticated",
        iss: `${URL_}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    )
  )
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${header}.${payload}`)
  )
  return `${header}.${payload}.${b64(new Uint8Array(sig))}`
}

let databaseRequests = 0
async function clientFor(userId: string) {
  const token = await mint(userId)
  return createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (...args: Parameters<typeof fetch>) => {
        databaseRequests += 1
        return fetch(...args)
      },
    },
  })
}

/**
 * Created through the auth admin API rather than psql, so the script needs no
 * database client of its own. This is the one place a service-role key is used,
 * and it never leaves this file or reaches the application.
 */
async function seedUsers(): Promise<void> {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!service) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required to create the two fixture users. Run:\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep '^SERVICE_ROLE_KEY' | cut -d'\"' -f2) bun run db:check"
    )
  }
  const admin = createClient(URL_, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const [id, email] of [
    [USER_A, "adapter-check-a@example.test"],
    [USER_B, "adapter-check-b@example.test"],
  ] as const) {
    const { error } = await admin.auth.admin.createUser({
      id,
      email,
      email_confirm: true,
    })
    // Already there from a previous run is exactly what we want.
    if (error && !/already/i.test(error.message)) throw error
  }
}

let failures = 0
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok    ${name}`)
  else {
    failures += 1
    console.log(`  FAIL  ${name} ${detail}`)
  }
}

const USER_A = "aa000000-0000-4000-8000-00000000000a"
const USER_B = "bb000000-0000-4000-8000-00000000000b"

await seedUsers()

const dbA = await clientFor(USER_A)
const dbB = await clientFor(USER_B)
const a = createServices(supabasePorts(dbA, USER_A))
const b = createServices(supabasePorts(dbB, USER_B))

console.log("resumes")
const created = await a.resumes.create({ title: "Adapter check" })
check("create returns a summary", created.title === "Adapter check")

const record = await a.resumes.get(created.id)
check("get returns the record", record.id === created.id)
check("revision starts at 1", record.revision === 1)
check("template defaults to lisbon", record.templateId === "lisbon")
check("subtitle is populated", record.subtitle.length > 0)

const list = await a.resumes.list()
check(
  "list includes it",
  list.some((r) => r.id === created.id)
)

const edited = structuredClone(record.data)
edited.basics.name = "Adapter Check"
const head = await a.resumes.update({
  id: created.id,
  data: edited,
  expectedRevision: record.revision,
})
check(
  "update bumps revision",
  head.revision === record.revision + 1,
  `got ${head.revision}`
)

let conflicted = false
try {
  await a.resumes.update({
    id: created.id,
    data: edited,
    expectedRevision: record.revision,
  })
} catch (error) {
  conflicted = error instanceof AppError && error.code === "CONFLICT"
}
check("a stale revision is a CONFLICT", conflicted)

const found = await a.resumes.search("Adapter Check")
check(
  "search finds the edited document",
  found.groups.some((group) => group.resume.id === created.id)
)

await a.resumes.rename(created.id, "Renamed by check")
const afterRename = await a.resumes.get(created.id)
check("rename leaves revision alone", afterRename.revision === head.revision)
check("rename took effect", afterRename.title === "Renamed by check")

await a.resumes.setTemplate(created.id, "meridian", {
  pageSize: "A4",
  fontScale: 1,
})
const afterTemplate = await a.resumes.get(created.id)
check("setTemplate persists", afterTemplate.templateId === "meridian")
check(
  "setTemplate leaves revision alone",
  afterTemplate.revision === head.revision
)

console.log("versions")
const v1 = await a.versions.snapshot(created.id, { createdBy: "user" })
check("first version is v1", v1.versionNo === 1, `got ${v1.versionNo}`)

const again = await a.versions.snapshot(created.id, { createdBy: "user" })
check("an unchanged snapshot dedupes", again.id === v1.id)

const moved = structuredClone(afterTemplate.data)
moved.basics.name = "Second"
await a.resumes.update({ id: created.id, data: moved })
const v2 = await a.versions.snapshot(created.id, {
  createdBy: "user",
  label: "Second",
})
check("second version is v2", v2.versionNo === 2, `got ${v2.versionNo}`)

const restored = await a.versions.restore(created.id, v1.id)
check(
  "restore returns the old content",
  restored.head.basics.name === "Adapter Check"
)
check("restore is labelled", restored.version.label === "Restored from v1")
const versions = await a.versions.list(created.id)
check(
  "history has three rows newest first",
  versions.length === 3 && versions[0]?.versionNo === 3
)

console.log("suggestions")
const conversation = await a.memory.openConversation(created.id)
check("conversation is created", conversation.id.length > 0)
const same = await a.memory.openConversation(created.id)
check("conversation is reused", same.id === conversation.id)

const current = await a.resumes.get(created.id)
const bullet = current.data.sections
  .flatMap((s) => s.items)
  .flatMap((i) => ("bullets" in i ? i.bullets : []))[0]
if (!bullet) throw new Error("starter fixture has no bullets")

const run = await a.runs.start({
  conversationId: conversation.id,
  resumeId: created.id,
  hintSkillId: "bullet_rewrite",
  model: "demo",
  input: {},
})
check("run is created", run.resumeId === created.id)
check("run snapshots the head first", run.resumeVersionId !== null)
check("a fresh run has no plan yet", run.plan === null)
check(
  "a running run blocks a second",
  await a.runs
    .start({
      conversationId: conversation.id,
      resumeId: created.id,
      hintSkillId: "bullet_rewrite",
      model: "demo",
      input: {},
    })
    .then(
      () => false,
      (error) => error instanceof AppError && error.code === "CONFLICT"
    )
)
check(
  "the hourly count sees the run",
  await a.runs.assertWithinHourlyLimit(1).then(
    () => false,
    (error) => error instanceof AppError && error.code === "RATE_LIMITED"
  )
)

const saved = await a.suggestions.persistProposal(run.id, [
  {
    op: "replace_text",
    skillId: "bullet_rewrite",
    targetNodeId: bullet.id,
    field: "text",
    before: bullet.text,
    after: `${bullet.text} Checked.`,
    reason: "Adapter check",
  },
])
check("suggestion is persisted with an ordinal", saved[0]?.ordinal === 0)

const decided = await a.suggestions.decide({
  runId: run.id,
  decisions: [{ suggestionId: saved[0]?.id ?? "", status: "accepted" }],
})
check("accepting reports accepted", decided.results[0]?.status === "accepted")
check(
  "accepting creates a version",
  decided.version?.label === "AI suggestions accepted"
)
check("accepting moves the token", decided.revision > current.revision)
check(
  "accepting applied the patch",
  JSON.stringify(decided.head).includes("Checked.")
)
await a.runs.finish(run.id, {
  status: "completed",
  inputTokens: 10,
  outputTokens: 5,
  latencyMs: 100,
})
check(
  "a finished run no longer blocks",
  (await a.runs.findRunning(conversation.id)) === null
)

console.log("messages and memory")
const userMessage = await a.memory.record({
  conversationId: conversation.id,
  role: "user",
  parts: [{ type: "text", text: "Tighten this" }],
  agentRunId: run.id,
  metadata: { hintSkillId: "bullet_rewrite" },
})
check("message gets a seq", userMessage.seq > 0)
const context = await a.memory.buildContext(conversation.id)
check("window holds the message", context.messages[0]?.id === userMessage.id)
check("no summary yet", context.summaryText === null)
const memoryService = a.memory
const consolidated = await memoryService.maybeConsolidate(conversation.id)
check("below threshold is skipped", consolidated === "skipped")

console.log("skills")
const emptyOverlay = await a.skills.listOverlay()
// Live rows, not all rows: a previous run of this script leaves soft-deleted
// ones behind on purpose, and the overlay is meant to keep them.
check(
  "there is no live custom skill yet",
  !emptyOverlay.custom.some((row) => !row.deletedAt)
)

const skillInput = {
  // Deliberately not the column default: the round trip has to prove the
  // value is written, not that the default filled it in.
  category: "interview" as const,
  name: "Adapter skill",
  description: "Make sentences shorter.",
  whenToUse: "When the adapter check runs.",
  notFor: "Anything real.",
  starter: "Run the check.",
  body: "Confirm the column types line up with the domain.",
}
const written = await a.skills.create(skillInput)
check("create returns a usr_ id", written.id.startsWith("usr_"))
check("category round-trips", written.category === "interview")
check("description round-trips", written.description === skillInput.description)
check("optional fields round-trip", written.notFor === skillInput.notFor)
check("createdAt round-trips", written.createdAt.length > 0)
check(
  "get returns the body",
  (await a.skills.get(written.id)).body === skillInput.body
)

const editedSkill = await a.skills.update(written.id, {
  ...skillInput,
  category: "editor",
  name: "Renamed skill",
  whenToUse: undefined,
  notFor: undefined,
  starter: undefined,
})
check("update writes the record", editedSkill?.name === "Renamed skill")
check("update moves the category", editedSkill?.category === "editor")
// An omitted optional is null in the column and absent in the domain, which
// is what tells the chip there is no starter to write.
check("update clears an omitted optional", editedSkill?.notFor === undefined)
check("update clears when to use", editedSkill.whenToUse === undefined)
check(
  "the row counts as live",
  (await a.skills.listOverlay()).custom.some(
    (row) => row.id === written.id && !row.deletedAt
  )
)

await a.skills.setDisabled("bullet_rewrite", true)
check(
  "a built-in id can be switched off",
  (await a.skills.listOverlay()).disabledIds.includes("bullet_rewrite")
)
await a.skills.setDisabled("bullet_rewrite", false)
check(
  "switching it back on removes the row",
  !(await a.skills.listOverlay()).disabledIds.includes("bullet_rewrite")
)

await a.skills.remove(written.id)
const deletedRow = (await a.skills.listOverlay()).custom.find(
  (row) => row.id === written.id
)
check("a removed skill keeps its row", deletedRow !== undefined)
check("and carries a deletedAt", Boolean(deletedRow?.deletedAt))
let removedGone = false
try {
  await a.skills.get(written.id)
} catch (error) {
  removedGone = error instanceof AppError && error.code === "NOT_FOUND"
}
check("a removed skill is gone from the editor", removedGone)

console.log("isolation")
check(
  "B cannot list A's resume",
  !(await b.resumes.list()).some((r) => r.id === created.id)
)
check(
  "B cannot search A's resume",
  (await b.resumes.search("Adapter Check")).groups.length === 0
)
let notFound = false
try {
  await b.resumes.get(created.id)
} catch (error) {
  notFound = error instanceof AppError && error.code === "NOT_FOUND"
}
check("B gets NOT_FOUND, not a 403", notFound)
check(
  "B cannot read a skill A wrote",
  (await b.skills.listOverlay()).custom.every((row) => row.id !== written.id)
)
check(
  "B's own disabled list does not see A's toggles",
  !(await b.skills.listOverlay()).disabledIds.includes("bullet_rewrite")
)

console.log("durable tailoring")
const operationPorts = supabasePorts(dbA, USER_A, {
  jobParser: new StubJobParser(),
  resumeTailor: new StubResumeTailor(),
})
const durable = createServices(operationPorts)
const identity = {
  platform: "linkedin",
  externalJobId: String(Date.now()),
} satisfies import("@workspace/resume-core").JobIdentity
const admission = {
  ...identity,
  sourceResumeId: created.id,
  sourceUrl: `https://www.linkedin.com/jobs/view/${identity.externalJobId}`,
  jobText:
    "An engineering role building useful products with a collaborative team. ".repeat(
      8
    ),
  idempotencyKey: crypto.randomUUID(),
}
const simultaneous = await Promise.all([
  durable.operations.admit(admission),
  durable.operations.admit({
    ...admission,
    idempotencyKey: crypto.randomUUID(),
  }),
])
const initial = simultaneous[0]
if (initial?.kind !== "bound") throw new Error("Admission did not bind")
check(
  "concurrent admission creates one resume",
  simultaneous.every(
    (r) => r.kind === "bound" && r.resumeId === initial.resumeId
  )
)
check(
  "other user sees no binding",
  (await b.operations.lookup(identity)).kind === "none"
)
await durable.operations.parse(initial.operation.id)
await durable.operations.generate(initial.operation.id)
await durable.operations.cancel(initial.operation.id)
await durable.operations.complete(initial.operation.id)
check(
  "cancelled output cannot commit",
  (await durable.operations.get(initial.operation.id)).status === "cancelled"
)
check(
  "cancel purges staged content",
  !(await operationPorts.operations.hasArtifact(initial.operation.id))
)
const retryInput = {
  ...identity,
  expectedOperationId: initial.operation.id,
  idempotencyKey: crypto.randomUUID(),
}
const retries = await Promise.all([
  durable.operations.retry(retryInput),
  durable.operations.retry(retryInput),
])
const retried = retries[0]
if (retried?.kind !== "bound") throw new Error("Retry did not bind")
check(
  "concurrent retry reuses one attempt",
  retries.every(
    (r) => r.kind === "bound" && r.operation.id === retried.operation.id
  )
)
check("retry keeps clone", retried.resumeId === initial.resumeId)
await durable.operations.parse(retried.operation.id)
await durable.operations.generate(retried.operation.id)
const copy = await durable.resumes.get(retried.resumeId)
copy.data.basics.name = "Manual edit during generation"
await durable.resumes.update({
  id: copy.id,
  data: copy.data,
  expectedRevision: copy.revision,
})
await durable.operations.complete(retried.operation.id)
check(
  "revision guard preserves concurrent manual edit",
  (await durable.operations.get(retried.operation.id)).errorClass === "conflict"
)
const recovery = await durable.operations.retry({
  ...identity,
  expectedOperationId: retried.operation.id,
  idempotencyKey: crypto.randomUUID(),
})
if (recovery.kind !== "bound") throw new Error("Missing recovery")
await durable.operations.parse(recovery.operation.id)
await durable.operations.generate(recovery.operation.id)
await durable.operations.complete(recovery.operation.id)
check(
  "recovery commits a version and readiness",
  (await durable.operations.lookup(identity)).kind === "bound" &&
    (await durable.operations.get(recovery.operation.id)).status === "succeeded"
)
check(
  "success purges staged content",
  !(await operationPorts.operations.hasArtifact(recovery.operation.id))
)
await durable.resumes.remove(recovery.resumeId)
check(
  "deleted binding reads as none",
  (await durable.operations.lookup(identity)).kind === "none"
)
const replacement = await durable.operations.admit({
  ...admission,
  idempotencyKey: crypto.randomUUID(),
})
check(
  "deleted copy is replaced",
  replacement.kind === "bound" && replacement.resumeId !== initial.resumeId
)
if (replacement.kind === "bound") {
  await durable.operations.cancel(replacement.operation.id)
  await durable.resumes.remove(replacement.resumeId)
}

console.log("legacy job adoption")
const legacyIdentity = {
  platform: "linkedin",
  externalJobId: String(Date.now() + 1),
} satisfies import("@workspace/resume-core").JobIdentity
const legacy = await durable.tailor.tailorFromJob({
  sourceResumeId: created.id,
  sourceUrl: `https://www.linkedin.com/jobs/view/${legacyIdentity.externalJobId}`,
  jobText: admission.jobText,
})
const adopted = await durable.operations.lookup(legacyIdentity)
check(
  "legacy completed run with a version is adopted",
  adopted.kind === "bound" &&
    adopted.resumeId === legacy.resume.id &&
    adopted.operation.status === "succeeded" &&
    adopted.operation.legacy
)
await durable.resumes.remove(legacy.resume.id)
check(
  "deleted legacy selection does not return to older associations",
  (await durable.operations.lookup(legacyIdentity)).kind === "none"
)

console.log("adopted in-flight creation")
let startWriter = () => {}
let releaseWriter = () => {}
const writerStarted = new Promise<void>((resolve) => {
  startWriter = resolve
})
const writerReleased = new Promise<void>((resolve) => {
  releaseWriter = resolve
})
const blockedWriter: import("@workspace/resume-core").ResumeTailor = {
  async tailor() {
    startWriter()
    await writerReleased
    return { parsed: { basics: {}, sections: [] }, model: "stub" }
  },
}
const pendingServices = createServices(
  supabasePorts(dbA, USER_A, {
    jobParser: new StubJobParser(),
    resumeTailor: blockedWriter,
  })
)
const pendingIdentity = {
  platform: "linkedin",
  externalJobId: String(Date.now() + 2),
} satisfies import("@workspace/resume-core").JobIdentity
const webCreation = pendingServices.tailor.tailorFromJob({
  sourceResumeId: created.id,
  sourceUrl: `https://www.linkedin.com/jobs/view/${pendingIdentity.externalJobId}`,
  jobText: admission.jobText,
})
await writerStarted
const pendingLegacy = await durable.operations.lookup(pendingIdentity)
if (pendingLegacy.kind !== "bound") throw new Error("Missing legacy run")
check(
  "running legacy work is reported running",
  pendingLegacy.operation.status === "running"
)
await durable.operations.cancel(pendingLegacy.operation.id)
releaseWriter()
const stopped = await webCreation
check(
  "late synchronous writer honors extension cancellation",
  !stopped.tailored &&
    (await durable.operations.get(pendingLegacy.operation.id)).status ===
      "cancelled"
)
const beforeLookup = databaseRequests
await durable.operations.lookup(pendingIdentity)
check(
  "bound terminal lookup uses one database request",
  databaseRequests - beforeLookup === 1
)
await durable.resumes.remove(stopped.resume.id)

await a.resumes.remove(created.id)
let goneAfterDelete = false
try {
  await a.resumes.get(created.id)
} catch (error) {
  goneAfterDelete = error instanceof AppError && error.code === "NOT_FOUND"
}
check("a soft-deleted resume reads as gone", goneAfterDelete)

console.log("pagination and indexed search")
const fixtures: string[] = []
try {
  for (let i = 0; i < 65; i++) {
    const fixture = await a.resumes.create({
      title: i % 9 === 0 ? "Typescript role" : `Fixture ${i}`,
      document: {
        schemaVersion: 1,
        basics: {
          id: "basics",
          name: i % 3 === 0 ? "Kelvin" : "TypeScript",
          summary: i % 5 === 0 ? "platform % data" : "unrelated",
          links: [],
        },
        sections: [],
      },
    })
    fixtures.push(fixture.id)
  }
  const first = await a.resumes.page()
  const ids = first.items.map((row) => row.id)
  let cursor = first.nextCursor
  while (cursor) {
    const next = await a.resumes.page({ cursor })
    check(
      "continuation is bounded without another total",
      next.items.length <= 30 && next.total === undefined
    )
    ids.push(...next.items.map((row) => row.id))
    cursor = next.nextCursor
  }
  check(
    "real PostgREST cursor visits every row once",
    ids.length === new Set(ids).size &&
      ids.length === first.total &&
      fixtures.every((id) => ids.includes(id))
  )
  check(
    "summary by ID matches the page",
    (await a.resumes.summary(first.items[0]?.id ?? "")).id ===
      first.items[0]?.id
  )
  check(
    "other account cannot page these fixtures",
    !(await b.resumes.page()).items.some((row) => fixtures.includes(row.id))
  )
  const all = await supabasePorts(dbA, USER_A).resumes.listRecords()
  for (const [index, q] of [
    "typescript platform",
    "kelvin",
    "pl",
    "% data",
    "平台",
    "typescript absent",
  ].entries()) {
    const tokens = tokenize(q)
    const expected = all
      .map((record) => {
        const { id, title, subtitle, templateId, updatedAt } = record
        const hits = matchDocument(record.data, tokens)
        return {
          resume: { id, title, subtitle, templateId, updatedAt },
          titleRanges: matchTokens(title, tokens),
          hits: hits.slice(0, 3),
          totalHits: hits.length,
        }
      })
      .filter((group) => group.hits.length || group.titleRanges.length)
      .sort(
        (left, right) =>
          Number(Boolean(right.titleRanges.length)) -
            Number(Boolean(left.titleRanges.length)) ||
          right.resume.updatedAt.localeCompare(left.resume.updatedAt) ||
          right.resume.id.localeCompare(left.resume.id)
      )
      .slice(0, 20)
    const actual = await a.resumes.search(q)
    check(
      `indexed search parity ${index + 1}, including highlights`,
      JSON.stringify(actual.groups) === JSON.stringify(expected)
    )
  }
} finally {
  for (const id of fixtures) await a.resumes.remove(id)
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
