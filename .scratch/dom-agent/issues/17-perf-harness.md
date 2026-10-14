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
