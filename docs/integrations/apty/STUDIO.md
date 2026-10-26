# Apty Studio: letting the Agent read its service worker

For the Apty Studio team. Nothing here changes Studio by itself; it says
what Studio must add so the Apty Agent can read Studio's service-worker
status and logs, the same way it already reads the Apty Client's.

## Why nothing works today

Studio's `manifest.json` declares `externally_connectable` with web
`matches` only and no `ids`. Chrome then refuses every message from
another extension, including the Agent. The Agent reports this as
`not_allowlisted` (Chrome: "Could not establish connection. Receiving end
does not exist.") and shows the fix below in Settings → Connection →
Apty Studio Extension.

## What Studio needs

1. **Allow-list the Agent.** Keep Studio's existing web `matches` and add
   the Agent's ID:

   ```json
   "externally_connectable": {
     "matches": ["…Studio's existing entries…"],
     "ids": ["bpiondflhhdplemamgggcdajclmoeple"]
   }
   ```

   The ID above is the Agent's pinned development and enterprise ID (from
   its manifest `key`). The Web Store build gets a different ID from the
   store at its first upload; add that one too
   ([Extension IDs](README.md#extension-ids)). The Studio row in the
   Agent's Settings shows the running ID and this snippet with a Copy
   button.

2. **Answer the Agent's messages.** Register
   `chrome.runtime.onMessageExternal` at the top level of Studio's service
   worker (not inside an async callback, or a woken worker misses the
   first message). Answer only messages whose `type` starts with
   `apty-debug-agent:` from an allow-listed `sender.id`, and return `false`
   for everything else, so Studio's other listeners keep working:

   | Message `type` | Answer |
   |---|---|
   | `apty-debug-agent:get-service-worker-status` | `{ running: boolean, lastActivity?: number }` |
   | `apty-debug-agent:get-service-worker-logs` | `{ logs: [{ level: "debug" \| "log" \| "info" \| "warn" \| "error", message: string, timestamp: number }] }` (at most 2,000 entries; messages up to 10,000 characters) |

   This is the same contract the Apty Client implements; the reference
   implementation is `apty-widget-service-worker.reference.ts` in this
   folder (sender validation, a bounded log buffer in
   `chrome.storage.session` that survives worker restarts). Studio does
   not need the resource verbs (`list-observed-resources`,
   `get-resource-body`) unless it wants the Agent to read its requests.

3. **Redact at the source.** Do not put tokens, cookies, user names or
   customer data in log messages. The Agent redacts every log line again
   before the model or the side panel sees it, in the user's chosen
   redaction mode (strict by default), but the safest log line is one
   that never held the secret.

The Agent's existing `apty-debug-agent:get-studio-status` message
(`get_apty_studio_diagnostics`: active, selection mode, last selector)
stays optional.

## How to check it

1. Load Studio and the Agent. In the Agent: Settings → Connection →
   **Apty Studio Extension** → **Detect** (or paste Studio's ID) →
   **Connect**.
2. **Expected:** "Answering". Otherwise the card names the problem:
   - "Chrome found nothing listening in the Apty Studio …" and "Apty
     Studio's manifest must list this Agent ID in
     externally_connectable.ids: "…"": step 1 is missing;
   - "… received the message but answered nothing …" or "… never
     answered …": step 2 is missing or the handler does not answer
     `get-service-worker-status`;
   - "… answered with an unexpected shape …": the answer does not match
     the table.
3. In the Agent's side panel ask: "show apty studio's service worker
   logs". **Expected:** the status and recent log lines
   (`get_apty_studio_service_worker_diagnostics`).

## What the Agent does with the data

- Stores Studio's ID at `peers.studio.extensionId` in its own
  `chrome.storage.local` (an older `studioExtensionId` is still read).
- Sends only the two messages above, only to that ID, only when the user
  asks (Connect, Test connection, or a chat that needs it).
- Keeps warnings and errors as evidence for the current conversation, in
  memory and in `chrome.storage.session` (cleared when the browser
  closes). Nothing is sent anywhere except to the user's own AI provider,
  redacted.

The Agent-side code: `packages/browser-runtime/src/apty/peers.ts` (one
peer abstraction for the Client and Studio),
`service-worker-diagnostics.ts` (the handshake and validation), and
`apps/browser-extension/src/entrypoints/options/apty-client-panel.tsx`
(the Settings rows). End-to-end tests with fixture Studio extensions:
`tooling/e2e/studio.e2e.test.mjs`.
