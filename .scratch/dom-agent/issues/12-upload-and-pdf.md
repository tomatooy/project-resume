# 12: Upload and PDF attachment

**What to build:** The selected resume reaches the real ATS attachment field from bytes held in memory, and the result is reported honestly including when it cannot be confirmed.

**Blocked by:** 07, 08

**Status:** ready-for-agent

- [x] The PDF is rendered from the pinned resume and configuration without re-parsing it for facts, and it is cached by the complete source and render configuration so stale bytes are never attached.
- [x] Bytes reach the resolved file input through the bounded adapter in the page, which validates type, size and integrity and dispatches the required events.
- [x] Completion is judged by the attachment state the site exposes, not by the file list, and an unobservable outcome stays unverified.
- [ ] A rejected upload route leaves the attachment unresolved and offers manual upload while other fields continue.
- [ ] Existing attachments are never replaced without a specific reviewed user choice.
- [x] The resume field and any separate autofill import area are treated as distinct targets.

## Verdicts from the audit (2026-10-14)

Boxes 1, 2, 3 and 6 are met with named tests. Box 5 is met in part: both the worker and
the page refuse an unconfirmed replacement, proven by three tests, but the only evidence
of an existing attachment is the input's file list, so a site that clears its input after
accepting a file can be replaced without a review. Filed as `fix-04` item 2, and the
bare timestamp that stands for a reviewed choice is item 3, which belongs to ticket 15.

Box 4 is **not met**: a site-marked rejection is reported as `rejected`, and nothing
offers a manual upload or shows other fields continuing. Neither half is a defect in the
adapter; both need the panel (ticket 15) and a run that continues past one field
(tickets 09 and 11), so the box stays open with those.
Ticked boxes 1, 2, 3 and 6 on the audit's verdicts. Box 5 stays open on its second half: the
replacement refusal is stronger than it was, because `fix-04` item 2 gave the scope walk the
job of finding an attachment the site only holds in its own state, but what authorises a
replacement is still a bare timestamp, and turning that into a reviewed choice is ticket 15.
Box 4 stays open and now waits only on the panel: tickets 09 and 11 have landed the run that
keeps going past a rejected upload, so offering a manual upload and showing the other fields
continue is ticket 15's half of it.
