# 06a: Button-based choices

**What to build:** A button-based single choice is one question, not zero. Today `button_choice` is in `ControlKind` and the reader never produces it: a `<button aria-pressed>` is not a control at all, and a `role="radio"` div only becomes a question when its members share a native `name`. Ashby uses button-based yes/no choices, so a form can be reported as fully answered while a question was never seen.

**Blocked by:** nothing. A real Ashby capture is already in the repo (see the pattern below), so the grouping rule can be read off markup rather than invented. The ticket 05 recordings still confirm the variants.

**Status:** ready-for-agent

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

## The markup this rule is read off (verified 2026-10-14)

`apps/extension/test/fixtures/ashby-application.html`, 1899 bytes, tracked since
`5693abd`, reduced from the user's 2026-09-28 capture with applicant data removed. Four
`aria-pressed` buttons, so the pattern is real and not a guess. Nothing reads the file
today. Its shape, abbreviated:

    <div class="ashby-application-form-field-entry" data-field-path="work-authorization">
      <label class="ashby-application-form-question-title" for="work-authorization">Are you
        legally authorized to work in the United States?</label>
      <div class="ashby-application-form-input-yesno">
        <button aria-pressed="false" data-option="yes">Yes</button>
        <button aria-pressed="false" data-option="no">No</button>
        <input type="checkbox" tabindex="-1" name="work-authorization" style="display:none">
      </div>
    </div>

Read off it: the question is the `field-entry`; the wording is the `question-title`
label whose `for` names the field; the choice group is the container holding the
buttons; and the field the form actually submits is the hidden checkbox whose `name`
matches that `for`. Do not key off Ashby's class names, which are their internals: the
durable evidence is the label, its `for`, and the hidden input that carries that name.

Two limits of this fragment, so the capture still has work to do: it is yes/no only, so
it shows nothing about a longer option list, and it has no `role="radio"` /
`role="radiogroup"` container, which box 3 still requires. Record what the recordings
show for those two when they arrive. The hidden checkbox also matters for the reader: it
is unnamed to a person and `display:none`, and it must not be enumerated as a question
of its own.

## Lane ownership (this pass)

Shares a lane with `fix-03-reader-truncation.md`: both change the reader, so one
writer holds `observation.ts`, `questions.ts` and their tests. See fix-03 for the
file list.
