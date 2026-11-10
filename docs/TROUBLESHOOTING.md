# Troubleshooting

Start with the side panel's Connections page (Menu › Connections, or the
"N to set up" badge under the header). It shows the model in use, the Apty
Client's and Studio's connections and whether Chrome lets the extension
inspect the current page. A card that needs attention says why and has the
action that fixes it.

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
| "The AI provider is rate-limiting requests right now" on a provider with a small per-minute token limit (Groq's free tier allows about 8,000) | One request, or a few close together, is over the provider's limit | In Settings → AI → **Request size**, set **Request budget** under the limit and, if answers are long, an **Answer length cap**. The system prompt and tool descriptions alone can be about 8,000 tokens, so a budget well under that stops most investigations; a provider or plan with a higher limit is the real fix. |
| "This message is larger than the request budget in Settings, even with the earlier turns left out" | The request budget is smaller than the system prompt, the tools offered and the current message together; nothing was sent | Raise **Request budget** in Settings → AI → **Request size**, or ask for less at once. **Details** gives the sizes. |
| In a long chat, the agent no longer knows a detail from the first turns | **Summarize earlier turns** is on in Settings → AI → **Request size**: the earlier turns were replaced by the model's summary, which keeps the gist, not every detail | Repeat the detail in your message, or turn **Summarize earlier turns** off; with it off, a request budget leaves the oldest turns out instead. |
| Anthropic: "This API key is not scoped to a workspace … anthropic-workspace-id" | The key can run in several workspaces, so each request must name one | Copy the workspace ID (`wrkspc_…`) from Claude Console → Settings → Workspaces into Settings → AI → **Workspace ID**, or create a key for a single workspace. |

## The current page can't be inspected

Chrome never lets extensions read `chrome://`, `edge://`, other
extensions' pages or the Chrome Web Store. Switch to the application tab
you want to investigate; the "This page" chip turns green.

## Apty Client

Connect it under **Settings → Connection → Apty Client Extension**:
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
lists what the Client reports requesting, one row per unique request (a
method plus a URL without its query string, so the Client's
`?timestamp=...` cache-busters don't make every call look new), and **View
body** reads a response, with no AI model involved. The header says "N
unique requests (M calls)"; a row shows the latest status, `×3` for three
calls, "1 of 5 failed" when any call failed, and a button that lists its
calls. **View body** reads the newest call of that request that has a body
and says when it is an older one. It asks the Client only when you click.
The chat's `list_extension_network_resources` gives the model the same
unique list, and `inspect_extension_network` falls back to an older call's
body the same way. A message that only asks for one file ("get
segments.json") runs `inspect_extension_network` without the model; add
anything else to the message to have the model read it.

| What you see | Cause | Fix |
|---|---|---|
| "Couldn't load the Client's network calls" with "…does not implement the apty-debug-agent:list-observed-resources message" | The Client answers status and logs but not the network messages | The Widget team adds the handlers and `observedFetch` from [`apty-widget-service-worker.reference.ts`](integrations/apty/apty-widget-service-worker.reference.ts) (steps in [`docs/integrations/apty`](integrations/apty/README.md)). |
| "Chrome found nothing listening…" with the manifest line to add | The Client doesn't allow-list this Agent | Add the ID shown to the Client's `externally_connectable.ids`. |
| "The Client reported no network calls." | The Client answered with an empty list: nothing went through `observedFetch` yet, or its calls come from a content script it doesn't relay | Use the widget, then reload. If it stays empty, check which context makes the calls (README step 4). |
| "The Client reported its maximum of 1,000 calls…" | The Client keeps only its most recent calls | Reload sooner after reproducing the problem. |
| "The Client could not save its call history N times…" | The Client's `chrome.storage.session` write failed (usually its quota), so a Client reload may lose calls | Ask the Widget team to lower the body budget or check the quota. |
| "Not fetched: its URL matches … in the body deny list" | Settings → Data handling's body deny list covers this URL | Remove that entry to read this body. |
| "The body is N characters. Redaction takes at most 100,000 characters of text at once…" | The body is over 100,000 characters and could not be redacted value by value: it is not JSON, one value is over 100,000 characters, or text runs from one value into the next. It is withheld rather than shown partly redacted | Nothing to change in the Agent; ask the Client team whether the resource can be split or served smaller. |
| "The Client observed this call but didn't provide its body." | The Client sent no reason (an older Client), or it keeps bodies per request (the latest success and the latest failure) and none over 1,000,000 characters | Reproduce the call and read it right away. |
| "…over its size limit, so it did not keep it." | The Client read the body but it is over its 1,000,000-character limit | Nothing to change here; the Client doesn't serve it. |
| "The Client no longer has this body: a newer call … or its memory limit, replaced it." | A newer call of the same request replaced it, or the Client's total body budget evicted it | Reproduce the call and read it right away. |
| "The Client could not read this response's body." | The Client could not read the stream | Reproduce the call. |
| "This call has no body." | The call failed before a response, or returned nothing | Nothing to read. |
| "The Client no longer lists this call." | The Client dropped it since the list was loaded | Load the calls again. |

The Agent can't watch the Client's requests itself: Chrome doesn't show one
extension's requests to another (see `DECISIONS.md`).

### Visibility check

A chat message such as "my workflow 'Create a lead' is not visible in the
widget" is checked from these same calls, with no AI model involved.

| What you see | Cause | Fix |
|---|---|---|
| "No data to check" with "No Apty Client extension ID is saved." | No Client is connected | Connect it above, then ask again. |
| "No data to check" with a connection failure | The Client didn't answer | Fix it with the table above; the check says nothing about the content until then. |
| "The Apty Client did not report loading workflow.json" | The widget hasn't requested that file since the Client started | Reload the application with the widget, then ask again. |
| "Not covered" with "This tenant uses 4.x content files…" | A content check of a kind the 4.x pack does not cover yet (it covers flows and the widget), or the selector check | Use the widget or flow check; see [4.x tenant](#4x-tenant). |
| "Needs a check in the browser" | The files show no blocker; whether this user matches a segment's rule is decided in the browser | Test as a user known to match the segment, as the card says. |
| A cause you know is wrong | The files are older than the last publish | Reload the application so the Client fetches them again, then ask again. |
| "No environment's URL pattern matches this page" | The page in this tab is not covered by any environment in `app-urls.json` | In Admin, add the exact host users open to the right environment, publish and reload. |
| "…has a URL pattern for this site that does not cover this page" | The environment's pattern holds a page-specific path | Set it to the application's base URL in Admin (change a test environment first). |
| WNV-08: "…with the regex URL flags on…" | The files come from a 4.x Client, or do not say which player read them, and the tenant's regex URL flags (`urlRegex`, `regExpUrl`) would change which environment this page gets. A 5.x tenant never gets WNV-08: its player never turns the flags on (they are `false` in its defaults and nothing fetches the tenant's values), so the check decides with wildcard matching alone | Ask whether the tenant has the flags on (4.x Admin); then compare the patterns the card names. |
| "…wins on this page; … also matches" | Two environments match and the lower order wins, often a Test pattern over the production host | Make the pattern that should not win more specific. |
| "No web page is open in this tab" | The widget check matches the page in the conversation's tab | Open the application page there, then ask again. |
| Preflight: "The body deny list entry … hides …" | A deny-list entry, often a bare host, covers the Client's content files | Remove it in Settings → Data handling, or narrow it to the paths you mean. |

A message that quotes a Console text the KB cards name ("No active
application found", "Error parsing response", "No matching version
found…"), or asks about CSP, CORS, Apty's 404s or the errors in the logs,
runs the logs check instead. It reads the Client's service-worker logs, the
Client's own calls and the console the page-world bridge buffered in this
tab, and names each one it could not read:

| What you see | Cause | Fix |
|---|---|---|
| "The Apty Client's logs could not be read" | The Client answers the network messages but not `apty-debug-agent:get-service-worker-logs` | The Widget team adds the logs handler from the reference ([`docs/integrations/apty`](integrations/apty/README.md)). |
| "No web page is open in this tab, so its console was not read" | The check reads the console of the conversation's tab | Open the application page there, then ask again. |
| "The page's CSP blocked … none from a host the Apty Client uses" | A CSP block that the agent cannot attribute to Apty | Read the Console text: a nonce means a player version with nonce support, a plain block means whitelisting. |
| A CORS problem the check does not show | The browser does not report CORS blocks to the page | Read the Console and the Network tab yourself; the card lists this under "Not checked". |

A message that names a tooltip, launcher, validation or workflow and says
Apty cannot find its element (or it is on the wrong element, the selector
stopped working, a step fails) runs the selector check. It runs the item's
stored selector in every frame of this tab; "Apty cannot select any
elements on this page" runs the page check on DOM Health's audit instead:

| What you see | Cause | Fix |
|---|---|---|
| "The steps of … are in its own file, which the Apty Client has not loaded" | The Client loads a workflow's steps when it plays | Play the workflow once in this tab, then ask again. |
| "No web page is open in this tab, so the selector was not run" | The check runs the selector in the conversation's tab | Open the page where the content should show there, then ask again. |
| "… is identified by JQUERY/CUSTOM_SCRIPT, which is code the check does not run" | The check never runs the application's code | Run that selector in the Console on the page yourself. |
| "… matches nothing in the frames that answered; N frame(s) did not answer" | A frame, often cross-origin, did not answer the agent | The element may be in it: check that frame in DevTools. |
| "… matches nothing on this page, which is expected if it runs on another page" | A workflow step on a different page | Name the failing step ("step 3") with its page open in this tab. |

A message that names no content kind but says the widget is missing, works
in one environment only, or works on some pages only runs the widget check
instead. A message that names a language ("…for French users") also checks
that the item has a name in it.

### Checking a HAR file

Menu › Check a HAR file runs the same checks on a HAR a customer recorded,
with no Client connected.

| What you see | Cause | Fix |
|---|---|---|
| "No Apty content files in this HAR" | The HAR was recorded without the widget's calls, or in Extension mode, where the Client fetches its files in its service worker | Record again with the widget open and Preserve log on; in Extension mode, open the Apty Client's service worker from `chrome://extensions` and export the HAR there. |
| "This HAR has no page request…" with the widget check | The capture has only the Client's calls (a service-worker HAR), so there is no page to match | Record the page itself too, or ask about the widget in a tab on that page with the Client connected. |
| A file you see in the HAR is not listed or not read | Only calls under a `tenant-<id>` path count as Apty's, so a file of the same name from another service never stands in for the Client's | Check that the HAR holds the Client's own calls; a file under another path is left out on purpose. |
| "This file is over 50 MB…" | The check reads files up to 50,000,000 characters | Record only the problem flow, with fewer pages, and export again. |
| "…matches the body deny list entry…" on the card | Your deny list covers the HAR's Apty files as it does the Client's | Remove or narrow the entry in Settings → Data handling. |

### Ask Dapty check

A message about the widget's AI assistant ("Dapty suggested a workflow
but nothing opens", "the AI assistant is not answering") runs the Ask Dapty
check, and the HAR page offers "The Ask Dapty chat". See
[`docs/development/ask-dapty.md`](development/ask-dapty.md).

| What you see | Cause | Fix |
|---|---|---|
| "No Ask Dapty chat call or stored chat was found" | The chat was before the agent started, or in Extension mode the Client does not report the chat yet, or a HAR was recorded without it | Ask Dapty again on the page in this tab, then ask for the check; or record a HAR with the widget's chat open. |
| "No answer to the last question was recorded" with "Record the next Ask Dapty chat" | Injected mode: the question is captured all the time, the answer only while the tab is recorded | Press the button, ask Dapty again on the page, then ask for the check again. Chrome shows its "is debugging this browser" bar while recording. |
| DAP-04 with "have no https:// scheme" | An environment URL such as `crm.example.com/*` lets the player load the widget but allows no origin in ai-service's CORS check | Add the address with its `https://` scheme to the environment in Admin and publish; ai-service caches the URLs for up to 5 minutes. |
| DAP-06 "not published here" | Dapty suggests from ai-service's own copy of the content files, which can lag a publish, or the model named an item it was not given | Publish the item to this environment, or ask again a few minutes after publishing. |
| "Matched by name: the chat panel does not show the suggestions' ids" | The chat was read from the widget's chat panel, which shows names only | Check a recorded chat call (HAR or the Client's record) for ids. |
| Support asks for the Ask Dapty evidence bundle | The live-tenant test needs the card's evidence (sources tried, timings, file shapes) | Turn on Settings → Troubleshooting → Developer tools, ask the check again, click **Export evidence** on the card, review the JSON and download it. It holds no conversation text, URL or id. |
| "The stored chat, which has the ids, was not read: … an Apty ID that only the Apty Client can read" | The application identifies users by Apty's own ID, which the Client keeps in its extension storage | Expected until the Client reports the chat; a HAR with the chat open has the ids. An application that identifies users from the page (a window variable, session or local storage) needs nothing. |
| "Content files read from Apty's content CDN" | The Apty Client does not report its calls, so the check read the same public files the Client reads | Nothing to do: this is how Extension mode works with today's Client. |
| "Apty was not found on this page" | No Client answered, the page sets no injected player config, and no Apty Client script is on it | Reload the page with Apty installed, or check the Client is enabled for this site. |

## Knowledge base

| Symptom | Cause | Fix |
|---|---|---|
| Import refused (too large, not a pack, schema version, malformed, checksum) | The file is not a pack this Agent reads, or was changed or cut | See the error table in [`kb-rag.md`](development/kb-rag.md#troubleshooting) |
| Every question is "not covered" | Coverage settings too strict, or no pack for the tab's Apty version | Ask the KB owner for a calibrated pack; import the tab's version, or pick "Not sure" |
| Cards of the wrong Apty version | The tab's version is unknown or was picked wrongly | Pick the version on the KB matches or verdict card |
| No KB card although no AI key is needed | The message reads as a bare how-to, or nothing covers it | Name the symptom. The KB answers symptoms, not how-to questions (D-KB1); for how to configure something, use the Apty product documentation or ask the KB owner. |
| "Not found in the cited KB cards: …" under an answer | The model named a setting no returned card holds | Treat that setting as unverified; ask again naming the card's own words |
| "unknown citation" in an answer | The model cited a card its search did not return | Ignore that citation |

The full table, with the cause of each import error and the KB owner's
side, is in [`docs/development/kb-rag.md`](development/kb-rag.md#troubleshooting).

## 4.x tenant

| Symptom | Cause | Fix |
|---|---|---|
| The verdict has no data and the Apty Client cannot be reached | The 4.x Client has no Agent bridge | Injected mode: **Capture and reload** on the verdict card. Extension mode: save a HAR from the 4.x Client's service worker (the card lists the steps) and check it on the HAR page |
| "Captured 0 Apty calls" | The player runs in Extension mode, so the page makes no content call | Use the service-worker HAR |
| The HAR check cannot match the widget to an environment | A service-worker HAR has no page request | Tick "Use the page open in this tab" before **Check** |
| A 4.x finding says "not runtime-verified" | The 4.x checks follow the 4.x behaviour FIXES.md K14 describes, not yet checked against apty-assist code (D-KB7, K21 F4), so a finding is at most "possible" | Confirm the cause on the tenant; report a wrong one with its rule id |
| A selector check stops at "4.x content files" | The selector check is not ported to 4.x yet | Use the widget and flow checks, or check the element by hand |

See [`docs/integrations/apty/README.md`](integrations/apty/README.md#4x-tenants).

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
