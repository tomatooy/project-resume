# Structured Agent Turns: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user reading the assistant panel sees what changed, what is missing and what to do next, and never the model's working notes.

**Architecture:** Five layers, each with one job. The provider gets a private thinking channel, and `sendReasoning: false` keeps it off the wire. One rule, "a step that called a tool wrote deliberation, not an answer", drops prose in the stream and at store time, through a single predicate module. The turn's user-facing sentence moves into the proposal as a new `summary` field, so the turn still speaks without a text channel. `compact()` carries that summary, the gaps and the follow-up question back to the model, so dropping the prose does not drop the model's memory of its own turn.

**Tech Stack:** Bun workspaces, TypeScript 6 strict, Zod v4, Vercel AI SDK v7 (`streamText`, UI message chunks), DeepSeek V4, vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-09-10-agent-system-design.md`, section 6. That spec is the whole agent system, including the model-selected skills redo, which is not part of this plan; this plan ships the output contract against today's single-skill loop. Task 6 lands the shipped behaviour in `docs/specs/front-end.md` section 7 and `docs/specs/back-end.md`.

## Global Constraints

- Package manager is **Bun**. Never `npm`, `pnpm` or `yarn`. Never run `bun run build`.
- Formatting and linting is **Biome only**, through `bun run format` and `bun run check`. Never invoke a bare `biome` binary.
- **No em dashes** anywhere: code, comments, UI copy, commit messages, docs. Use a comma, colon, parentheses, or two sentences.
- **No browser automation** and no dev server. Verify with `bun run typecheck`, `bun run check`, and `bun run test`. After a UI change, say what to look at and stop.
- **Never `any`.** Avoid `as` and `unknown` casts. Derive types from Zod schemas with `z.infer`.
- **Privacy:** resume content, message content, patch text and job posting text never reach a log, trace or analytics call. Logs carry ids, counts, durations and error classes only.
- The `packages/agent` entry point is curated by hand. Add an export only when a consumer outside the package needs it; the predicate in Task 2 is internal.
- Commit after every task.

## Test Policy

`packages/resume-core`, `packages/agent`, `apps/web` and `packages/resume-schema` carry vitest suites. This plan touches the first two and one web component that has no suite, so the guarantee is proved where it can be: the predicate and the transform in `packages/agent/test/visible.test.ts`, the wire in `packages/agent/test/turn.test.ts`, and the store and memory line in `packages/agent/test/messages.test.ts`.

Run one package with `bun run --filter @workspace/agent test`.

## The Contract

Settled in four rounds of review. The executor does not re-litigate it; the tasks below implement exactly this.

- A turn shows: the status line, then the summary sentence, then the cards with their per-patch reasons, then gaps, then the follow-up question, then the fit chip. No model prose.
- `sendReasoning: false` always.
- Thinking on for `smart`, off for `fast`, never sent to the browser.
- Text from any step that called a tool is dropped, on the wire and at persist time.
- A run that made zero `propose_patches` calls keeps its last text part, so a refusal or a step-budget exhaustion still answers.
- `summary` is required in the `propose_patches` input and optional on `ProposeOutputSchema`, because rows stored before it existed still have to parse.
- `compact()` replays `[proposed N patches. <summary>. Missing: <up to 3 gaps>. Asked: <question>]`, clipped.
- The status line is derived from the skill id and nothing else.

## File Structure

**`packages/resume-core`**

- `src/domain/chat.ts`: `ProposeOutputSchema` gains an optional `summary`.

**`packages/agent`**

- `src/visible.ts` (new): `visibleParts` and `hideToolStepText`, the one rule in both shapes.
- `src/messages.ts`: `fromUIMessage` runs the rule before storing; `compact` carries summary, gaps and question.
- `src/turn.ts`: `startTurn` pipes the UI stream through the rule and sets `sendReasoning: false`.
- `src/tools.ts`: the proposal input requires `summary`, the output carries it.
- `src/models.ts`: thinking per tier.
- `src/prompts/base.ts`: the model is told where its words go.
- `src/skills/bullet-rewrite.ts`: the summary sentence in the fragment.
- `test/visible.test.ts` (new), `test/turn.test.ts`, `test/turn-loop.test.ts`, `test/messages.test.ts`, `test/models.test.ts`, `test/mock.ts`.

**`apps/web`**

- `src/features/chat/Transcript.tsx`: the summary bubble, the skill-derived status line.

**Docs**

- `docs/specs/front-end.md` section 7, `docs/specs/back-end.md` section on models.

---

### Task 1: `summary` on the proposal contract

The turn's one sentence has to live in the proposal, because after Task 2 there is no text channel left to carry it.

**Files:**

- Modify: `packages/resume-core/src/domain/chat.ts`
- Modify: `packages/agent/src/tools.ts`
- Test: `packages/agent/test/turn-loop.test.ts`, `packages/agent/test/messages.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ProposeOutputSchema.summary: string | undefined`; the `propose_patches` input requires `summary: string` of at most 300 characters.

- [ ] **Step 1: Give every proposal in the tests a summary**

In `packages/agent/test/turn-loop.test.ts`, the helper currently sends `{ patches }`, which becomes invalid input once the field is required. Change it once, so every existing test keeps testing what it was written to test:

```ts
function propose(patches: ResumePatch[], id = "call-1") {
  return toolCallStream(
    "propose_patches",
    { patches, summary: "Tightened the selected bullet." },
    id
  )
}
```

In `packages/agent/test/messages.test.ts`, add a `summary` to the shared `proposeOutput` fixture so stored test data looks like real data.

- [ ] **Step 2: Write the failing tests**

Add to the `runSkill` describe in `turn-loop.test.ts`:

```ts
  it("carries the summary, gaps and question through the proposal", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStream("propose_patches", {
          patches: [good],
          summary: "Rewrote the first bullet to lead with the outcome.",
          gaps: ["team size on the migration bullet"],
          followUpQuestion: "How large was the team?",
        }),
      ],
    })
    const { result } = start(model)
    await result.consumeStream()

    const steps = await result.steps
    expect(steps[0]?.toolResults[0]?.output).toMatchObject({
      summary: "Rewrote the first bullet to lead with the outcome.",
      gaps: ["team size on the migration bullet"],
      followUpQuestion: "How large was the team?",
    })
  })

  it("refuses a proposal without a summary and gives the model the step to fix it", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () =>
        toolCallStream("propose_patches", { patches: [good] }),
    })
    const { result, persist } = start(model)
    await result.consumeStream()

    // The field is required, so the tool never runs and the model is handed
    // the schema error instead. The step budget is what ends the loop.
    expect(persist).not.toHaveBeenCalled()
    expect(model.doStreamCalls).toHaveLength(6)
  })
```

- [ ] **Step 3: Run them and watch the first one fail**

Run: `bun run --filter @workspace/agent test turn-loop`
Expected: FAIL on `summary` being `undefined` in the first test. The second passes already, which is the point: it is the guard that the field is enforced.

- [ ] **Step 4: Add the field to the stored schema**

In `packages/resume-core/src/domain/chat.ts`, `ProposeOutputSchema` gains one member:

```ts
export const ProposeOutputSchema = z.object({
  runId: z.string(),
  suggestions: z.array(ProposedSuggestionSchema),
  rejected: z.array(RejectedPatchSchema),
  gaps: z.array(z.string()),
  followUpQuestion: z.string().optional(),
  /**
   * The one sentence the turn shows above its cards. Optional here because a
   * row stored before it existed still has to parse; the tool requires it of
   * the model.
   */
  summary: z.string().optional(),
})
```

- [ ] **Step 5: Require it on the tool and pass it through**

In `packages/agent/src/tools.ts`, the input schema gains `summary: z.string().min(1).max(300)`, the description names it, and `execute` copies it onto the output the way `followUpQuestion` already is:

```ts
    description:
      "Submit the final list of patches. Call once at the end, after any check_fit calls. `summary` is the one sentence the user reads above the cards; `gaps` names what is missing, and `followUpQuestion` asks for the single most useful one.",
    inputSchema: z.object({
      patches: z.array(z.unknown()).max(50),
      gaps: z.array(z.string().max(300)).max(20).optional(),
      followUpQuestion: z.string().max(500).optional(),
      summary: z.string().min(1).max(300),
    }),
```

```ts
      if (summary.trim().length > 0) output.summary = summary
      if (followUpQuestion) output.followUpQuestion = followUpQuestion
```

The `output` literal itself stays as it is, so an empty or missing summary leaves the key off rather than storing `undefined`.

- [ ] **Step 6: Verify**

```bash
bun run typecheck && bun run check && bun run --filter @workspace/agent test && bun run --filter @workspace/resume-core test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Carry the turn's summary on the proposal"
```

---

### Task 2: The visibility rule

One rule, two shapes: a whole message at store time, and a chunk stream on the wire. Keeping them in one module is what stops the live view and the reloaded transcript from disagreeing.

**Files:**

- Create: `packages/agent/src/visible.ts`
- Modify: `packages/agent/src/messages.ts`
- Modify: `packages/agent/src/turn.ts`
- Test: `packages/agent/test/visible.test.ts` (new), `packages/agent/test/turn.test.ts`, `packages/agent/test/mock.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `visibleParts(parts: UIMessage["parts"]): UIMessage["parts"]` and `hideToolStepText(): TransformStream<UIMessageChunk, UIMessageChunk>`. Both stay inside `packages/agent`.

- [ ] **Step 1: Write the failing predicate tests**

Create `packages/agent/test/visible.test.ts`:

```ts
import type { UIMessage, UIMessageChunk } from "ai"
import { describe, expect, it } from "vitest"

import { hideToolStepText, visibleParts } from "../src/visible"

function text(value: string): UIMessage["parts"][number] {
  return { type: "text", text: value }
}

const proposal: UIMessage["parts"][number] = {
  type: "tool-propose_patches",
  toolCallId: "c1",
  state: "output-available",
  input: {},
  output: {
    runId: "run-1",
    suggestions: [],
    rejected: [],
    gaps: [],
  },
}

describe("visibleParts", () => {
  it("keeps no text from a run that proposed", () => {
    expect(
      visibleParts([
        { type: "step-start" },
        text("Let me think about this."),
        proposal,
        text("On reflection, here is the plan."),
      ])
    ).toEqual([{ type: "step-start" }, proposal])
  })

  it("keeps only the last text part of a run that never proposed", () => {
    expect(
      visibleParts([
        text("First I considered the wording."),
        { type: "step-start" },
        text("Which bullet do you mean?"),
      ])
    ).toEqual([{ type: "step-start" }, text("Which bullet do you mean?")])
  })

  it("leaves a tool-only turn alone", () => {
    expect(visibleParts([{ type: "step-start" }, proposal])).toEqual([
      { type: "step-start" },
      proposal,
    ])
  })
})

describe("hideToolStepText", () => {
  async function through(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    const out: UIMessageChunk[] = []
    for await (const chunk of stream.pipeThrough(hideToolStepText())) {
      out.push(chunk)
    }
    return out
  }

  const startStep: UIMessageChunk = { type: "start-step" }
  const finishStep: UIMessageChunk = { type: "finish-step" }
  const notes: UIMessageChunk[] = [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Let me think." },
    { type: "text-end", id: "t1" },
  ]

  it("drops the text of a step that called a tool", async () => {
    const out = await through([
      startStep,
      ...notes,
      { type: "tool-input-start", toolCallId: "c1", toolName: "propose_patches" },
      finishStep,
    ])
    expect(out.map((chunk) => chunk.type)).toEqual([
      "start-step",
      "tool-input-start",
      "finish-step",
    ])
  })

  it("releases the text of a step that called nothing, after the step ends", async () => {
    const out = await through([startStep, ...notes, finishStep])
    expect(out.map((chunk) => chunk.type)).toEqual([
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
    ])
  })

  it("never passes reasoning through", async () => {
    const out = await through([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "hmm" },
      { type: "reasoning-end", id: "r1" },
      startStep,
      ...notes,
      finishStep,
    ])
    expect(out.some((chunk) => chunk.type.startsWith("reasoning"))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun run --filter @workspace/agent test visible`
Expected: FAIL, cannot resolve `../src/visible`.

- [ ] **Step 3: Write the module**

Create `packages/agent/src/visible.ts`:

```ts
import { isToolUIPart, type UIMessage, type UIMessageChunk } from "ai"

type UIPart = UIMessage["parts"][number]

/**
 * What a turn is allowed to show.
 *
 * A run that proposed even once keeps no text at all: its user-facing content
 * is the proposal's `summary`, `gaps` and `followUpQuestion`, and prose on the
 * way to a tool call is deliberation. A run that never proposed keeps its last
 * text part, so a refusal or a step-budget exhaustion still answers the user
 * rather than rendering an empty turn.
 */
export function visibleParts(parts: UIPart[]): UIPart[] {
  const proposed = parts.some(
    (part) => isToolUIPart(part) && part.type === "tool-propose_patches"
  )
  if (proposed) return parts.filter((part) => part.type !== "text")

  const lastText = parts.reduce(
    (index, part, i) => (part.type === "text" ? i : index),
    -1
  )
  return parts.filter((part, i) => part.type !== "text" || i === lastText)
}

/**
 * The same rule on the wire.
 *
 * Text is held until its step ends, because only the step's end says whether a
 * tool call followed. Holding is what keeps the panel from showing a paragraph
 * and then deleting it when the call lands; the cost is that a step's last
 * paragraph arrives whole at `finish-step` instead of typing out.
 */
export function hideToolStepText(): TransformStream<
  UIMessageChunk,
  UIMessageChunk
> {
  let held: UIMessageChunk[] = []
  let called = false

  function release(
    controller: TransformStreamDefaultController<UIMessageChunk>
  ): void {
    for (const chunk of held) controller.enqueue(chunk)
    held = []
  }

  return new TransformStream({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "start-step":
          held = []
          called = false
          controller.enqueue(chunk)
          return
        case "text-start":
        case "text-delta":
        case "text-end":
          held.push(chunk)
          return
        case "tool-input-start":
          called = true
          controller.enqueue(chunk)
          return
        case "reasoning-start":
        case "reasoning-delta":
        case "reasoning-end":
        case "reasoning-file":
          return
        case "finish-step":
          if (!called) release(controller)
          held = []
          controller.enqueue(chunk)
          return
        default:
          controller.enqueue(chunk)
      }
    },
    flush(controller) {
      if (!called) release(controller)
    },
  })
}
```

- [ ] **Step 4: Run the predicate tests**

Run: `bun run --filter @workspace/agent test visible`
Expected: PASS.

- [ ] **Step 5: Apply the rule at store time**

In `packages/agent/src/messages.ts`, `fromUIMessage` runs the rule before it reduces parts:

```ts
  const parts: MessagePart[] = []
  for (const part of visibleParts(message.parts)) {
    const candidate = pick(part)
    if (candidate === null) continue
    const parsed = MessagePartSchema.safeParse(candidate)
    if (parsed.success) parts.push(parsed.data)
  }
```

Import `visibleParts` from `./visible`. Update the function's doc comment: it currently says the whitelist is what keeps unknown parts out, and the rule now also keeps deliberation out.

- [ ] **Step 6: Apply the rule on the wire**

In `packages/agent/test/mock.ts`, add a stream that does both in one step, so the test can prove the difference:

```ts
/** One model turn that writes a paragraph and then calls a tool, in one step. */
export function textThenToolStream(
  text: string,
  toolName: string,
  input: unknown,
  toolCallId = "call-1"
): LanguageModelV3StreamResult {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
    },
  ]
  return { stream: simulateReadableStream({ chunks }) }
}
```

In `packages/agent/test/turn.test.ts`, add a describe that reads the response the browser would read:

```ts
describe("startTurn", () => {
  const { resume, bullet } = fixture()
  const good = rewrite(bullet, `${bullet.text} Shipped on time.`)

  function turn(model: MockLanguageModelV3) {
    return startTurn({
      skill: skills.bullet_rewrite,
      ctx: { resume, userMessage: "Tighten this", selectedNodeId: bullet.id },
      models: testModels(model),
      runId: "run-1",
      persist: async () => [],
      memory: {
        summaryText: null,
        messages: [{ role: "user", content: "Tighten this" }],
      },
      originalMessages: [],
      metadata: { skillId: "bullet_rewrite" },
      onSettled: async () => undefined,
    })
  }

  async function chunkTypes(response: Response): Promise<string[]> {
    const body = await response.text()
    return body
      .split("\n\n")
      .map((line) => line.replace(/^data: /, ""))
      .filter((line) => line.length > 0 && line !== "[DONE]")
      .map((line) => (JSON.parse(line) as { type: string }).type)
  }

  it("never streams the notes of a step that called a tool", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        textThenToolStream(
          "Let me think about which bullet to change.",
          "propose_patches",
          { patches: [good], summary: "Tightened the selected bullet." }
        ),
      ],
    })
    const types = await chunkTypes(turn(model))
    expect(types).not.toContain("text-delta")
    expect(types).toContain("tool-input-start")
  })

  it("still streams a turn that never proposed", async () => {
    const model = new MockLanguageModelV3({
      doStream: [textStream("Which bullet do you mean?")],
    })
    const types = await chunkTypes(turn(model))
    expect(types).toContain("text-delta")
  })
})
```

Import `textThenToolStream` and `textStream` from `./mock`, `skills` from `../src/skills/index`, and `startTurn` from `../src/turn`.

- [ ] **Step 7: Run it and watch the first test fail**

Run: `bun run --filter @workspace/agent test turn.test`
Expected: FAIL, `text-delta` is in the chunk list.

- [ ] **Step 8: Pipe the stream in `startTurn`**

In `packages/agent/src/turn.ts`, replace `result.toUIMessageStreamResponse({ ... })` with a manually piped stream. `toUIMessageStream` takes the same `originalMessages`, `messageMetadata`, `onError` and `onFinish` options the response helper took, and `createUIMessageStreamResponse` does the serialising.

```ts
  const uiStream = result.toUIMessageStream({
    originalMessages: input.originalMessages,
    // Thinking is the model's own. `packages/agent/src/models.ts` turns it on
    // for the smart tier, and nothing downstream should see it.
    sendReasoning: false,
    messageMetadata: ({ part }) =>
      part.type === "start" ? input.metadata : undefined,
    onError: (error) => {
      streamError = error
      return TURN_ERROR_TEXT
    },
    onFinish: async ({ responseMessage, isAborted, outcome }) => {
      const failed = outcome.status === "failed"
      const paused =
        !isAborted && !failed && checkFitState(responseMessage) === "awaiting"

      await input.onSettled({
        status: paused
          ? "paused"
          : isAborted
            ? "cancelled"
            : failed
              ? "failed"
              : "completed",
        usage,
        message: responseMessage,
        error: failed ? (outcome.error ?? streamError) : undefined,
      })
    },
  })

  return createUIMessageStreamResponse({
    stream: uiStream.pipeThrough(hideToolStepText()),
  })
```

`responseMessage` here is the unfiltered message, which is correct: it is only used for `checkFitState` and the outcome, and the store applies the same rule in `fromUIMessage`, so what is persisted matches what was streamed.

- [ ] **Step 9: Verify**

```bash
bun run typecheck && bun run check && bun run --filter @workspace/agent test
```

Expected: PASS. Note that `checkFitState`, `startTurn`'s outcome mapping, and the paused-run behaviour are unchanged; the existing `handle-chat` tests must still pass, which is what `bun run test` at the root confirms.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Keep the model's working notes out of the turn"
```

---

### Task 3: Model memory for a turn that has no prose

Removing the prose would also remove the model's memory of its own turn, because `fromUIMessage` drops tool inputs and `compact` reduces a proposal to a count. The gaps and the question have to survive the round trip.

**Files:**

- Modify: `packages/agent/src/messages.ts`
- Test: `packages/agent/test/messages.test.ts`

**Interfaces:**

- Consumes: `ProposeOutput.summary` from Task 1.
- Produces: the `tool-propose_patches` line in `compact`.

- [ ] **Step 1: Write the failing test**

In `packages/agent/test/messages.test.ts`, extend `toModelMessages`'s describe:

```ts
  it("keeps the summary, the gaps and the question the model will be answered on", () => {
    const messages: ChatMessage[] = [
      {
        ...base,
        id: "m1",
        seq: 1,
        role: "assistant",
        parts: [
          {
            type: "tool-propose_patches",
            toolCallId: "c1",
            state: "output-available",
            output: {
              ...proposeOutput,
              summary: "Rewrote the PitchGhost bullets to lead with the scraper engine.",
              gaps: ["team size", "deploy frequency", "budget"],
              followUpQuestion: "What was the deploy frequency before and after?",
            },
          },
        ],
      },
    ]
    expect(toModelMessages(messages)).toEqual([
      {
        role: "assistant",
        content:
          "[proposed 1 patch. Rewrote the PitchGhost bullets to lead with the scraper engine. Missing: team size; deploy frequency; budget. Asked: What was the deploy frequency before and after?]",
      },
    ])
  })

  it("drops gaps past the third and clips a line that runs long", () => {
    const messages: ChatMessage[] = [
      {
        ...base,
        id: "m1",
        seq: 1,
        role: "assistant",
        parts: [
          {
            type: "tool-propose_patches",
            toolCallId: "c1",
            state: "output-available",
            output: {
              ...proposeOutput,
              summary: "x".repeat(600),
              gaps: ["one", "two", "three", "four"],
            },
          },
        ],
      },
    ]
    const [message] = toModelMessages(messages)
    const content = typeof message?.content === "string" ? message.content : ""
    expect(content).toContain("one; two; three.")
    expect(content).not.toContain("four")
    expect(content.length).toBeLessThanOrEqual(400)
    expect(content.endsWith("...]")).toBe(true)
  })
```

The first test also updates the existing compact test's expectation, since the shared fixture now carries a summary (Task 1, step 1).

- [ ] **Step 2: Run it and watch both fail**

Run: `bun run --filter @workspace/agent test messages`
Expected: FAIL, the current line is `[proposed 1 patch]`.

- [ ] **Step 3: Write the line**

In `packages/agent/src/messages.ts`, replace the `tool-propose_patches` branch of `compact`:

```ts
/** A memory line, not a transcript: enough to know what it did and asked. */
const MAX_MEMORY_LINE = 400
const MAX_MEMORY_GAPS = 3

function clip(line: string): string {
  if (line.length <= MAX_MEMORY_LINE) return line
  return `${line.slice(0, MAX_MEMORY_LINE - 4).trimEnd()}...`
}
```

```ts
    case "tool-propose_patches": {
      if (!part.output) return part.errorText ? "[propose_patches failed]" : ""
      const { suggestions, rejected, summary, gaps, followUpQuestion } =
        part.output
      const kept = suggestions.length
      const counts = `proposed ${kept} ${kept === 1 ? "patch" : "patches"}`
      const head =
        rejected.length > 0 ? `${counts}, ${rejected.length} rejected.` : `${counts}.`
      const tail = [
        summary ?? "",
        gaps.length > 0
          ? `Missing: ${gaps.slice(0, MAX_MEMORY_GAPS).join("; ")}`
          : "",
        followUpQuestion ? `Asked: ${followUpQuestion}` : "",
      ].filter((piece) => piece.length > 0)

      return clip(`[${head}${tail.length > 0 ? ` ${tail.join(" ")}` : ""}]`)
    }
```

- [ ] **Step 4: Verify**

```bash
bun run typecheck && bun run check && bun run --filter @workspace/agent test
```

Expected: PASS, including the older compact test, whose fixture summary now appears in its expected string.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Replay the proposal's summary, gaps and question to the model"
```

---

### Task 4: Prompts and tiers

The rule above makes deliberation invisible. The prompt makes the structured output good, and the tier split gives the model somewhere private to think so it stops spilling into `content`.

**Files:**

- Modify: `packages/agent/src/prompts/base.ts`
- Modify: `packages/agent/src/skills/bullet-rewrite.ts`
- Modify: `packages/agent/src/models.ts`
- Modify: `packages/agent/src/turn.ts`, `packages/agent/src/summarizer.ts`, `packages/agent/src/job.ts` (call sites)
- Test: `packages/agent/test/models.test.ts`, `packages/agent/test/turn-loop.test.ts`, `packages/agent/test/mock.ts`

**Interfaces:**

- Consumes: the `summary` field from Task 1.
- Produces: `Models.providerOptions: Record<ModelTier, ProviderOptions>`, replacing the single object.

- [ ] **Step 1: Write the failing tests**

In `packages/agent/test/models.test.ts`:

```ts
  it("gives the smart tier a private channel and keeps the fast tier flat", () => {
    const models = createModels({ provider: "deepseek", apiKey: "test" })
    expect(models.providerOptions.smart).toEqual({
      deepseek: { thinking: { type: "enabled" } },
    })
    expect(models.providerOptions.fast).toEqual({
      deepseek: { thinking: { type: "disabled" } },
    })
  })
```

In `packages/agent/test/turn-loop.test.ts`, extend the system prompt test:

```ts
    expect(text).toContain("summary")
    expect(text).toContain("Never narrate")
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bun run --filter @workspace/agent test models`
Expected: FAIL, `providerOptions.smart` is undefined.

- [ ] **Step 3: Split the provider options by tier**

In `packages/agent/src/models.ts`:

```ts
export type Models = {
  smart: LanguageModel
  fast: LanguageModel
  /** What to record on the run row. */
  ids: Record<ModelTier, string>
  /** Per-tier provider settings; pass the tier the call site uses. */
  providerOptions: Record<ModelTier, ProviderOptions>
}
```

and in the `deepseek` case:

```ts
      return {
        smart: deepseek(ids.smart),
        fast: deepseek(ids.fast),
        ids,
        // V4 reasons by default. `smart` keeps the channel: deliberation belongs
        // there, and `sendReasoning: false` keeps it off the wire. `fast` runs
        // structured output only, where a scratchpad buys nothing.
        providerOptions: {
          smart: { deepseek: { thinking: { type: "enabled" } } },
          fast: { deepseek: { thinking: { type: "disabled" } } },
        },
      }
```

Update the call sites: `models.providerOptions.smart` in `turn.ts` and both `job.ts` call sites, `models.providerOptions.fast` in `summarizer.ts`. Update `testModels` in `packages/agent/test/mock.ts` to `providerOptions: { smart: {}, fast: {} }`.

- [ ] **Step 4: Route the model's words**

In `packages/agent/src/prompts/base.ts`, the closing rule of `BASE_PROMPT` names where the words go:

```
"Every sentence you write to the user lives in a field: `summary` says what changed and why in one sentence, `gaps` names what is missing or blocked, `followUpQuestion` asks for the single most useful thing, and each patch's `reason` explains that patch. Never narrate your reasoning, your process or your uncertainty: text outside those fields is discarded before the user sees it.",
"Always finish by calling propose_patches once with every patch you want to make. When nothing should change, call it with an empty list and say why in `summary`. If some patches come back rejected, you may fix them and call propose_patches again; the ones that passed are already kept.",
"Propose first, ask second. Never refuse a rewrite because a figure is missing and never ask permission before proposing. Make the improvement you can make now, name what is missing in `gaps`, and put your single most useful question in `followUpQuestion`. The user's answer is a figure you may use on your next turn.",
```

Add to `packages/agent/src/skills/bullet-rewrite.ts`, next to the gaps rule:

```
"Say what you changed in `summary`, one sentence, no bullet count.",
```

- [ ] **Step 5: Verify**

```bash
bun run typecheck && bun run check && bun run test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Split thinking by tier and route the model's words into fields"
```

---

### Task 5: The panel

The summary is the only place the turn still speaks, so it has to be visible, and the status line has to say something more useful than a spinner without inventing prose.

**Files:**

- Modify: `apps/web/src/features/chat/Transcript.tsx`

**Interfaces:**

- Consumes: `ProposeOutput.summary` from Task 1; `skillOf` from `@/lib/skills`.
- Produces: nothing outside the component.

- [ ] **Step 1: Render the summary above the cards**

In `Transcript.tsx`, `Proposal` renders `output.summary` before the gaps block. Both the summary and `followUpQuestion` are a short markdown sentence in the same bubble, so extract the bubble they share:

```tsx
/** A short sentence from the turn, in the assistant's voice. */
function Say({ children }: { children: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-[10px] bg-muted px-3 py-2.5 text-[12.5px] leading-[1.55] text-foreground">
        <MessageMarkdown>{children}</MessageMarkdown>
      </div>
    </div>
  )
}
```

Use it for the summary at the top of `Proposal`, and replace the inline bubble around `output.followUpQuestion` with it. Do not reuse it for the text part branch: that one streams and is markdown in `streaming` mode.

- [ ] **Step 2: Derive the status line from the skill**

In `Transcript`, the busy line currently reads "Working through the resume". The skill id is already on the streaming message's metadata, set from the `start` chunk, so the label needs no new plumbing:

```tsx
const streaming = messages[messages.length - 1]
const skillId =
  streaming?.role === "assistant" ? streaming.metadata?.skillId : undefined
const label = skillId ? skillOf(skillId)?.label : undefined

{status === "submitted" ? (
  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
    <Spinner className="size-3.5" />
    {label ? `${label}...` : "Working through the resume"}
  </div>
) : null}
```

Import `skillOf` from `@/lib/skills`. Nothing here reads a reasoning part, a text part or a step count, and nothing should be added to it later without the same test.

- [ ] **Step 3: Verify statically**

```bash
bun run typecheck && bun run check
```

Expected: PASS.

- [ ] **Step 4: Look at it**

No browser automation. Ask the user to open a resume, send a rewrite request to the assistant, and check three things: the status line names the skill while the turn runs, the turn opens with one summary sentence and then the cards, gaps and question, and there is no paragraph of process text anywhere. Then reload the page and confirm the turn is identical, which is the store rule and the stream rule agreeing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Show the proposal's summary and a skill-derived status line"
```

---

### Task 6: Specs

The front-end spec still describes a panel that streams model prose, and the back-end spec still says thinking is off for both tiers.

**Files:**

- Modify: `docs/specs/front-end.md` section 7
- Modify: `docs/specs/back-end.md:724`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: The rendering contract**

Rewrite the list in 7.4 so it states what a turn may contain:

> Each assistant message's parts are rendered in order, and a turn carries only what the user acts on:
>
> - `text` parts render only for a run that never proposed. A run that proposed keeps no text at all, because everything it wanted to say is in the proposal, and prose on the way to a tool call is deliberation. This holds in the stream and at store time, through one rule in `packages/agent/src/visible.ts`, so a reload shows what the stream showed.
> - `tool-propose_patches` parts render the turn: `output.summary` as the one opening sentence, then the suggestion group, then `output.gaps`, then `output.followUpQuestion`.
> - `tool-check_fit` parts render a small inline chip "Checked fit: 2 pages".
> - Reasoning parts never reach the browser: the response sets `sendReasoning: false`.

Also state the status line: while a turn runs, the panel shows the running skill's label from the message metadata, never a step count and never model text.

- [ ] **Step 2: The stale continuation hook**

7.2 still shows `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`, which the code stopped using: it fired on the `propose_patches` result too and ended every run on an error. Name the rule the code actually uses, `checkFitAnswered`, and say why it is scoped to the latest step.

- [ ] **Step 3: The tiers**

`docs/specs/back-end.md:724` says both tiers run with thinking disabled. Replace that clause with the split: `smart` runs with thinking enabled and its reasoning is never sent, `fast` runs with thinking disabled because it only does structured output.

- [ ] **Step 4: Check for other claims this makes false**

```bash
grep -rn "reasoning\|thinking\|working through\|explains" docs/specs/*.md
```

Correct anything that now describes the old behaviour. Leave the tailoring flow alone: it uses `generateText` with structured output, so it has no prose channel and nothing here applies to it.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "Write the turn's output contract into the specs"
```

---

## Self-Review Notes

Recorded so an executor knows these were checked rather than missed.

**Ordering.** Task 2's wire test needs `summary` in the tool input (Task 1), or the mock proposal fails validation and the test asserts the wrong thing. Task 3 needs the same field. Tasks 4 and 5 are independent of the rest, and Task 6 is last because it describes the finished behaviour.

**Why the store and the stream cannot disagree.** The stream holds text until a step ends, because only the step's end says whether a tool call followed; the store sees the finished message and applies the run-level rule directly. Both come from `visibleParts`' rule, and the paused `check_fit` continuation appends to the same message, so a turn's two halves are filtered by the same rule rather than by two implementations of it.

**Known trade-offs, on the record.**

- A tool-free step's text arrives whole at `finish-step` instead of streaming, because holding is what prevents a paragraph from appearing and then being deleted. Only the fallback path (a run that never proposed) is affected; a proposing run shows no text at all.
- `summary` is optional on the stored schema and required on the tool, so a model that omits it fails tool input validation, sees the schema error, and gets the remaining steps to fix it. If it never does, the turn ends with the standard error bubble rather than a silent empty turn.
- A turn that proposed keeps no text even when the closing line was worth reading. That is the design: the line belongs in `summary`, and the prompt says so.
- Reasoning is no longer sent at all. Debugging a bad proposal from the panel is not possible, by design; the run row and the tool results are the record.
- Nothing tests the prompt. The status line, the summary and the absence of prose are verified by the manual look in Task 5, step 4.
