# 4.x Client bridge (ready to apply in apty-assist)

Owner decision [D-KB9](../../tasks/kb-rag/decisions.md#d-kb9-how-the-agent-gets-a-4x-tenants-calls).
This describes, by behaviour, the change the 4.x Client team makes in
`aptyInc/apty-assist` so the Agent can read a 4.x Extension-mode player's
content calls the way it reads a 5.x Client's. No apty-assist code is copied
here. Until it ships, the Agent reads 4.x calls from the page's network
capture (Injected mode) or from a HAR saved from the 4.x Client's service
worker (Extension mode); see [README.md](README.md#4x-tenants).

## Why the Agent cannot reach a 4.x Client today

- In Extension mode the 4.x player fetches every content file by sending a
  message to its own background (`chrome.runtime.sendMessage`,
  `player3.0/src/api/http.ts`, around line 249), which then fetches. Those
  requests belong to the Client's service worker, not to the tab, so the
  Agent's tab-level DevTools capture never sees them.
- The 4.x Client's manifests declare no `externally_connectable`, so the
  Agent cannot message it.
- The Agent's content CDN fallback (`packages/browser-runtime/src/apty/diagnosis/apty-files.ts`)
  finds the 5.x Client's `player-config.json` only.

## The change

1. **Allow the Agent.** In each 4.x player manifest, add:

   ```json
   "externally_connectable": { "ids": ["bpiondflhhdplemamgggcdajclmoeple", "<the Web Store ID>"] }
   ```

   Both IDs are listed in [README.md](README.md#extension-ids); add the Web
   Store's when it exists. Nothing else changes for web pages.

2. **Record the content calls.** In `player3.0/src/background-scripts/`,
   where the background answers the player's `GetDataFromCDN` message, record
   each call in a ring buffer kept in `chrome.storage.session` (never
   `chrome.storage.local`), at most 1,000 calls:
   - the URL with any token or signature query parameter removed;
   - the HTTP status, or the network error's name;
   - the start time and duration;
   - the response body of the latest successful and of the latest failed
     call per resource (method plus URL without its query string), within
     the same limits as the 5.x contract: 1,000,000 characters per body,
     2,000,000 kept in all, oldest successful bodies dropped first;
   - bodies whose path matches the deny list the 5.x reference uses are
     never kept (`apty-widget-service-worker.reference.ts`).

   Recording never changes what the player receives: the response goes back
   to the player first, and a recording error is swallowed and counted.

3. **Answer the Agent.** Register one `chrome.runtime.onMessageExternal`
   listener at the top level of the background, so it is registered on
   every service-worker start. It checks `sender.id` against the two IDs
   above and ignores every other sender. It answers the existing
   `apty-debug-agent:*` messages with the same shapes as the 5.x Client:
   `get-status`, `list-observed-resources`, `get-resource-body` and
   `get-logs`; the schemas are in [`schemas/`](schemas/) and the reference
   handler is `handleNetworkMessage` in
   [`apty-widget-service-worker.reference.ts`](apty-widget-service-worker.reference.ts).
   If the background already has an external listener, end it with the
   reference handler instead of adding a second one.

4. **Tell the Agent it is 4.x.** `get-status` answers `version` with the
   4.x player's version string. The Agent also tells 4.x from the file
   names it lists (`flow.json`, `segments.json`, `rules.json`,
   `feature-flag.json`, `flow-<id>.json`; see `playerVersionOf` in
   `packages/browser-runtime/src/apty/diagnosis/pack-kit.ts`).

## What changes in this repository

Nothing. Once the bridge ships, Options → Connection → Apty Client →
Detect finds the 4.x Client, `inspect_extension_network` lists its calls,
and the 4.x check packs read its files like any other evidence.

## How to test it

1. Build the 4.x Client with the change and load it unpacked.
2. In the Agent, Options → Connection → Apty Client → paste the 4.x
   Client's extension ID → Connect. Preflight's Apty Client row turns
   green.
3. Open a 4.x tenant in Extension mode, ask "widget not showing": the
   verdict card reads "from the Apty Client's files" and names 4.x rules
   (`W4X-…`).
