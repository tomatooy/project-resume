# 08: Source bundle service

**What to build:** One pinned, authenticated set of applicant sources per application, from which every answer is derived, with the retired concept-shaped storage still readable.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The bundle holds the selected resume or version, Profile, eligible saved answers, and the PDF rendering configuration, and it is fixed once for the application.
- [ ] A later edit in the web app does not change the bundle during an active application; a user-requested source change starts a new run.
- [ ] Persistence uses existing RLS and the existing revision-based optimistic concurrency, and a client-provided hash is never treated as authorization.
- [ ] Legacy saved answers are mapped at read time; a match that cannot be made safely stays visible for review instead of being generalized.
- [ ] Saving to Profile requires a real matching Profile field and an explicit user choice; the default is a temporary answer.
- [ ] The planner, draft and policy operations and their extension call sites are deleted, and the prepare operation is reshaped in place.
- [ ] Sources never reach the page whole: only the value an action needs and its authorized attachment cross.
