# 17: Perf harness and local metrics

**What to build:** Measurement that can support or refute the performance claims, recorded without ever capturing applicant content.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] Timings and counts are written to a bounded local ring buffer with a dev-only readout, and nothing leaves the machine.
- [ ] Recorded values cover first verified fill, page run completion excluding user response time, model requests and tokens, observation payload size, replanned questions, verification failures and observed coverage.
- [ ] The frozen multi-field form exists as a fixture with known supported facts and already visible options.
- [ ] Cold and warm runs are measured and reported separately.
- [ ] No speed multiplier is asserted before the harness has been run.
- [ ] A test proves that no applicant value, question text or document content can reach the metrics record.

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
