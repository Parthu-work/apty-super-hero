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

- **`TEST-RECORDER.md`**: a reproducible test-only build of a 5.x Client
  that reports its calls, for SEs; never for customers.

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
first upload assigns it. Record the store's ID here when it exists, in the
same commit that sets `AGENT_WEB_STORE_ID` in
`tooling/scripts/check-extension-id.mjs` and replaces every placeholder
(`npm run audit:extension-ids` checks they agree). Each
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
   sender check. If the service worker already has an
   `onMessageExternal` listener (the Apty Client does), leave out the
   reference's listener and end the existing one with
   `return handleNetworkMessage(message, sendResponse)`; two listeners
   answering one message is a race.
3. Make the Widget's own requests through `observedFetch` instead of
   `fetch`. Only those are recorded. Calls are kept in
   `chrome.storage.session` (never `chrome.storage.local`): at most 1,000
   calls. Bodies are kept per resource, a resource being the method plus
   the URL without its query string: the body of the latest successful
   call and, separately, of the latest failed call (status 400 or more)
   of each resource, within a total of 2,000,000 characters
   (`MAX_KEPT_BODY_CHARS`; oldest resources' successful bodies go first,
   failed bodies last). A response body over 1,000,000 characters is not
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
   stops at 1,000,000 characters), recording errors never reach the
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

## When the Client reports nothing

Until the Client adopts the changes below, the Agent reads the same public
content files the Client reads (and the user's stored Ask Dapty chat) from
Apty's content CDN, with no credentials, using the `contentURL` and
`tenantId` of the Client's web-accessible `player-config.json`
([`docs/development/ask-dapty.md`](../../development/ask-dapty.md)). Product
or Security can turn this off in **Settings → Apty Integration → Apty
Client: content CDN**; the Agent then only messages the Client.

## Ask Dapty in extension mode

When the Apty Client runs as an extension, the Widget's AI assistant ("Ask
Dapty") calls `POST {aiBackendURL}/ai-service/api/v1/ai/{tenantId}/widget/chat`
from the Client's service worker
(`background-script-ipc.service.ts`). Chrome does not let the Agent see
that call: `chrome.webRequest` does not report another extension's
requests, and `chrome.debugger` refuses to attach to another extension's
worker. The Agent checks the chat only from what the Client reports. These
changes are additive: an older Client still answers every other message,
and an older Agent ignores the new fields.

What the Widget team must change:

1. **Route the chat call through `observedFetch`** with its body as a string
   (`body: JSON.stringify({ message, context, envId, applicationType })`).
   The reference keeps the request body of the resources in
   `REQUEST_BODY_RESOURCES` (today the chat POST and its `/stream` variant)
   and lists it as `requestBody` on the call. Only a string or
   `URLSearchParams` body of at most 1,000,000 characters is kept; a
   `Request` object's body is not read. For these resources the last 20
   calls keep their bodies (request and response), instead of one body per
   method and URL. They count toward the same 2,000,000-character budget and
   are evicted after the other successful bodies.
2. **Call `recordWidgetChatTurn(chatId, name, messages)` after each turn**,
   with the chat's whole message list as the Widget stores it
   (`{ id, role, content, suggestions? }`, the shape of
   `widget-chat-storage.service.ts`). Call it in the service worker, where the
   chat reply arrives in extension mode; a content script relays it with
   `chrome.runtime.sendMessage`. The reference keeps the newest 10 chats, the
   last 50 turns of each and 20,000 characters per text, in
   `chrome.storage.session` only. Roles other than `user`, `assistant` and
   `system` are left out.
3. **Answer `apty-debug-agent:get-widget-chat`.** `handleNetworkMessage`
   already does, inside the same sender check, so a Client whose listener
   ends with `return handleNetworkMessage(message, sendResponse)` needs no
   other change. The answer is
   `{ ok: true, chats: [{ chatId, name, turns: [{ role, text, suggestions?: [{ id, name, type }] }] }] }`,
   oldest chat first; `id` is the suggestion's `sourceId`.

The chat text is the end user's own content. The Agent reads request bodies
only when its Ask Dapty check asks for them, never logs them, and redacts
them before anything is shown or sent to a model.

Widget/Client diagnostics (`window.__APTY_WIDGET__` /
`window.__APTY_CLIENT__`) are a separate, simpler mechanism — see
`packages/browser-runtime/src/apty/widget-diagnostics.ts` and
`client-diagnostics.ts` for those contracts; they don't need anything from
this folder.

## 4.x tenants

The 4.x Client cannot be messaged by the Agent today: its manifests have no
`externally_connectable`, and in Extension mode its player fetches content
through its own background, which the tab's network capture does not see.
Until the bridge in [`4X-BRIDGE.md`](4X-BRIDGE.md) ships in apty-assist,
the Agent reads a 4.x tenant's content files from:

- **Injected mode:** the page's own network capture. The player fetches
  from the page, so a check reads the files from the tab's capture (running,
  or stopped in the last 15 minutes). With none, a widget or content
  verdict with no files offers **Capture and reload**: the Agent captures
  the tab, reloads it, waits until the Apty calls stop (2 s with no new one,
  at most 20 s) and runs the same check on what it captured. It keeps whole
  bodies of Apty content calls only (a `tenant-…` path), through the body
  deny list and redaction.
- **Extension mode:** a HAR saved from the 4.x Client's service worker. The
  verdict card lists the steps:
  1. Open `chrome://extensions`, turn on **Developer mode**.
  2. Find the Apty extension (the 4.x Client) and click **service worker**
     under "Inspect views".
  3. In that DevTools window open **Network** and tick **Preserve log**.
  4. Reload the application tab and reproduce the problem.
  5. In the service worker's Network panel, right-click → **Save all as HAR
     with content**.
  6. Open Menu › **Check a HAR file** in the side panel and choose the HAR.
     A service-worker HAR has no page request, so tick "Use the page open in
     this tab: …" to check the widget against the page you confirm.

The 4.x checks (`W4X-…` widget rules, `C4X-…` flow rules) follow the 4.x
behaviour FIXES.md K14 describes; they are not yet checked against
apty-assist code nor runtime-verified (owner decision D-KB7), so a 4.x
finding is at most "possible" (K21 F4). The bridge
that would let the Agent read a 4.x Client like a 5.x one is described,
ready to apply in apty-assist, in [`4X-BRIDGE.md`](4X-BRIDGE.md).
