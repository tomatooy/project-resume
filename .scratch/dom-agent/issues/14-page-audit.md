# 14: Page audit and readiness

**What to build:** A fresh, whole-page verdict that the user can trust, computed from coverage and verification rather than from the number of writes completed.

**Blocked by:** 11, 12, 13

**Status:** ready-for-agent

- [ ] The audit inventories every current question, including untouched values and questions revealed during execution.
- [ ] It checks required fields, committed selections, attachments, validation errors, evidence coverage and cross-field consistency without submitting the form to provoke validation.
- [ ] A preserved pre-existing value satisfies a field when its committed state is observable and no conflict exists, and does not become a reusable fact.
- [ ] Optional blanks do not block readiness; a failed write, unknown requiredness, unresolved conflict or unobserved region does.
- [ ] The report distinguishes verified fills, preserved values, missing information, conflicts, failed controls, unverified results and unobserved regions.
- [ ] Only a complete audit can label the page ready, and readiness never claims the site will accept a later submission.
