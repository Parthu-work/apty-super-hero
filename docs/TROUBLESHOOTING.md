# Troubleshooting

Start with the side panel's readiness chips, above the suggested
investigations. Each one shows the model in use, the Apty Client's
connection and whether Chrome lets the extension inspect the current page.
A chip that needs attention says why and links to the setting that fixes it.

When reporting a problem, turn on **Settings → General → Troubleshooting →
Verbose logging**, reproduce it, and copy the logs from the side panel's
DevTools (right-click the panel → Inspect) and the service worker's
DevTools (`chrome://extensions` → Apty Agent → "service worker"). Logs stay
on your machine. They can include page content such as URLs, element names
and skill output, so read them before sharing, and turn the switch off
afterwards.

## The agent won't answer

| What you see | Cause | Fix |
|---|---|---|
| "Connect an AI provider" when sending | No API key or model is saved | Click **Set up AI provider**, fill in the key and model, then **Save Settings**. Typing a key turns the provider on. |
| "Connection test timed out" | The AI Host field points at a website, not an API endpoint, or the host is unreachable | Clear AI Host to use the provider's default, or enter its API base URL. |
| Every reply fails with an authentication error | The key is wrong, expired or for another provider | Paste a fresh key and click **Test Connection**. |

## The current page can't be inspected

Chrome never lets extensions read `chrome://`, `edge://`, other
extensions' pages or the Chrome Web Store. Switch to the application tab
you want to investigate; the "This page" chip turns green.

## Apty Client

Connect it under **Settings → Apty Integration → Apty Client Extension**:
paste its 32-character ID (or use **Detect**, which needs the optional
"Manage extensions" permission) and click **Connect**. The panel shows this
Agent's own ID, which the Client must allow-list.

| Message | Cause | Fix |
|---|---|---|
| "Chrome found nothing listening in the Apty Client for this extension" | The Client doesn't list this Agent's ID in `externally_connectable.ids`, or registers no `onMessageExternal` handler at the top level of its service worker | Add the Agent's ID (shown in the panel) to the Client's manifest and reload the Client. |
| "The Apty Client received the message but answered nothing" | The Client's handler doesn't implement `apty-debug-agent:get-service-worker-status` | Install the Agent bridge module in the Client's service worker; see [`docs/integrations/apty`](integrations/apty/README.md). |
| "…never answered, even after a retry" | The bridge module is missing, or the Client's service worker is stuck | Check `chrome://extensions` for errors on the Client, then reload it. |
| "…answered with an unexpected shape" | The Client's bridge module is older than this Agent | Update the bridge module. |
| "could not be found or is not currently available" | The ID is wrong, or the Client is disabled | Copy the ID again from `chrome://extensions`. |

## Response bodies are missing from a network capture

Response bodies are off by default. Turn on **Settings → General → Data
handling → Capture response bodies**. Hosts or URL fragments in the
deny-list there are never captured. The Apty Client route ("get
segments.json from the Client") doesn't depend on this setting.

## DOM Health reports frames it couldn't read

The agent injects its frame script into frames that are missing it, for
example tabs opened before the extension was updated. A frame can still
fail when it is navigating during the audit, or when Chrome blocks
extensions from it (a `chrome://` or Web Store frame). Reload the page and
run the check again.

## An action asks for approval, or is refused

Running page JavaScript, filling fields, typing, uploads and downloads
wait for **Allow** or **Deny** in the side panel. "Allow on this site for
15 min" covers that one tool on that one site; review or revoke these under
**Settings → General → Remembered approvals**.

A request from an MCP client expires after 40 seconds, so the client hears
the answer before its 60-second timeout. With no side panel open, MCP
requests for these actions are refused: open the side panel and retry.

## MCP bridge

| Symptom | Fix |
|---|---|
| Options shows "Unauthorized" or the daemon logs "invalid or missing token" | Paste the token from the file `apty-cli --token-path` prints. Clients must send it as the `apty-token.<token>` WebSocket subprotocol; a `?token=` URL is refused. |
| Daemon logs "origin … does not match configured extension id" | Pin this Agent's ID once: `node dist/daemon.js --set-extension-id <id>`. |
| "The token has characters a WebSocket handshake can't carry" | The pasted token has spaces or line breaks; copy it again. |

See [`apps/mcp-bridge/README.md`](../apps/mcp-bridge/README.md) for setup.

## Skills won't run

Skill execution is off by default (**Settings → General → Skill
execution**). A skill may import only the built-in `fs` module: packages
from a CDN are refused, so bundle them into the script.
