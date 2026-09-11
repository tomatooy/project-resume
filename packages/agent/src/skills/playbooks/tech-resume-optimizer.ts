/**
 * The technical resume: keywords for the screener, engineering for the
 * interview.
 *
 * Distilled from Paramchoudhary/ResumeSkills `tech-resume-optimizer`,
 * mechanism only: the bullet formula, the technical metric families, how a
 * skills section is grouped, and the project and link rules. The upstream file
 * carries long example lists; the document this acts on is the one in
 * resume-schema, where a skills section holds groups with `label` and
 * `skills`.
 */
export const techResumeOptimizer = [
  "Write for two readers at once: the screener or parser matching keywords, and the engineer across the table. The keyword gets the resume read; the technology doing real work in a bullet is what gets it believed.",
  "The technical bullet is what was built, with which technology, and the scale or the change it produced. Lead with the verb, keep the stack in the sentence, land on the figure.",
  'A bullet that only names an activity ("worked on", "helped with", "responsible for") reads as a duty list and hides the engineering. Say what the person owned, built, migrated, cut or automated, and with what.',
  [
    "Technical figures come from four families:",
    "- scale: users, requests per second, records, data volume, uptime, deployment frequency",
    "- performance: latency, load time, throughput, query time",
    "- efficiency: infrastructure cost, build or deploy time, memory, on-call load",
    "- product: revenue, conversion, engagement, adoption",
    "Where the resume states none of them, use the quantifier playbook's estimate shapes rather than leaving the bullet sizeless.",
  ].join("\n"),
  "Stacks live in the skills section, not repeated into every bullet. A technology named in a bullet should be doing work there (the migration, the service, the pipeline), not decorating it.",
  [
    "Skills section: groups by category, and a group named the way the posting names it is the one a screener finds.",
    "- the usual groups are languages, frameworks, databases, cloud and infrastructure, tools, and testing",
    "- each group is one skills item: `update_fields` on it with `label` and `skills`",
    "- within a group, what the target role asks for comes first",
    "- drop what is assumed (office suites, generic operating systems unless the role is DevOps), skill bars and ratings, and technologies touched once",
  ].join("\n"),
  "Adding a skills group or a project entry is an item add, so it needs removing and restructuring enabled; when the turn facts say that is disabled, name the addition in `gaps` instead of proposing it. Adding a link is never structural.",
  "Projects earn a slot when the stack is in the name line and the outcome is in the bullets, which matters most early in a career or after a change of field. A tutorial follow-along does not earn one.",
  "GitHub, a portfolio and a blog are links on `basics`: `insert_after` with parentId `basics` adds one, `replace_text` on an existing link fixes its `label` or `url`. Give a link a name, not just a URL.",
  "Headline and summary name the discipline and the stack the resume supports, the way a referrer would describe the person. A target the resume gives no evidence for is a wish and belongs in the conversation, not the document.",
  "Use the posting's spelling of a technology the resume genuinely supports, so the parser finds both (Postgres and PostgreSQL). Never claim a stack the resume does not show; that is what `gaps` is for.",
  "Only what can be discussed in an interview belongs in the document. A technology the user cannot explain costs more than the keyword gains.",
].join("\n\n")
