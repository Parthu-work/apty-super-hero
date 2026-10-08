# Apty Agent privacy statement

Apty Agent is a Chrome extension for debugging web applications and Apty's
own products. It has no Apty server behind it: everything it does runs in
your browser, and the only data that leaves the device goes to services you
configure yourself.

## What leaves your browser

| Destination | What is sent | When |
|---|---|---|
| The AI provider you configure (your own API key) | Your messages, and the results of the tools the agent runs: page text and structure, console output, network request details, screenshots you ask the agent to look at, DOM Health findings | Only while you chat. Nothing is sent before you configure a provider. |
| The Apty Client extension you connect | Requests for its own service-worker logs, status and observed resources | Only when the agent investigates the Client. |
| A local MCP daemon you connect (`localhost` only) | Tool results for the MCP client you run, such as Claude Code | Only while you keep the bridge connected. |

There is no analytics, telemetry, crash reporting or advertising. Apty does
not receive your conversations, keys or page data.

## What the AI provider never sees in the clear

Before any diagnostic data reaches the model, the agent redacts what looks
sensitive: `Authorization`, cookie and API-key headers, tokens, passwords,
email addresses and similar values in console output, request details and
JSON bodies. Redaction is pattern-based, so it can miss secrets in an
unusual shape; avoid investigating pages that hold data you must not share
with your AI provider.

Response bodies of page network requests are **not** captured unless you
turn on **Settings → General → Data handling → Capture response bodies**.
Hosts or URL fragments you add to the deny-list there are never captured.

## What is stored on your device

| Data | Where | How long |
|---|---|---|
| Settings and API keys | `chrome.storage.local`, readable only by the extension's own pages | Until you remove them or the extension |
| Conversations | `chrome.storage.local` | Deleted after 7 days without use; at most 5 are kept |
| Screenshots | The extension's IndexedDB | Deleted after 7 days without use; at most 50 are kept |
| Evidence and investigations from the current session | `chrome.storage.session` | Cleared when the browser closes |
| Remembered approvals ("Allow on this site") | `chrome.storage.local` | 15 minutes, or until revoked |

**Settings → General → Stored conversations and screenshots → Delete stored
data now** removes conversations and screenshots at once. Web pages and
other extensions can't read any of this: storage is locked to the
extension's own pages and service worker.

## Actions on your behalf

The agent asks before it runs JavaScript in a page, fills fields, types,
uploads or downloads files. You approve each action in the side panel, or
allow one tool on one site for 15 minutes. The AI model can't approve its
own actions.

## Permissions

Why the extension needs each Chrome permission is listed in
[`docs/security/PERMISSIONS.md`](docs/security/PERMISSIONS.md). Bookmarks,
history and extension management are optional and are requested only when
you turn them on.

## Contact

Report privacy or security concerns as described in
[`SECURITY.md`](SECURITY.md).
