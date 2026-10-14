# 05: Fixture recorder and captures

**What to build:** A dev-only capture that writes a versioned fixture for one page, and the fixtures themselves for the three acceptance application sites, so the driver can be replayed offline.

**Blocked by:** 04

**Status:** done

- [x] The recorder captures DOM, accessibility tree and geometry for a page and prunes to a documented, versioned shape. **Geometry deliberately omitted, see Landed.**
- [x] A fixture-loading seam exists for tests and is used by the driver and question tests.
- [x] The recorder runs on demand from the developer machine and never during a normal run.
- [ ] Fixtures for Ashby, Greenhouse and Lever are captured by the user and committed, with the capture date and the extension version recorded in each.
- [x] A test proves a fixture round-trips through the loader without losing coverage information.

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

## Lane ownership (this pass)

**Owns:** a new dev-only recorder under `apps/extension/tools/`, the fixture loader in
`apps/extension/test/helpers/`, `apps/extension/test/fixtures/**`, and the two suites it
re-points at recordings (`test/dom-agent-observation.test.ts`,
`test/dom-agent-questions.test.ts`).

**Must not touch:** any file under `apps/extension/src/` (this ticket is a capture and a
seam, not a reader change), anything under `packages/`, and the other lanes' tests.

**Do not launch a browser**, by any means. The recorder is yours to build and the user's to
run; the repository forbids agent-driven browser automation. Prove the pruning and the
round-trip with an injected transport and a synthetic fixture, and leave the three real
captures to the user.

## Landed

The recorder, the loader and the prune are in; the seam is gone because both question
suites now route every page through record, prune, JSON round trip, load and replay, so
the prune is covered by the reader's own tests.

**Deviation, needs overruling or accepting: no geometry.** The spec names DOM,
accessibility tree and geometry. Nothing reads a box, no observation field carries one,
and three committed files of unread data is weight rather than evidence. The fixture's
`version` is the door: if a later reader needs geometry, re-capture with it. Accepting
this means the spec sentence should say so; overruling it means the capture re-runs.

**What the user runs.** Chrome refuses a debugging port on a normal profile, so use a
separate one:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
      --remote-debugging-port=9222 --user-data-dir=/tmp/dom-agent-capture

Open the page in that window, then from the repo root:

    bun apps/extension/tools/capture-fixture.ts --site ashby --match ashbyhq.com
    bun apps/extension/tools/capture-fixture.ts --site greenhouse --match greenhouse.io
    bun apps/extension/tools/capture-fixture.ts --site lever --match lever.co

Each writes `apps/extension/test/fixtures/<site>/application-<date>.json` with the
capture date and the extension version inside. `--dry-run` previews. A skipped test
block in `dom-agent-fixtures.test.ts` starts running against every recording as soon as
one exists, so box 4 needs no further agent work beyond the capture.

## Finding worth carrying

A page read cut at the depth ceiling reported itself complete, hidden by a stand-in that
serves an uncut tree. Filed as `fix-03-reader-truncation.md`, with the mechanism.
