# Recorded pages

A recording is one application page, frozen as the protocol payloads the reader
consumes: the DOM tree and the accessibility tree, per browser context. The
driver replays it offline, so the reader can be tested against a real ATS page
without driving a browser, which this repository forbids an agent from doing.

No recordings are committed yet. The three acceptance sites are captured by
hand, by the user, with the recorder in `tools/`.

The one HTML file here, `ashby-application.html`, is not a recording. It is a
reduced markup sample kept from the retired engine, with no capture date and no
extension version, so `buildPage` can read it and the loader cannot. It is worth
knowing about because it is real Ashby markup and it holds the
`<button aria-pressed="false" data-option="yes">` pattern that ticket 06a is
blocked on, but it is a page fragment rather than a page, and it is not a
substitute for a recording.

## Capturing one

Chrome will not open its debugging port on the profile you browse with, so give
the capture its own:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/dom-agent-capture
```

Open the application page in that window (no need to fill anything), then run
one of these from the repository root:

```sh
bun apps/extension/tools/capture-fixture.ts --site ashby --match ashbyhq.com
bun apps/extension/tools/capture-fixture.ts --site greenhouse --match greenhouse.io
bun apps/extension/tools/capture-fixture.ts --site lever --match lever.co
```

Each run writes `apps/extension/test/fixtures/<site>/application-<date>.json`,
prints what it read, and loads the file back through the same decoder the tests
use. `--dry-run` prints without writing, `--name <label>` names the page within
a site, and `--port` follows a browser started somewhere else.

A page that captures incompletely is still worth committing: a frame that
refused the read is recorded as refusing, and the replay reports the same
coverage gap the live run would have.

## What is in a file

```json
{
  "kind": "dom-agent-fixture",
  "version": 1,
  "capture": { "site", "url", "capturedAt", "extensionVersion", "method" },
  "contexts": [
    { "kind": "document" | "frame", "sessionId", "url",
      "document": <DomNode> | null, "ax": [<AxNode>], "axFailed": false }
  ]
}
```

`sessionId` is null for the tab and the capture's session for a frame, which is
how the replay addresses a context. `document` is null for a context that
refused the read. The capture is unbounded: the whole tree, so a replay can
answer a later read at any depth.

The recorder asks for what the reader reads, and drops the rest, because a file
with every field Chrome reports is too big to commit:

- **DomNode**: `nodeId` is dropped. It is a frontend handle for acting on a
  node, and both the reader and the recorder address nodes by `backendNodeId`.
- **AxNode**: `childIds`, `parentId` and `ignored` are dropped, as is every
  accessibility property except `checked`, `disabled`, `multiselectable`,
  `readonly`, `required` and `selected` (the six the reader asks for by name).
  A node without a `backendDOMNodeId` is dropped too: the reader indexes the
  accessibility tree by that id, so such a node is unreachable.
- **Nodes are never dropped and `childNodeCount` is never recomputed.** A parent
  whose recorded count exceeds the children it carries is how the reader sees a
  subtree cut at the ceiling, so tidying the two apart would invent losses.

The consequence is stated plainly: if a later reader needs a field this prune
dropped, that field is gone and the page has to be captured again. The prune is
a whitelist, not a policy, and `test/dom-agent-fixtures.test.ts` pins both
halves: what survives, and that a pruned recording reads exactly as the payload
it came from.

## What is not captured

Geometry. The spec's test lane says DOM, accessibility tree and geometry, and
the reader never asks for geometry: nothing calls `DOM.getBoxModel`, no
observation field carries a box, and a fixture field nothing reads is weight in
three committed files. `version` is the door for it: a consumer means a version
bump and a re-capture, and the recorder reads the whole tree either way.

## Replaying one

```ts
const fixture = loadFixture("ashby/application-2026-10-14.json")
const { session, harness } = await attachPage({ transport: pageFromFixture(fixture) })
emitRecordedFrames(harness, fixture)
const read = await observePage({ session })
```

`pageFromMarkup` is the same path with a page built from markup, which is what
the reader and question suites use, so every test in them runs against a
recording rather than a payload handed straight to the transport.

The replay cuts the recorded tree to the depth a read asks for, because the
browser would have. That model is the one thing here not taken from a browser:
Chrome's `depth` is read as counting levels below the root, so a read at 40
receives 41 levels. A recording made with this recorder is what settles it, and
the reader's behaviour under a cut tree is recorded in
`test/dom-agent-fixtures.test.ts`: past the ceiling, a page speaks too
confidently today, and that is a reader change rather than a recorder one.
