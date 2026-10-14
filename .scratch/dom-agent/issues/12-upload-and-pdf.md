# 12: Upload and PDF attachment

**What to build:** The selected resume reaches the real ATS attachment field from bytes held in memory, and the result is reported honestly including when it cannot be confirmed.

**Blocked by:** 07, 08

**Status:** ready-for-agent

- [ ] The PDF is rendered from the pinned resume and configuration without re-parsing it for facts, and it is cached by the complete source and render configuration so stale bytes are never attached.
- [ ] Bytes reach the resolved file input through the bounded adapter in the page, which validates type, size and integrity and dispatches the required events.
- [ ] Completion is judged by the attachment state the site exposes, not by the file list, and an unobservable outcome stays unverified.
- [ ] A rejected upload route leaves the attachment unresolved and offers manual upload while other fields continue.
- [ ] Existing attachments are never replaced without a specific reviewed user choice.
- [ ] The resume field and any separate autofill import area are treated as distinct targets.
