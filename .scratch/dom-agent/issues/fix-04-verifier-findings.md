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

- [x] `PageRecordGroupSchema` carries `kind: z.enum(["experience", "education"]).nullable()`, where null keeps today's behaviour for a page that declares nothing.
- [x] Both the value-match filter and the `only_remaining_record` rule require `record.kind === group.kind` when the group declares one.
- [x] A test binds a blank education group against one leftover experience record and asserts it stays unbound, and the mutation above (flipping the kind) fails it.

## 2. MEDIUM: an attachment that exists only in the site's state can be replaced

`apps/extension/src/dom-agent/runtime/verbs.ts:369-371` takes `input.files` as the only
evidence that an attachment already exists. A site that accepts a file and then clears
the input, which is ordinary ATS behaviour, looks empty, so an attach with
`replaceExisting: false` proceeds and silently replaces a file the user uploaded.

- [x] Before writing, treat a positive site-state signal for this field, read the way `attachmentStateNear` reads it, as an existing attachment, so a replacement still needs the reviewed choice.
- [x] A test: a field whose input is empty but whose scope shows an accepted attachment refuses an unconfirmed attach.
- [x] Keep the current behaviour for a genuinely empty field, so an ordinary first upload still works without a review.

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

- [x] When both sides carry the same scope dimension with different values, the proposal is rejected, with a test.

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

## Landed

Items 1, 2 and 4. Items 3 and 5 untouched, as instructed. Every claim below was
observed, and every mutation was restored byte-identically (`cmp`).

**Item 1.** `PageRecordGroupSchema.kind` is required and nullable, so a caller has to state
intent and silence cannot be mistaken for "either kind". `kindMatches` now gates both the
value-match filter and the only-remaining rule, and the remaining-record set is computed per
group, so a blank education group is answered only by education records. Group literals in
the suite carry `kind: null` where nothing is declared.

Mutations, both restored byte-identically: flipping the record at the fixture the ticket
names (now line 259) from `experience` to `education` fails exactly one test, the named one
(`expected [] to deeply equal [ { groupRef: 'r1', ... } ]`); removing `kindMatches` from the
value-match filter fails exactly one test, the new "does not read a job as the answer to an
education group".

Not populated from the page, deliberately. A group's region label is the record's own
heading, not a section kind, and a section heading is page wording rather than a vocabulary.
Guessing a kind from wording inside a safety rule is the thing this ticket exists to stop.
The caller that added a group knows which control it pressed, so it declares the kind; the
observation does not.

**Item 2.** `attachmentPresentNear` reuses the same scope walk and the same exclusions as
`attachmentStateNear`, and the gate treats the site's own state as an attachment for both the
preserve and the confirmed-replacement branches. The name cannot be compared, because the
missing name is the whole problem, so the shape of a file name stands in, deliberately strict
about separators.

Mutations, both restored byte-identically: dropping the site-state evidence from the gate
fails exactly the two new site-state tests; loosening the shape to any extension anywhere
fails exactly the format-hint control test (`expected 'rejected' to be 'unresolved'`).

**Item 4.** `scope_mismatch` joins the rejection codes, and `checkAnswer` asks for it before
anything about the value, because a correctly copied value from a fact that means something
else is still the wrong answer. Values are compared through `normalizeQuestionText`, the same
normalisation a question key uses, so " us " and "US" are one scope rather than a mismatch.
Only dimensions both sides state are compared, so a fact with no country does not conflict
with a question that states one.

Mutation, restored byte-identically: deleting the call fails exactly one test.

## Residual risks, stated rather than hidden

- **Item 4's rule has no caller yet.** Every production construction of a question sets
  `scope: []` (`apps/extension/src/dom-agent/questions.ts:167`), while facts do carry
  `country`, `period`, `currency`, `employer` and `record`. So the gate is real and tested but
  cannot fire until something populates question scope. That is a reader or coordinator
  change, not this ticket's.
- **The attachment shape can be wrong in both directions.** A site that shows the name in a
  form the shape rejects, such as `resume.pdf (2MB)` with a comma or two tokens, is a miss, and
  a miss means the input still gets filled. A first-upload field whose hint happens to be a
  single token ending in an extension is a false positive, and the cost there is one
  unnecessary confirmation. Both are covered by tests as controls where they are covered at all.
- **`nextAdd` still offers a record whatever kind of group the page would add** (`nextAdd`,
  `record-group.ts`). Adding a group is the coordinator's act and it knows the kind it asked
  for, so the kind check that matters is on the binding, which is where it now lives.
- Items 3 and 5 remain as filed.

## Process note, for whoever dispatches the next worktree lane

Re-running the brief's linking loop over a package whose `node_modules` was already
bootstrapped creates self-named stray symlinks (`typescript/typescript`, `@types/@types`),
because `ln -s` dereferences an existing symlink to a directory and writes inside it. Nine
such links landed in the primary's dependency trees this way (39 of them, counted) and were
removed with `unlink`;
the primary's trees were then verified intact (typescript, react, zod and vitest all still
resolve). Link only packages that are missing, or guard the loop, and use `unlink` rather than
anything that follows a link.
