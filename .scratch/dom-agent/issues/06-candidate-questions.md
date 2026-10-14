# 06: Candidate questions

**What to build:** The deterministic list of questions a page is asking, with a stable order and count, which is what all coverage arithmetic is computed against.

**Blocked by:** 04

**Status:** done

- [x] Enumeration happens before any semantic classification and includes hidden file inputs associated with a visible upload interaction.
- [x] Each candidate carries original wording and description alongside computed names, its constraints, its requiredness evidence, and its group or record context.
- [x] Order and count are stable for an unchanged observation.
- [x] Grouping covers native field groups, repeated record groups, and option portals, with each candidate having exactly one accounted-for disposition.
- [x] Deterministic exact matches are limited to native kinds and exact label matches, and can never make a semantic inference.
- [x] Tested against the recorded fixtures and against hand-written markup for the awkward shapes.

## Landed

`apps/extension/src/dom-agent/questions.ts`:

- `candidateQuestions` enumerates every control in observation order, which is
  document order, so order and count are stable for an unchanged page with no
  sorting step
- it runs before any interpretation: the kind comes from `KIND_BY_CONTROL`, a
  native control-to-kind map. A select whose options read Yes and No stays a
  single choice, because calling it a yes/no question would be a reading
- every candidate carries the authored wording, the computed name, the
  description, the requiredness with its evidence, and its group and record
  context. The control's own constraints are reached through `controlRef`;
  `CandidateQuestion` has no constraint field of its own
- a question is never dropped for want of wording: an unlabelled control is
  enumerated as `[unlabelled <kind>]`
- `dispositions` seeds exactly one disposition per question, so
  `unaccountedQuestions` is empty by construction. Disabled and unclassifiable
  controls seed as `unsupported`, readonly ones as `preserved`
- `needingOptions` names the questions whose option list has to be read on
  request, and `attachOptions` folds a portal read back onto its question
- `exactLabelMatch` is the whole deterministic tier: exact wording after
  normalization, never a substring, synonym or near miss

The last acceptance box stays open for the same reason as ticket 04: the
recorded-fixture half needs ticket 05. Hand-written markup, including the awkward
shapes, is covered by `test/dom-agent-questions.test.ts` (14 cases).

Box ticked 2026-10-14: `dom-agent-questions.test.ts` runs against the recorded Ashby
fragment (so parts of 06 were already testable before the recorder landed, and the rest
became routable when it did), and the hand-written cases cover the awkward shapes: a
radiogroup read as one question, ARIA checkbox and radio members, an oversized dependent
group refused rather than truncated or split, and graph identities retained when many
radio candidates collapse into one field.
