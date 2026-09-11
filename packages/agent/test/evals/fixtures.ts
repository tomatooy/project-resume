import type { PatchOp } from "@workspace/resume-schema"

/**
 * The eval table.
 *
 * One row per thing a turn has to get right: which playbook fits a message,
 * whether a chip's hint is honoured or overridden, what a combination of two
 * playbooks produces, what a request naming no aspect is allowed to load, and
 * which requests are refused without the structural flag. The rows are the
 * acceptance criteria for the prompt; nothing here
 * asserts text, only which playbooks were loaded and which ops came back.
 *
 * `docs/superpowers/specs/2026-09-10-agent-system-design.md` section 15 is the
 * source: around two dozen cases, and a floor per category rather than one
 * blended score, so a structural regression cannot hide behind good wording
 * results elsewhere.
 */
export type EvalCategory =
  | "single"
  | "hint"
  | "override"
  | "combination"
  | "broad"
  | "question"
  | "noop"
  | "structural"
  | "fit"
  | "selection"

export type EvalCase = {
  name: string
  category: EvalCategory
  /** What the user typed, exactly as the composer would send it. */
  message: string
  /** The chip the composer tapped, when one was tapped. */
  hintSkillId?: string
  /** Which fixture node the editor had selected, when anything was. */
  selectedNode?: "bullet" | "otherBullet" | "item"
  /** The request carried the structural flag. */
  structural: boolean
  /**
   * With the flag off, this request must come back with nothing at all: the
   * turn wanted to add or drop a whole entry, which is exactly what the gate
   * refuses. Set on the gate's own rows only, because a case like a bullet add
   * is allowed without the flag and is here to keep the boundary honest.
   */
  refuses?: boolean
  expect: {
    /**
     * Playbooks the turn must load, as an exact set: the names the message
     * implies are the names it may load, and a playbook beyond them is the
     * "loaded unasked" failure.
     */
    skills: string[]
    /**
     * The floor for a request that names no aspect. A vague ask has no single
     * right set, so these rows assert what the message implies and stay silent
     * about the rest; the exact set is not checked when this is present.
     */
    skillsAtLeast?: string[]
    /** Ops allowed to appear. Empty means the turn must propose nothing. */
    ops?: PatchOp[]
    /**
     * The turn must answer without calling a tool at all: no `plan`, no
     * `load_skill`, no `check_fit`, no `propose_patches`. A greeting or a pure
     * question costs one model step, and this is what keeps it at one.
     */
    noTools?: boolean
  }
}

const POSTING =
  "Staff engineer, platform. You will run our Kubernetes migration, mentor " +
  "four engineers, and own the reliability roadmap. Terraform, Go, on-call."

export const EVAL_CASES: readonly EvalCase[] = [
  // Each playbook on its own.
  {
    name: "bullets alone",
    category: "single",
    message: "Make my bullets punchier and lead with outcomes.",
    structural: false,
    expect: {
      skills: ["bullet_rewrite"],
      ops: ["replace_text", "insert_after"],
    },
  },
  {
    name: "posting alone",
    category: "single",
    message: `Here is the posting:\n\n${POSTING}\n\nHow well does this resume match it?`,
    structural: false,
    expect: { skills: ["jd_match"], ops: ["replace_text", "update_fields"] },
  },
  {
    name: "clarity alone",
    category: "single",
    message: "Fix the grammar and the hedging in my summary.",
    structural: false,
    expect: {
      skills: ["grammar_clarity"],
      ops: ["replace_text"],
    },
  },
  {
    name: "slop alone",
    category: "single",
    message:
      "This sounds like AI wrote it. Strip the AI phrasing without changing what it says.",
    structural: false,
    expect: { skills: ["grammar_clarity"], ops: ["replace_text"] },
  },
  {
    name: "length alone",
    category: "single",
    message: "This is spilling onto three pages. Cut it to one.",
    structural: false,
    expect: {
      skills: ["condense_to_pages"],
      ops: ["replace_text", "delete", "move"],
    },
  },
  {
    name: "quantify alone",
    category: "single",
    message:
      "Add metrics to my bullets. The work has a size and the resume never states it.",
    structural: false,
    expect: {
      skills: ["resume_quantifier"],
      ops: ["replace_text", "insert_after"],
    },
  },
  {
    name: "tech resume alone",
    category: "single",
    message:
      "Make my skills section read like a backend engineer's: grouped and ordered the way a technical screener expects.",
    structural: false,
    expect: {
      skills: ["tech_resume_optimizer"],
      ops: ["replace_text", "update_fields", "insert_after"],
    },
  },

  // A chip's hint, honoured.
  {
    name: "hint bullets",
    category: "hint",
    message:
      "Tighten my bullets so each one leads with what I did and changed.",
    hintSkillId: "bullet_rewrite",
    structural: false,
    expect: {
      skills: ["bullet_rewrite"],
      ops: ["replace_text", "insert_after"],
    },
  },
  {
    name: "hint posting",
    category: "hint",
    message: `Here is the posting:\n\n${POSTING}\n\nMatch my resume to it and tell me what to change.`,
    hintSkillId: "jd_match",
    structural: false,
    expect: { skills: ["jd_match"], ops: ["replace_text", "update_fields"] },
  },
  {
    name: "hint clarity",
    category: "hint",
    message:
      "Fix the grammar and tense, and make it read like a resume, not AI filler.",
    hintSkillId: "grammar_clarity",
    structural: false,
    expect: { skills: ["grammar_clarity"], ops: ["replace_text"] },
  },
  {
    name: "hint length",
    category: "hint",
    message: "Cut this down so it fits on one page.",
    hintSkillId: "condense_to_pages",
    structural: false,
    expect: { skills: ["condense_to_pages"], ops: ["replace_text", "delete"] },
  },
  {
    name: "hint quantify",
    category: "hint",
    message: "Add numbers to my bullets so the size of the work comes through.",
    hintSkillId: "resume_quantifier",
    structural: false,
    expect: {
      skills: ["resume_quantifier"],
      ops: ["replace_text", "insert_after"],
    },
  },
  {
    name: "hint tech resume",
    category: "hint",
    message:
      "Optimize this for a software engineering role: bullets, skills and projects.",
    hintSkillId: "tech_resume_optimizer",
    structural: false,
    expect: {
      // The chip's own text names three aspects, so the tech playbook is the
      // floor and a companion is not a failure. The up-to-three cap and the
      // multi-aspect procedure make the exact set unfair here.
      skills: [],
      skillsAtLeast: ["tech_resume_optimizer"],
      ops: ["replace_text", "update_fields", "insert_after"],
    },
  },

  // A hint the message contradicts: the message wins.
  {
    name: "hint overridden by the message",
    category: "override",
    message: "Actually, fix the grammar instead. Do not cut anything.",
    hintSkillId: "condense_to_pages",
    structural: false,
    expect: { skills: ["grammar_clarity"], ops: ["replace_text"] },
  },
  {
    name: "hint overridden the other way",
    category: "override",
    message: "Forget the wording. It has to fit on one page.",
    hintSkillId: "bullet_rewrite",
    structural: false,
    expect: { skills: ["condense_to_pages"], ops: ["replace_text", "delete"] },
  },

  // Two playbooks in one turn.
  {
    name: "bullets and length together",
    category: "combination",
    message: "Tighten the bullets and get it down to one page.",
    structural: false,
    expect: {
      skills: ["bullet_rewrite", "condense_to_pages"],
      ops: ["replace_text", "delete", "insert_after"],
    },
  },
  {
    name: "clarity and posting together",
    category: "combination",
    message: `Here is the posting:\n\n${POSTING}\n\nFix the grammar, then tell me what the posting wants that it does not show.`,
    structural: false,
    expect: {
      skills: ["grammar_clarity", "jd_match"],
      ops: ["replace_text", "update_fields"],
    },
  },
  {
    name: "quantify and tech together",
    category: "combination",
    message:
      "Quantify the work and group my skills the way a backend role expects.",
    structural: false,
    expect: {
      skills: ["resume_quantifier", "tech_resume_optimizer"],
      ops: ["replace_text", "update_fields", "insert_after"],
    },
  },

  // A request that names no aspect. The cap is three, so which playbooks come
  // back is the model's reading of the ask; a floor is the honest assertion.
  {
    name: "a general improvement ask",
    category: "broad",
    message: "Improve this resume.",
    structural: false,
    expect: {
      skills: [],
      // "Improve" is `bullet_rewrite`'s own trigger word in the catalog, so a
      // turn that loads nothing at all for this is the failure.
      skillsAtLeast: ["bullet_rewrite"],
      ops: ["replace_text", "insert_after", "update_fields"],
    },
  },
  {
    name: "a general ask about how it reads",
    category: "broad",
    message:
      "This resume reads badly. Do a pass over it and fix what you find.",
    structural: false,
    expect: {
      skills: [],
      skillsAtLeast: ["grammar_clarity"],
      ops: ["replace_text", "update_fields"],
    },
  },

  // A question: no playbook, no patch.
  {
    name: "a question about the content",
    category: "question",
    message: "What does this resume say about leading other engineers?",
    structural: false,
    expect: { skills: [], ops: [], noTools: true },
  },
  {
    name: "a question about the document",
    category: "question",
    message: "Which sections does it have, and how long is each one?",
    structural: false,
    expect: { skills: [], ops: [], noTools: true },
  },

  // Nothing to change: the answer is text, and no tool runs at all.
  {
    name: "a greeting",
    category: "noop",
    message: "hi",
    structural: false,
    expect: { skills: [], ops: [], noTools: true },
  },
  {
    name: "an acknowledgement",
    category: "noop",
    message: "Thanks, that looks good. Nothing else for now.",
    structural: false,
    expect: { skills: [], ops: [], noTools: true },
  },

  // A posting pasted into the message with the slot left empty.
  {
    name: "posting pasted into the message",
    category: "question",
    message: `Here is the posting: ${POSTING} What should I change first?`,
    structural: false,
    expect: { skills: ["jd_match"], ops: ["replace_text", "update_fields"] },
  },

  // The gate.
  {
    name: "section delete with the flag off",
    category: "structural",
    message: "Drop the section that does not match this posting.",
    structural: false,
    refuses: true,
    expect: { skills: ["jd_match"], ops: [] },
  },
  {
    name: "section delete with the flag on",
    category: "structural",
    message: "Drop the section that does not match this posting.",
    structural: true,
    expect: { skills: ["jd_match"], ops: ["delete"] },
  },
  {
    name: "item add with the flag off",
    category: "structural",
    message: "Add the volunteering I did at the code school as a new entry.",
    structural: false,
    refuses: true,
    expect: { skills: [], ops: [] },
  },
  {
    name: "item add with the flag on",
    category: "structural",
    message: "Add the volunteering I did at the code school as a new entry.",
    structural: true,
    expect: { skills: [], ops: ["insert_after"] },
  },
  {
    name: "bullet add is not structural",
    category: "structural",
    message: "Add a bullet about the migration I led onto the current role.",
    structural: false,
    expect: { skills: ["bullet_rewrite"], ops: ["insert_after"] },
  },
  {
    name: "a chip group change is not structural",
    category: "structural",
    message: "Add Rust and remove the old Adobe entry from my skills.",
    structural: false,
    expect: { skills: [], ops: ["update_fields"] },
  },

  // Fit, answered with a measurement rather than an estimate.
  {
    name: "a fit question",
    category: "fit",
    message: "Will it fit on one page as it stands?",
    structural: false,
    expect: { skills: [], ops: ["replace_text", "delete", "move"] },
  },
  {
    name: "cut until it fits",
    category: "fit",
    message: "It has to fit on one page. Cut whatever it takes.",
    structural: false,
    expect: { skills: ["condense_to_pages"], ops: ["replace_text", "delete"] },
  },

  // The selection scopes the request.
  {
    name: "a selected bullet",
    category: "selection",
    message: "Make this stronger.",
    selectedNode: "bullet",
    structural: false,
    expect: { skills: ["bullet_rewrite"], ops: ["replace_text"] },
  },
  {
    name: "a selected bullet in another item",
    category: "selection",
    message: "Make this stronger.",
    selectedNode: "otherBullet",
    structural: false,
    expect: { skills: ["bullet_rewrite"], ops: ["replace_text"] },
  },
  {
    name: "a selected item",
    category: "selection",
    message: "Tighten everything in here.",
    selectedNode: "item",
    structural: false,
    expect: { skills: ["bullet_rewrite"], ops: ["replace_text", "delete"] },
  },
]

/** The rows one category holds, so a failure names the category it hurt. */
export function casesByCategory(category: EvalCategory): EvalCase[] {
  return EVAL_CASES.filter((entry) => entry.category === category)
}
