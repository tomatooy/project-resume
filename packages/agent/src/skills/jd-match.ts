import { defineSkill } from "./define"

export const jdMatch = defineSkill({
  id: "jd_match",
  fragment: (ctx) =>
    [
      "The user is applying for the role described below. Reword bullets to use the posting's terminology where the resume genuinely supports it, move the most relevant items and bullets first, and delete bullets that add nothing for this role.",
      "Never claim a skill, tool or result the resume does not already show. Put qualifications the posting asks for that the resume lacks in `gaps`, one short line each, so the user can decide what to add.",
      "Job description:",
      "```",
      ctx.jobDescription ?? "",
      "```",
    ].join("\n"),
})
