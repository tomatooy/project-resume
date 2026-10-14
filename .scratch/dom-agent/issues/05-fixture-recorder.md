# 05: Fixture recorder and captures

**What to build:** A dev-only capture that writes a versioned fixture for one page, and the fixtures themselves for the three acceptance application sites, so the driver can be replayed offline.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The recorder captures DOM, accessibility tree and geometry for a page and prunes to a documented, versioned shape.
- [ ] A fixture-loading seam exists for tests and is used by the driver and question tests.
- [ ] The recorder runs on demand from the developer machine and never during a normal run.
- [ ] Fixtures for Ashby, Greenhouse and Lever are captured by the user and committed, with the capture date and the extension version recorded in each.
- [ ] A test proves a fixture round-trips through the loader without losing coverage information.

## Note from ticket 04

Ticket 04 landed without recordings, so the fixture loader has a seam to fill
rather than a hole to dig: `test/helpers/cdp-page.ts` builds protocol-shaped
payloads from markup, and `buildPage` / `buildPageFrom` are the shape to
produce. Point the loader at `createPageTransport().setDocument(sessionId, page)`
and the suites in `test/dom-agent-observation.test.ts` and
`test/dom-agent-questions.test.ts` can be re-pointed at recordings with no
reader change.

Two things a real recording will show that the stand-in hides:

1. The stand-in returns one accessibility tree per session context that includes
   that context's frame content. Real Chrome returns the frame element, not its
   children, so an out-of-process frame needs its own read. The reader already
   reads every context it discovers, so this should hold, but it is unproven
   until a recording says so.
2. The stand-in never reports a node without browser identity and never truncates
   mid-tree. Both paths exist in the reader and are covered by hand-built
   payloads, not by a real capture.
