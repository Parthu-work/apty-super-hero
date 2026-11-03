# 5.x Apty Client test-recorder build

**For testing only. Never give this build to a customer.**

A copy of a 5.x Apty Client (WXT Chrome build) that reports its own calls
and the Widget's Ask Dapty chats to the Apty Agent, so SEs can test the
Agent's record path (the Client's record and the Widget's own
conversations, in [`docs/development/ask-dapty.md`](../../development/ask-dapty.md))
before the Client team ships the changes in [`CLIENT-PATCH.md`](CLIENT-PATCH.md).
It replaces the hand-made build: the same input always gives the same
changes, and they are reviewable here.

## What it changes

`tooling/scripts/build-client-test-recorder.mjs`:

- **`background.js`**: puts in front of the Client's own bundle, which is a
  classic script (`var background=(function(){…`):
  - the reference module
    ([`apty-widget-service-worker.reference.ts`](apty-widget-service-worker.reference.ts)),
    compiled with esbuild to an IIFE (`__aptyDebugRef`, `chrome116`). Its
    `fetch` is the browser's own, captured before the Client runs, so the
    recorder never records itself. It answers the Agent's status, logs,
    network and `get-widget-chat` messages, for the Agent's IDs only;
  - a `fetch` wrapper. The widget chat call
    (`/ai-service/api/v1/ai/{tenant}/widget/chat`, and `/stream`) and the
    content files (`/tenant-…/*.json`) go through `observedFetch`. A storage
    save (`POST …/widget-storage-service/api/v1/storage`) whose JSON body's
    `key` ends in `/widget-chat/{id}.json` (not `chat-list.json`) passes
    its `data.id`, `data.name` and `data.messages` to
    `recordWidgetChatTurn`, from an `init.body` string or from a `Request`
    (axios sends one), and then goes out unchanged. Every other call goes
    straight to the original `fetch`, so analytics and the event gateway
    are never recorded.
- **`manifest.json`**: `externally_connectable.ids` set to the real IDs in
  the reference's `DEBUG_AGENT_EXTENSION_IDS` (today
  `"bpiondflhhdplemamgggcdajclmoeple"`; `<the Web Store ID, once assigned>`
  is added when it exists), the name followed by " (test recorder)", and
  each `--match` pattern added to every content script's `matches`.
- **`TEST-BUILD.txt`**: says it is not for customers, and records this
  repository's commit and the build date.

It refuses an input that is not a 5.x WXT build: no `player-config.json`
(a 4.x Client has `config.json`), `window-script.js` not web-accessible, or
a module service worker. The 4.x Client has its own hand-patched build and
is not covered.

## Build it

From the repository root, with dependencies installed (`pnpm install`),
and `zip` and `unzip` on the path:

```bash
node tooling/scripts/build-client-test-recorder.mjs apty-client-5.2.0.1-chrome.zip apty-client-5.2.0.1-test-recorder.zip
```

To load the Client on a test application its manifest does not list, add
one or more `--match` patterns:

```bash
node tooling/scripts/build-client-test-recorder.mjs apty-client-5.2.0.1-chrome.zip apty-client-5.2.0.1-test-recorder.zip --match "https://test-app.example.test/*"
```

## Load it

1. Remove or turn off the store-installed Apty Client in
   `chrome://extensions` (two Clients on one page conflict).
2. Unzip the test-recorder build, turn on Developer mode, and choose
   **Load unpacked** on the folder. Its name ends in "(test recorder)".
3. Load the Apty Agent unpacked (`apty-agent-vX.Y.Z.zip`), whose ID is the
   pinned `bpiondflhhdplemamgggcdajclmoeple`. A Web Store install of the
   Agent has another ID, which this build allows only once it exists.
4. In the Agent, Settings → Apty Integration → Apty Client: **Detect** or
   paste the test-recorder's ID, then **Connect**.

## Tested by

- `tooling/scripts/build-client-test-recorder.test.mjs`: the changes, and
  the refusal of a build that is not 5.x.
- `tooling/e2e/client-test-recorder.e2e.test.mjs`: a fake 5.x Client
  (`tooling/e2e/fixtures/fake-5x-client`) built and loaded next to the
  Agent; its service worker fetches a content file, makes the chat call
  and an analytics call, and saves a stored chat as a `Request`. The Agent
  then gets its status, the recorded calls (the chat's request body there,
  analytics not) and the chat's turns with the suggestions' ids.
