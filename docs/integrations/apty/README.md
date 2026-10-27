# Apty-side integration reference

This folder is hand-off material for **Apty engineering teams** (Widget,
Client, Studio), not code that runs as part of this extension. Nothing
here is compiled into this extension (one test imports the reference
file to check it against the Agent's message schemas) — that's
deliberate, since this describes what needs to exist in *other*
repositories (the Apty Widget/Client/Studio codebases) before the
corresponding diagnostics tool in this extension can return real data
instead of `status: "not_configured"`.

## Files

- **`apty-widget-service-worker.reference.ts`** — a complete reference
  implementation for the Apty Widget's own Manifest V3 service worker:
  safe console-argument serialization, a bounded/persisted/debounced log
  buffer (survives MV3 service-worker restarts), an `observedFetch`
  wrapper that records the Widget's own network calls and keeps response
  bodies per resource, and a sender-validated `onMessageExternal` handler
  matching the exact message contract this extension's consumer already
  implements
  (`packages/browser-runtime/src/apty/service-worker-diagnostics.ts`).
  `packages/browser-runtime/src/apty/widget-reference-contract.test.ts`
  checks its answers against the consumer's schemas.

- **`CLIENT-PATCH.md`**: the changes the Apty Client team makes in the
  Client's build to record its calls, described by behavior.

- **`STUDIO.md`**: what Apty Studio must add (allow-list the Agent's ID,
  answer two messages) so the Agent can read Studio's service worker.

## Extension IDs

The Agent has two IDs, one per package (owner decision D2, default
applied: adopt the Chrome Web Store's ID):

| Package | ID | Used for |
|---|---|---|
| `apty-agent-vX.Y.Z.zip` (keeps the manifest `key`) | `bpiondflhhdplemamgggcdajclmoeple` | Loading unpacked, enterprise installs, development, QA and the e2e tests (`AGENT_EXTENSION_ID` in `tooling/e2e/harness.mjs`) |
| `apty-agent-vX.Y.Z-webstore.zip` (no `key`) | Assigned by the Chrome Web Store when the listing is first uploaded; not known before then | Production installs from the store |

The Apty Client and Apty Studio must list **both** IDs in
`externally_connectable.ids`: the first now, the store's as soon as the
first upload assigns it. Record the store's ID here when it exists. Each
build shows the ID it is running under, with a Copy button, in Settings →
Connection.

## Why a reference file instead of just prose

The message contract, response shape, and persistence design all need to
match exactly what the consumer side expects — copy-pasteable code with
inline reasoning for each design decision is less likely to drift from
that contract than a written spec someone re-implements from scratch. Treat
it as a starting point to adapt to the Widget's actual project structure
and build tooling, not something to drop in unmodified.

## What's still needed from Apty engineering

1. List both of this extension's IDs (see [Extension IDs](#extension-ids))
   in `DEBUG_AGENT_EXTENSION_IDS` in the reference file and in the
   Widget's manifest:
   `"externally_connectable": { "ids": ["bpiondflhhdplemamgggcdajclmoeple", "<the Web Store ID>"] }`.
   The first ID is filled in already; add the Web Store's when it exists.
2. Paste the reference code into the Widget's service worker at the top
   level, so its `onMessageExternal` listener is registered on every
   service-worker start. It answers `list-observed-resources` and
   `get-resource-body` as well as status and logs, inside the same
   sender check.
3. Make the Widget's own requests through `observedFetch` instead of
   `fetch`. Only those are recorded. Calls are kept in
   `chrome.storage.session` (never `chrome.storage.local`): at most 1,000
   calls. Bodies are kept per resource, a resource being the method plus
   the URL without its query string: the body of the latest successful
   call and, separately, of the latest failed call (status 400 or more)
   of each resource, within a total of 2,000,000 characters
   (`MAX_KEPT_BODY_CHARS`; oldest resources' successful bodies go first,
   failed bodies last). A response body over 200,000 characters is not
   served; the Agent hears `found: false, reason: "too-large"`. The list
   answer says `hasBody` per call, and a body request that finds nothing
   says why in `reason` (`too-large`, `evicted`, `unreadable`, `none`);
   both fields are optional, so an older Client or Agent still works. A
   failed storage write is counted and reported as `saveFailures`.
   Console wrapping for the log buffer sits behind `CAPTURE_CONSOLE`
   (default on). For the exact changes in the Client's minified build, see
   [`CLIENT-PATCH.md`](CLIENT-PATCH.md).
   `observedFetch` returns the Response as soon
   as `fetch` does: the body is read afterwards from a clone (reading
   stops at 200,000 characters), recording errors never reach the
   Widget's code, a relative URL is recorded as `fetch` resolves it in
   the service worker, and the calls are written to storage once they
   pause rather than on every call.
4. **Check which context makes the calls.** If the Widget fetches
   `segments.json` and similar from a content script rather than from its
   service worker, the service worker never sees those calls: run
   `observedFetch` in the content script and relay each record to the
   service worker (`chrome.runtime.sendMessage`). We have not been able to
   check which context the Widget uses.
5. Decide where this code actually lives in the Widget's codebase, and
   adapt build tooling/imports accordingly.
6. Give us that Widget extension ID to put in
   `packages/browser-ext/.env` as `VITE_APTY_SERVICE_WORKER_EXTENSION_ID`.
7. Confirm whether Apty has (or is building) any backend log/telemetry
   endpoint instead — if so, the HTTP path
   (`VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT`) is likely a better fit
   than this messaging-based approach; see
   `packages/browser-runtime/src/apty/service-worker-diagnostics.ts`'s
   top-of-file comment and `ARCHITECTURE.md` for that tradeoff.

Widget/Client diagnostics (`window.__APTY_WIDGET__` /
`window.__APTY_CLIENT__`) are a separate, simpler mechanism — see
`packages/browser-runtime/src/apty/widget-diagnostics.ts` and
`client-diagnostics.ts` for those contracts; they don't need anything from
this folder.
