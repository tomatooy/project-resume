# Observe through the debugger protocol, act through a bundled page runtime

A content script cannot see what this design needs to see: real accessibility
semantics, out-of-process frames, closed shadow roots, and control state that
only exists at runtime. Observation therefore goes through the Chrome DevTools
Protocol, which is only reachable from the service worker. Acting is a different
problem with different constraints. `DOM.setFileInputFiles` takes filesystem
paths, while the resume PDF exists only as bytes in memory inside the extension,
and React-controlled inputs need the page's own prototype setters, which live in
the page's main world. So actions run through a small bundled runtime injected
into that main world, exposing a fixed action vocabulary. It never accepts code
from the model, so the debugger buys no general arbitrary-JavaScript capability.

## Considered Options

- **Pure CDP primitives.** No injected runtime, but no command exists that turns
  in-memory bytes into a `File` on a file input, so uploads would have no route.
- **Keep the content script for writes.** Least new code, but execution would be
  confined to one document while observation reached frames and shadow content
  execution could not, producing fields that are visible and unfillable.

## Consequences

- The service worker holds the CDP session. Chrome keeps an MV3 worker alive
  while a debugger session is attached (Chrome 118+, minimum here is 127), so no
  keepalive hack is needed; the run loop must still recover from detach and
  worker restart by re-attaching and re-observing.
- The injected runtime is a second self-contained bundle with its own build
  assertion, alongside the existing content script bundle.
- Attaching displays Chrome's debugging banner for the duration of a run, which
  is why attachment is limited to an active run.
