# 06: Candidate questions

**What to build:** The deterministic list of questions a page is asking, with a stable order and count, which is what all coverage arithmetic is computed against.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Enumeration happens before any semantic classification and includes hidden file inputs associated with a visible upload interaction.
- [ ] Each candidate carries original wording and description alongside computed names, its constraints, its requiredness evidence, and its group or record context.
- [ ] Order and count are stable for an unchanged observation.
- [ ] Grouping covers native field groups, repeated record groups, and option portals, with each candidate having exactly one accounted-for disposition.
- [ ] Deterministic exact matches are limited to native kinds and exact label matches, and can never make a semantic inference.
- [ ] Tested against the recorded fixtures and against hand-written markup for the awkward shapes.
