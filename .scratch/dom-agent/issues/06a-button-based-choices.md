# 06a: Button-based choices

**What to build:** A button-based single choice is one question, not zero. Today `button_choice` is in `ControlKind` and the reader never produces it: a `<button aria-pressed>` is not a control at all, and a `role="radio"` div only becomes a question when its members share a native `name`. Ashby uses button-based yes/no choices, so a form can be reported as fully answered while a question was never seen.

**Blocked by:** 05 (the Ashby capture supplies the real markup). The rule must be read off a recording, not invented: guessing the grouping is how this kind was missed in the first place.

**Status:** ready-for-agent once 05 lands

- [ ] A group of buttons that submits as one field is enumerated as exactly one question whose kind is `button_choice`, with each button as one option.
- [ ] The grouping rule is derived from observed markup and written into this ticket when the capture settles it, so the next reader change does not have to rediscover it.
- [ ] `aria-pressed` buttons and `role="radio"` / `role="radiogroup"` containers are both covered, because the two ATS families spell this differently.
- [ ] A button that submits or navigates is never enumerated as a choice: Next, Back and Submit equivalents stay outside the question list, consistent with the never-click rule.
- [ ] An element another control names through `aria-controls` remains that control's option list and never becomes a question of its own.
- [ ] A page whose only unanswered question is a button choice cannot report ready, so the coverage number stops lying about it.
- [ ] Tests are drawn from the capture rather than hand-written markup alone, and record which capture they came from.

## Notes

Filed 2026-10-14 from lane A's report on ticket 04. The reader deliberately refused to guess the grouping rule without real markup, which is why this is a ticket rather than a silently wrong implementation. Ticket 09 must not ship ahead of it: the tracer bullet would demonstrate a form being completed while a question stayed invisible.

Also worth reading off the same capture, though it is not an acceptance box here. The review pass over the reader found that its record-reference test only asserts that references exist and that siblings differ, which cannot catch a reader that marks every sibling as its own record. That rule is read off the same Ashby markup, so if the capture settles it, record what it shows next to the grouping rule above rather than leaving it for a future rediscovery. If it turns out to be its own piece of work, it belongs to ticket 13's lane, which owns record binding.
