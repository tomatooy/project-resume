# Open after the review fixes

Residual items from the review pass over `8cdf011..711cb87`. Everything called a
finding is closed; these are the pieces that had no owner, or that cannot be
honestly closed yet. Keep this list short and delete entries as they land.

## Needs an owner

- **`ObservedControlSchema` constraints** (`packages/resume-core/src/dom-agent/observation.ts`).
  Constraints (`maxlength`, `pattern`, `min`, `max`, `inputmode`) are read and carried
  on the candidate question, which is what ticket 06's acceptance box asks for. If they
  are also wanted on the observed control, that file needs a lane: no work order has
  owned it since ticket 02.
- **The upload test's real path.** jsdom has no `DataTransfer`, so the test exercises
  the `Object.defineProperty` fallback and the fake `FileList` (no index access, only
  `length` and `item`) is never used. Closing this needs a browser, so it belongs with
  ticket 19's manual acceptance rather than a unit test.
- **Record-group over-marking.** The current test asserts that record references exist
  and differ, which cannot catch over-marking every sibling as a record. That is reader
  behaviour, so it belongs with ticket 06a or a follow-up to ticket 04.

## Deliberately deferred, with the reason

- **`batchIsAuthorized` has no caller.** There is no batch-level entry point;
  `dispatch.ts` handles one call at a time. The per-action gate means every attachment in
  a batch is still checked. Wire it when a batch entry point exists.
- **The toggle schema requirement.** `ActionSchema` does not require `expectedChecked`.
  The page refuses a null expectation, so it fails closed. Tightening the schema belongs
  in ticket 11, where a caller exists.
- **`documentGeneration` and `userEditEpoch` are carried and never compared.** Ticket 11
  lands the user-edit pause check.
- **Two mutating actions on one question at one revision are refused** by the replay
  guard. Intentional, and ticket 11 must know.

## Related, from other tickets

- **`button_choice` is never produced** and Ashby uses button-based choices: ticket 06a,
  blocked on the ticket 05 capture. Ticket 09 must not ship first.
- **Fixtures**: two acceptance boxes in tickets 04 and 06 stay open until ticket 05 lands,
  and ticket 05 is a user-run capture rather than agent work.
- **Pre-existing red, unrelated to this feature**: `packages/agent` (`models.test.ts`
  smart-tier thinking) and `apps/web` (`word-diff.test.tsx` expects `bg-primary/14`, the
  component renders `bg-success/10`). Both fail at `911f251`.

## Found by the reuse lane (2026-10-14)

**A long legacy answer makes `prepare` throw.** `factFromStoredAnswer` copies a stored value
of up to 4000 characters into `FactSchema.display`, which is capped at 500, so one verbose
legacy row fails the whole bundle. That contradicts the tenant that file states, which is
that an uninterpretable or unusable row is a review outcome rather than a failed run. The
fix wants a decision about what the display should say (the legacy reason already exists for
rows it cannot read) and belongs in `packages/resume-core/src/dom-agent/saved-answer.ts` with
its own test. Untouched by every lane so far because it would have widened their item.

**A worktree makes one preview test red.** `apps/web/src/features/resume/preview/pdfjs.test.ts`
fails inside a worktree even when run alone, because the documented bootstrap links
`node_modules` entries to the primary's real paths and Vite's fs allowlist then denies the
worker's resolved path. It passes in the primary checkout. Lanes should not chase it.
