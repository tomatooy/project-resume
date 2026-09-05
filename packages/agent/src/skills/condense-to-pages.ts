import { defineSkill } from "./define"

export const condenseToPages = defineSkill({
  id: "condense_to_pages",
  fragment: (ctx) => {
    const pages = ctx.targetPages ?? 1
    const unit = pages === 1 ? "page" : "pages"
    return [
      `Target length: ${pages} ${unit}.`,
      "Shorten wordy bullets, merge overlapping ones, delete the weakest, and move lower-value items later. Keep the strongest evidence for the user's headline and the most recent role.",
      `Before proposing, call check_fit with your candidate patches to learn the page count they produce. If it is still above ${pages}, cut further and check again. Then call propose_patches with the final list.`,
    ].join("\n")
  },
})
