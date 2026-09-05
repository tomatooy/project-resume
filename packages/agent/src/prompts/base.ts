import type { NodeKind, PatchOp } from "@workspace/resume-schema"

import type { SkillScope } from "../skills/types"

/**
 * From the back-end design, 10.3. Rules 2 and 3 diverge from it: the model was
 * being told the grounding rule as a prohibition on itself, so it refused and
 * negotiated instead of proposing. `validatePatches` is the enforcer; the model
 * only proposes.
 */
export const BASE_PROMPT = [
  "You improve resumes by proposing patches. You never edit directly: each patch is a proposal the user accepts or rejects one by one, so keep patches small and independent of each other.",
  "Keep every fact, employer, date, title and figure the source already states. Every digit you write must already appear in the resume, the user's message, or the job description; a patch containing one that does not is refused. Do not round, estimate or invent a figure, even if asked, because the patch is refused either way. When the user asks for a placeholder, write a digit-free one such as XX%, N, or <team size>: those pass.",
  "Propose first, ask second. Never refuse a rewrite because a figure is missing and never ask permission before proposing. Make the improvement you can make now, name what is missing in `gaps`, and put your single most useful question in `followUpQuestion`. The user's answer is a figure you may use on your next turn.",
  "Address nodes only by the ids given in the resume context. Copy `before` values exactly as they appear; a patch whose `before` no longer matches is refused.",
  "Keep the user's voice and tense. When a job description is given, write for that role.",
  "Always finish by calling propose_patches once with every patch you want to make. When nothing should change, call it with an empty list and say why in text. If some patches come back rejected, you may fix them and call propose_patches again; the ones that passed are already kept.",
  "Each patch needs a one-sentence reason written for the user.",
].join("\n\n")

const OP_EXAMPLES: Record<PatchOp, string> = {
  replace_text:
    '{"op":"replace_text","targetNodeId":"blt_a1b2c3","field":"text","before":"<exact current text>","after":"<new text>","reason":"<why>"}',
  update_fields:
    '{"op":"update_fields","targetNodeId":"exp_a1b2c3","before":{"role":"Engineer"},"after":{"role":"Senior Engineer"},"reason":"<why>"}',
  insert_after:
    '{"op":"insert_after","parentId":"exp_a1b2c3","afterNodeId":"blt_a1b2c3 or null to insert first","node":{"text":"<new bullet>"},"reason":"<why>"}',
  delete:
    '{"op":"delete","targetNodeId":"blt_a1b2c3","before":{"id":"blt_a1b2c3","text":"<exact current text>"},"reason":"<why>"}',
  move: '{"op":"move","targetNodeId":"blt_a1b2c3","toIndex":0,"reason":"<why> (moves within its parent; toIndex is the final position)"}',
}

const OP_NOTES: Record<PatchOp, string> = {
  replace_text: "replace_text changes one text field of one node.",
  update_fields:
    "update_fields changes several fields of one node at once; before and after list only the fields that change.",
  insert_after:
    "insert_after adds a new node inside parentId, right after afterNodeId. Do not give the new node an id.",
  delete: "delete removes one node; before is the node as it is now.",
  move: "move reorders a node among its siblings.",
}

export function patchContract(
  allowedOps: PatchOp[],
  allowedFields?: Partial<Record<NodeKind, string[]>>
): string {
  const lines = [
    `Patch contract. Allowed ops for this skill: ${allowedOps.join(", ")}. Anything else is refused.`,
  ]
  for (const op of allowedOps) {
    lines.push(`${OP_NOTES[op]}\nExample: ${OP_EXAMPLES[op]}`)
  }
  if (allowedFields) {
    const fields = Object.entries(allowedFields)
      .map(([kind, names]) => `${kind}: ${names.join(", ")}`)
      .join("; ")
    lines.push(`Fields you may change: ${fields}.`)
  }
  return lines.join("\n\n")
}

/** What the model is shown, as JSON it can quote node ids from. */
export function resumeContextBlock(scope: SkillScope): string {
  const shown =
    scope.kind === "document"
      ? scope.resume
      : {
          basics: { id: "basics", headline: scope.headline },
          selected: scope.selected,
        }
  return `Resume context, with node ids:\n\`\`\`json\n${JSON.stringify(shown)}\n\`\`\``
}

export function summaryBlock(summaryText: string): string {
  return `What you know from earlier in this conversation:\n${summaryText}`
}

export function buildSystemPrompt(input: {
  fragment: string
  allowedOps: PatchOp[]
  allowedFields?: Partial<Record<NodeKind, string[]>>
}): string {
  return [
    BASE_PROMPT,
    patchContract(input.allowedOps, input.allowedFields),
    input.fragment,
  ].join("\n\n")
}
