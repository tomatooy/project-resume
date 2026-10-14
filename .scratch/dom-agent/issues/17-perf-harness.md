# 17: Perf harness and local metrics

**What to build:** Measurement that can support or refute the performance claims, recorded without ever capturing applicant content.

**Blocked by:** 11

**Status:** done, all six boxes met. What the numbers mean is bounded by jsdom: counts, payload sizes and coverage are real, and wall-clock values are nullable by design until the panel can run it in a browser.

- [x] Timings and counts are written to a bounded local ring buffer with a dev-only readout, and nothing leaves the machine.
- [x] Recorded values cover first verified fill, page run completion excluding user response time, model requests and tokens, observation payload size, replanned questions, verification failures and observed coverage.
- [x] The frozen multi-field form exists as a fixture with known supported facts and already visible options.
- [x] Cold and warm runs are measured and reported separately.
- [x] No speed multiplier is asserted before the harness has been run.
- [x] A test proves that no applicant value, question text or document content can reach the metrics record.

## Lane ownership (this pass)

**Owns:** a new metrics module under `apps/extension/src/dom-agent/` and its dev-only
readout, the smallest additive instrumentation needed in `run-coordinator.ts` to record
the values the boxes name, the frozen multi-field form as a fixture under
`apps/extension/test/fixtures/`, and the tests for all of it.

**Must not touch:** `packages/resume-core/**`, `apps/web/**`, `packages/api/**`. Prefer
reading what the run already reports (`progress`, `receipts`, `coverage`, `checkpoint`)
over adding counters: a verifier is auditing the coordinator's boxes right now, against
the committed code, so the less this lane moves it the more that audit still holds. If a
counter genuinely has to be added in resume-core, report the exact change instead.

**Privacy is the box that matters.** Nothing that identifies an applicant, a question's
wording, or the document may reach the metrics record, and box 6 wants a test proving it
rather than a promise. Treat that test as the deliverable, not the instrumentation.

**Do not assert a performance number.** Box 5 forbids a multiplier before the harness has
been run. Counts and payload sizes can be measured in tests today; wall-clock timings need
a real browser, which this repository forbids an agent to drive, so report what you
measured, say plainly what only the user can measure, and never fill the gap with a claim.
All six boxes are met. The record is a strict object that carries exactly what box 2 names,
first verified fill, completion, observations and their bytes, planned and replanned
questions, verification failures, model requests and tokens, coverage and the disposition
counts, and it has no free-text field at all, which is why box 6's test is a proof rather
than a promise: it establishes the applicant content was in the run's hands before asserting
none of it reached the ring. That test earned its keep by catching a run id the lane had
added, the one free-text door into the record.

Box 5 is met the only honest way: no multiplier was asserted. Wall-clock values are `null`
in the harness because a real browser is needed to measure them, and this repository forbids
an agent to drive one, so the first genuine timings will come from the panel's dev readout
when ticket 15 puts a run in front of the user.
