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
| Anthropic: "401: CORS requests must set 'anthropic-dangerous-direct-browser-access' header" | A build before this fix did not send the header Anthropic requires from a browser or extension page | Update the extension; every Anthropic request now sends it. |
| Anthropic: "This API key is not scoped to a workspace … anthropic-workspace-id" | The key can run in several workspaces, so each request must name one | Copy the workspace ID (`wrkspc_…`) from Claude Console → Settings → Workspaces into Settings → AI Configuration → **Workspace ID**, or create a key for a single workspace. |

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

### Widget network calls

The same Client row has **Widget network calls**: **Load network calls**
lists what the Client reports requesting, and **View body** reads one
response, with no AI model involved. It asks the Client only when you click.

| What you see | Cause | Fix |
|---|---|---|
| "Couldn't load the Client's network calls" with "…does not implement the apty-debug-agent:list-observed-resources message" | The Client answers status and logs but not the network messages | The Widget team adds the handlers and `observedFetch` from [`apty-widget-service-worker.reference.ts`](integrations/apty/apty-widget-service-worker.reference.ts) (steps in [`docs/integrations/apty`](integrations/apty/README.md)). |
| "Chrome found nothing listening…" with the manifest line to add | The Client doesn't allow-list this Agent | Add the ID shown to the Client's `externally_connectable.ids`. |
| "The Client reported no network calls." | The Client answered with an empty list: nothing went through `observedFetch` yet, or its calls come from a content script it doesn't relay | Use the widget, then reload. If it stays empty, check which context makes the calls (README step 4). |
| "The Client reported its maximum of 1,000 calls…" | The Client keeps only its most recent calls | Reload sooner after reproducing the problem. |
| "Not fetched: its URL matches … in the body deny list" | Settings → Data handling's body deny list covers this URL | Remove that entry to read this body. |
| "The body is N characters. Redaction takes at most 100,000 characters of text at once…" | The body is over 100,000 characters and could not be redacted value by value: it is not JSON, one value is over 100,000 characters, or text runs from one value into the next. It is withheld rather than shown partly redacted | Nothing to change in the Agent; ask the Client team whether the resource can be split or served smaller. |
| "The Client observed this call but didn't provide its body." | The Client keeps bodies only for its 10 most recent calls, and none over 200,000 characters | Reproduce the call and read it right away. |
| "The Client no longer lists this call." | The Client dropped it since the list was loaded | Load the calls again. |

The Agent can't watch the Client's requests itself: Chrome doesn't show one
extension's requests to another (see `DECISIONS.md`).

## Response bodies are missing from a network capture

Response bodies are off by default. Turn on **Settings → General → Data
handling → Capture response bodies**. Hosts or URL fragments in the
deny-list there are never captured. The Apty Client route ("get
segments.json from the Client") doesn't depend on the switch, but it does
honour the deny-list: a listed resource comes back as `body_denied` with
its metadata only. Remove the entry to read that body.

## DOM Health reports frames it couldn't read

The agent injects its frame script into frames that are missing it, for
example tabs opened before the extension was updated. A frame can still
fail when it is navigating during the audit, or when Chrome blocks
extensions from it (a `chrome://` or Web Store frame). Reload the page and
run the check again.

## Console logs start late, or DOM Health says routing "could not be measured"

The agent runs a small script in each page's own JavaScript world from
the moment it starts loading: it buffers console output and counts
`history.pushState`/`replaceState` calls for DOM Health. A page can notice
it (`history.pushState.toString()` is not native code), so **Settings →
General → Troubleshooting → Track client-side routing and capture console
output from page load** turns it off, and the list under it excludes
sites (a host covers its subdomains; a full match pattern such as
`https://*.example.org/admin/*` works too).

Where it is off or excluded:

- `get_apty_page_logs` returns no console output for that page and says
  why (`coverage.disabledReason`); it does not inject the script on demand.
- DOM Health's application audit reports `routingEvidence: "unavailable"`
  with the reason, instead of "no client-side routing".
- A change applies to pages loaded afterwards; reload open tabs.

Compatibility note: the script is registered by the service worker with
`chrome.scripting.registerContentScripts` (it used to be a static manifest
entry). If it never runs, open the service worker's console from
`chrome://extensions` and look for "[PageHooks] Could not register the
console bridge"; an invalid excluded-site entry is skipped, not fatal.

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
| Options shows "Connection Error" with "WebSocket error", and the daemon logs "invalid or missing token" | Paste the token from the file `node apps/mcp-bridge/dist/daemon.js --print-token-path` prints. Other clients must send it as the `apty-token.<token>` WebSocket subprotocol; a `?token=` URL is refused. |
| Daemon logs "origin … does not match configured extension id" or "no extension id configured" | Pin this Agent's ID once: `node apps/mcp-bridge/dist/daemon.js --set-extension-id <id>`. A running daemon picks it up on the next connection. |
| "The token has characters a WebSocket handshake can't carry" | The pasted token has spaces or line breaks; copy it again. |

See [`apps/mcp-bridge/README.md`](../apps/mcp-bridge/README.md) for setup.

## Skills won't run

Skill execution is off by default (**Settings → General → Skill
execution**). Each script run asks for approval in the side panel. A
skill may import `fs` and the modules bundled with the extension (such as
`fflate`); packages from a CDN are refused, so bundle them into the
script.
