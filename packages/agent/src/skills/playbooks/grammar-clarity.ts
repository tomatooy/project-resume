/**
 * Grammar and clarity: correct, professional resume prose first, AI tells
 * second.
 *
 * Two sources, mechanism only. hardikpandya/stop-slop gives the tells (filler
 * openers, empty adverbs, buzzwords, passive voice, false agency).
 * Paramchoudhary/ResumeSkills resume-bullet-writer gives the register: a line
 * says what the person did, names the specific tool or system, avoids duty
 * phrasing and self-praise, and stays parallel with its siblings. Its
 * quantification half and its report format are not here, because adding a
 * figure is the open estimates decision, not a grammar one.
 *
 * The stop-slop rules that only fit essays are dropped (vary sentence lengths,
 * two items beat three, no paragraph-ending punch line, no Wh- opener, stop
 * before the third item). A resume is not an essay, and those rules pulled the
 * rewrites away from a professional register. What stays is ranked: the
 * register outranks the tell list, so a specific, parallel line survives a
 * word the list would otherwise trim.
 */
export const grammarClarity = [
  "Fix grammar, spelling, punctuation and tense: past tense for past roles, present tense for the current one. Spell tools, platforms and certifications the vendor's way (GitHub, Kubernetes, PostgreSQL), and keep every figure, employer, title and date exactly as written.",
  "Write like a resume. Each line says what the person did and what changed, names the specific tool, system, team or process instead of an abstraction ('the billing service', not 'the platform landscape'), and stays within one or two lines. Keep bullets in a section parallel in shape and tense: that is a resume convention, not repetition.",
  "No duty phrasing, no first person, no self-praise. A concrete verb replaces 'Responsible for', 'Helped with', 'Worked on', 'Assisted with' and 'Duties included', without adding a claim the source does not make. There is no 'I' or 'my'. Cut the stock praises: results-driven, dynamic, proven track record, team player, passionate, detail-oriented, go-getter, thought leader. Cut the corporate metaphor too: handle over navigate, explain over unpack, accept over lean into, return to over circle back, analysis over deep dive, next over moving forward.",
  "Use the active voice and name the actor: the person did the work, so an inanimate thing never performs a human verb ('the migration saves time' says who ran it). Drop framing that narrates from a distance ('This happens because', 'People tend to'). Replace lazy extremes (every, always, never, nobody) with the scope the resume can support.",
  "Cut words that carry nothing. Empty emphasis and softeners go: really, very, highly, extremely, just, literally, simply, actually, genuinely, fundamentally, successfully. An adverb that carries meaning stays: independently, remotely, cross-functionally, weekly. Filler phrases go: 'at its core', 'it's worth noting', 'when it comes to', 'at the end of the day', 'in today's'. A sentence that announces importance without naming the thing ('the implications are significant') names the thing or goes.",
  "In the summary and the headline, state the point instead of staging it: 'not X, it's Y' and 'X is not the problem, Y is' become 'Y'; a negative listing ('not X, not Y, Z') becomes 'Z'; a rhetorical question ('What if...?') becomes the claim; a fragment stack ('Speed. Quality. Cost.') becomes one sentence. No em dashes.",
  "Register beats the list. A line that is specific, direct and parallel with its siblings is professional even when it uses a word or a three-item list this playbook would otherwise trim, and a technical term is never traded for a cleaner rhythm. Cut a tell only when the replacement is at least as clear and as specific.",
  "Make the smallest edit that fixes the problem, and fix a tell only as far as the tell. Add no fact, number or claim; change only how the text reads, and leave the claim, its order and its emphasis to the patch the user asked for. Leave a field alone when it has no error, no tell and no duty phrasing.",
  "Before proposing, read each rewritten field once as a recruiter: any grammar, tense or capitalization wrong; any duty phrasing, first person or stock praise left; any passive or inanimate actor; any empty adverb, filler or corporate metaphor; does it name the specific tool, system or result? Then one patch per corrected field, in the user's own voice and tense.",
].join("\n\n")
