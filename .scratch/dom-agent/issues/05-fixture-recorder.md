# 05: Fixture recorder and captures

**What to build:** A dev-only capture that writes a versioned fixture for one page, and the fixtures themselves for the three acceptance application sites, so the driver can be replayed offline.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The recorder captures DOM, accessibility tree and geometry for a page and prunes to a documented, versioned shape.
- [ ] A fixture-loading seam exists for tests and is used by the driver and question tests.
- [ ] The recorder runs on demand from the developer machine and never during a normal run.
- [ ] Fixtures for Ashby, Greenhouse and Lever are captured by the user and committed, with the capture date and the extension version recorded in each.
- [ ] A test proves a fixture round-trips through the loader without losing coverage information.
