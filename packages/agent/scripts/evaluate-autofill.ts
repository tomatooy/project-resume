import { readFile } from "node:fs/promises"
import { z } from "zod"
import { createTypeSafeClient } from "@workspace/typesafe"
import { createJevDecider } from "../src/autofill/jev-decider"

const FixtureSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,100}$/),
  approved: z.literal(true),
  source: z.enum(["synthetic", "approved_capture"]),
  stratum: z.enum([
    "contact",
    "record",
    "dropdown",
    "multiselect",
    "missing",
    "ambiguous",
    "negative",
    "dynamic_failure",
  ]),
  language: z.enum(["en", "es", "fr", "de", "zh", "other"]),
  adapterId: z.enum(["native-v1", "aria-combobox-v1"]),
  question: z.strictObject({
    id: z.string().max(150),
    kind: z.enum(["semantic", "record", "option"]),
    instructions: z.string().max(4000),
    state: z.string().max(20000),
    candidates: z.record(z.string().max(150), z.string().max(1000)),
  }),
  expected: z.string().max(150),
  allowAutomatic: z.boolean(),
})
const inputPath = process.argv[2]
if (
  process.env.AUTOFILL_EVAL_OPT_IN !== "1" ||
  !inputPath ||
  !process.env.TYPESAFE_API_KEY
) {
  console.error(
    "Opt in with AUTOFILL_EVAL_OPT_IN=1, set TYPESAFE_API_KEY, and pass an approved fixture JSON file. This sends fixture content to TypeSafe and can incur costs."
  )
  process.exit(1)
}
// Validation errors can contain fixture content, so only fixed errors leave this script.
try {
  const fixtures = z
    .array(FixtureSchema)
    .min(1)
    .max(10000)
    .parse(JSON.parse(await readFile(inputPath, "utf8")))
  if (
    new Set(fixtures.map((f) => f.id)).size !== fixtures.length ||
    fixtures.some((f) => !(f.expected in f.question.candidates))
  )
    throw new Error("Invalid fixture set")
  const decider = createJevDecider(
    createTypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY })
  )
  const groups = new Map<
    string,
    {
      n: number
      correct: number
      automatic: number
      automaticCorrect: number
      reviewed: number
      attempts: number
      latency: number[]
    }
  >()
  for (const fixture of fixtures) {
    const key = `${fixture.question.kind}/${fixture.stratum}/${fixture.language}/${fixture.adapterId}`
    const group = groups.get(key) ?? {
      n: 0,
      correct: 0,
      automatic: 0,
      automaticCorrect: 0,
      reviewed: 0,
      attempts: 0,
      latency: [],
    }
    const started = Date.now()
    const answers = await decider
      .decide([fixture.question], {
        signal: AbortSignal.timeout(15000),
        beforeAttempt: async () => {
          group.attempts++
        },
      })
      .catch(() => [])
    const answer = answers[0]
    const correct = Boolean(
      answer && !answer.tied && answer.choice === fixture.expected
    )
    // A trial threshold is evidence to review, never a production policy update.
    const automatic = Boolean(
      fixture.allowAutomatic &&
        answer &&
        !answer.tied &&
        answer.probability >= 0.99 &&
        answer.margin >= 0.2 &&
        !["no_match", "ambiguous", "unmapped"].includes(answer.choice)
    )
    group.n++
    group.correct += Number(correct)
    group.automatic += Number(automatic)
    group.automaticCorrect += Number(automatic && correct)
    group.reviewed += Number(!automatic)
    group.latency.push(Date.now() - started)
    groups.set(key, group)
  }
  const report = [...groups].map(([category, g]) => {
    const sorted = g.latency.sort((a, b) => a - b)
    const p = g.automatic ? g.automaticCorrect / g.automatic : 0
    const z2 = 1.96 ** 2
    const center = g.automatic
      ? (p + z2 / (2 * g.automatic)) / (1 + z2 / g.automatic)
      : 0
    const width = g.automatic
      ? (1.96 *
          Math.sqrt(
            (p * (1 - p)) / g.automatic + z2 / (4 * g.automatic ** 2)
          )) /
        (1 + z2 / g.automatic)
      : 0
    return {
      category,
      n: g.n,
      correct: g.correct,
      automatic: g.automatic,
      automaticCorrect: g.automaticCorrect,
      reviewed: g.reviewed,
      attempts: g.attempts,
      precision: g.automatic ? p : null,
      precision95: g.automatic ? [center - width, center + width] : null,
      p50ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    }
  })
  console.log(
    JSON.stringify(
      {
        model: "jev-1.13.0",
        questionVersion: "autofill-v1",
        fields: fixtures.length,
        dropdowns: fixtures.filter((f) =>
          ["dropdown", "multiselect"].includes(f.stratum)
        ).length,
        adverse: fixtures.filter((f) =>
          ["missing", "ambiguous", "negative", "dynamic_failure"].includes(
            f.stratum
          )
        ).length,
        productionPolicyChanged: false,
        report,
      },
      null,
      2
    )
  )
} catch {
  console.error(
    "Evaluation failed. Check fixture approval, schema, and provider configuration. No fixture content was logged."
  )
  process.exitCode = 1
}
