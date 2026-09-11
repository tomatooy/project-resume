/**
 * Quantifying impact: where a number comes from when a bullet has none.
 *
 * Distilled from Paramchoudhary/ResumeSkills `resume-quantifier`, mechanism
 * only: the metric families, the discovery judgement, and the four estimate
 * shapes. The upstream file is a report template whose examples carry figures
 * nobody could verify; what is here is the judgement, and the card, not this
 * file, is what shows the user which figures the resume does not state.
 */
export const resumeQuantifier = [
  "Give the work a size. A bullet that says what was done is an activity; the number that says how much, how many or how much faster is what makes it evidence. Almost every role has a unit: customers, tickets, requests, accounts, records, releases, hours, currency, percent.",
  [
    "Find that unit in the family the work belongs to:",
    "- money: revenue, budget owned, cost removed, deal size",
    "- time: hours or days saved, cycle time, response time, project length",
    "- share: growth, conversion, error rate, retention, uptime",
    "- scale: people, customers, accounts, projects, records, requests",
    "- quality: satisfaction, accuracy, defect or SLA rate",
    "- frequency: per day, per week, per release, per season",
  ].join("\n"),
  [
    "When the exact figure is not in the material, supply one and shape it so the user can stand behind it. Four shapes keep an estimate honest, and the first is almost always available:",
    "- approximate: ~40%, about 30 clients",
    "- range: 8-12 engineers, $100K-$150K in revenue",
    "- minimum: 75+, at least 15, 250 or more",
    "- derived: multiply a stated cadence by a stated period (5 clients a week over 50 weeks gives 250+ a year), or take a share of a total the resume states",
  ].join("\n"),
  "Estimate low and round down. The figure has to survive the interview, so the conservative end of the range is the stronger bullet: 40 accounts that hold up beat 60 that do not, and a range the user can trim beats a point they have to defend.",
  "A figure needs its unit and its direction. Write what moved and by how much (deploy time cut from 45 to 10 minutes), not a bare percentage with no baseline.",
  "Two or three figures in a bullet is the ceiling. One figure that carries the scale outranks three that crowd the line.",
  "Put the figure where it belongs: `replace_text` when the bullet exists, `insert_after` on the item when the work has no bullet at all (a bullet add needs no restructuring flag), and `update_fields` when the number is a field of the item rather than prose.",
  "Say in the patch `reason` that the figure is an estimate and what it came from. Put the one figure only the user can confirm in `followUpQuestion`, and name the rest in `gaps`, so an estimate is never dressed as a fact the resume already stated.",
  "The estimate rule covers size, not identity. Employers, titles, schools, degrees and dates are still never invented, whatever the posting would like to see.",
].join("\n\n")
