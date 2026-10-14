# fix-04: What the verifier found on tickets 10, 12 and 13

**What to build:** the defects a read-only audit found in the reasoner, the upload path
and record groups, ranked. Items 1 and 2 are the two that can put wrong data in a field
or overwrite a user's file, so they land before ticket 11 wires any of this to a page.

**Status:** ready-for-agent

## 1. HIGH: record binding ignores the record's kind

`SourceRecord.kind` (`packages/resume-core/src/dom-agent/record-group.ts:16`, written at
`:41-48`) is never read when a group binds, and `PageRecordGroupSchema` (`:73-80`) has
no kind at all. So a blank **education** group with one leftover **experience** record is
bound to that record by `only_remaining_record` (`:239-247`), and a name shared by a
company and a school binds directly. That is inventing history, which is the one thing
ticket 13 forbids.

The proof is that the existing tests cannot see it: changing the kind at
`packages/resume-core/test/dom-agent-records.test.ts:246` from `"experience"` to
`"education"` leaves every assertion in the file passing.

- [ ] `PageRecordGroupSchema` carries `kind: z.enum(["experience", "education"]).nullable()`, where null keeps today's behaviour for a page that declares nothing.
- [ ] Both the value-match filter and the `only_remaining_record` rule require `record.kind === group.kind` when the group declares one.
- [ ] A test binds a blank education group against one leftover experience record and asserts it stays unbound, and the mutation above (flipping the kind) fails it.

## 2. MEDIUM: an attachment that exists only in the site's state can be replaced

`apps/extension/src/dom-agent/runtime/verbs.ts:369-371` takes `input.files` as the only
evidence that an attachment already exists. A site that accepts a file and then clears
the input, which is ordinary ATS behaviour, looks empty, so an attach with
`replaceExisting: false` proceeds and silently replaces a file the user uploaded.

- [ ] Before writing, treat a positive site-state signal for this field, read the way `attachmentStateNear` reads it, as an existing attachment, so a replacement still needs the reviewed choice.
- [ ] A test: a field whose input is empty but whose scope shows an accepted attachment refuses an unconfirmed attach.
- [ ] Keep the current behaviour for a genuinely empty field, so an ordinary first upload still works without a review.

## 3. MEDIUM, belongs to ticket 15: the reviewed choice is a bare integer

`packages/resume-core/src/dom-agent/action.ts:48-52` types `reviewedAt` as a number, so
any non-null integer expresses a replacement. The worker and page gates are correct about
what they check; what is missing is the panel minting that value from a real review
record. Land it with the panel, not here.

## 4. LOW: the gate never compares the scope of a question against the scope of a fact

`proposal-rules.ts` `checkAnswer` reads neither `question.scope` nor `fact.scope`; both
reach the prompt (`packages/agent/src/dom-agent/reasoner.ts:150-210`) and nothing
deterministic checks them. A country-scoped or period-scoped fact can therefore ground a
differently-scoped question.

- [ ] When both sides carry the same scope dimension with different values, the proposal is rejected, with a test.

## 5. LOW: a version-pinned bundle can never render

`apps/extension/src/autofill/pdf-background.ts:62-64` never sends `versionId` although
`PdfDocumentInputSchema` accepts it (`source-service.ts:55-64`), so a bundle prepared
from a version always fails the bundle check with CONFLICT. It fails safe, no wrong bytes
are attached, but the versioned case is unimplemented.

## 6. Note, no action: the eval lane's CI half is vacuous

The three CI-visible tests in `packages/agent/test/reasoner.eval.test.ts:20-57` inspect
the case table only and pass with the reasoner deleted; the grounded-answer measurement
skips without `AGENT_EVAL=1` and a key. Ticket 10 box 7 is met, but the number that
matters is opt-in, so treat the live lane as unmeasured rather than passing.

## Not defects

A site's own acceptance signal is often just a filename label, which a client-side echo
can imitate; the runtime never uses the file list as evidence, so the honesty rule holds
and the ambiguity is inherent to reading site state. And `rejected` for a site-marked
upload failure is not a claim of success, so it is honest even though ticket 12 box 4's
`unresolved` wording and its manual-upload offer belong to the panel.

## Lane ownership (this pass)

**Owns:** `packages/resume-core/src/dom-agent/record-group.ts` and
`packages/resume-core/src/dom-agent/proposal-rules.ts`,
`apps/extension/src/dom-agent/runtime/verbs.ts` and `runtime/control.ts`, and the tests
that cover them (`packages/resume-core/test/dom-agent-records.test.ts`,
`packages/resume-core/test/dom-agent-reasoner.test.ts`,
`apps/extension/test/dom-agent-runtime.test.tsx`).

**Must not touch:** `packages/resume-core/src/dom-agent/index.ts` (the other lane owns the
barrel for its new module). Neither item 1 nor item 4 needs a new export, since both
modules are already exported. If you find you need one, report the exact line instead.

**Out of scope here:** item 3 (the panel mints a reviewed choice) and item 5 (a
version-pinned bundle), which are not this lane's tickets. Do not do them.
