# Recording the Apty Client's network calls: the patch

For the Apty Client team. The Client's build is minified, so this describes
each change by **behavior**, not by function name. The code to add is in
[`apty-widget-service-worker.reference.ts`](apty-widget-service-worker.reference.ts);
this page says where it goes and what to leave alone.

What it gives the Agent: every call the Client makes for its content (CDN
data) and API, with status, time and (kept per request) the response body,
readable in Settings → Apty Client → Widget network calls and by the chat
tools. Nothing leaves the browser: the Agent asks the Client's service
worker over `chrome.runtime.sendMessage`, and only the Agent IDs below are
answered.

## 1. Add the network section and the two verbs

Copy the reference's network section (state, `observedFetch`, retention) and
`handleNetworkMessage` into the Client's service worker. Leave out the
reference's own `chrome.runtime.onMessageExternal` listener at the bottom of
the file. In the Client's **existing** listener, which already checks the
sender against an allow-list and answers `status` and `logs`, end with:

```js
return handleNetworkMessage(message, sendResponse);
```

after those branches. It answers the two network verbs and returns `false`
for anything else:

- `apty-debug-agent:list-observed-resources` answers
  `{ resources: [...calls], saveFailures }`;
- `apty-debug-agent:get-resource-body` answers `{ found, body?, base64Encoded?, reason? }`.

Keep the Client's own status and logs branches as they are. Do not add a
second `onMessageExternal` listener: two listeners both answering one
message is a race. The reference's `CAPTURE_CONSOLE` constant turns off its
console wrapping if the Client already collects its logs another way.

## 2. Replace `fetch` with `observedFetch` in two handlers

In the service worker, the two places that fetch for the rest of the Client:

- the handler for the **`GetDataFromCDN`** message (the Client's content:
  `config.json`, `segments.json`, `rules.json`, `styles.json`, `langs.json`, ...);
- the handler for the **`BackgroundHttpRequest`** message (API calls).

Use `observedFetch(input, init)` where they call `fetch(input, init)`. It
returns the same Response as soon as `fetch` does and never throws into the
Client's code.

## 3. Do not wrap the event-gateway or analytics fetches

They carry gateway keys in headers and would flood the list. The reference
records only the URL, method, status, MIME type and the response body,
**never request headers or request bodies**; leaving those fetches
unwrapped keeps keys out of reach regardless.

## 4. Decide deliberately about API bodies

API responses can contain user data (one call returns `currentUser`).
Recording an API body keeps it in `chrome.storage.session` (in memory, never
on disk, gone when the browser closes) and the Agent can read it on request.
Decide whether to record API bodies at all. If some should not be read, add
their URL fragments or hosts to the deny list in the Agent (Settings → Data
handling → body deny list); a matching URL is never fetched from the Client.
Or make `observedFetch` record the call without its body for those URLs.
The Agent also redacts what it shows (Strict or Standard), but that is a
second line of defense, not the first.

## 5. Known gaps

- The Client's **content script caches API results**, so a repeated API call
  may never reach the service worker and will not be listed.
- Deployments where the **injected Widget** fetches from the page (not from
  the service worker) are not covered: `observedFetch` only sees fetches made
  in the service worker.
- A call is listed once per fetch, but bodies are kept per request (method
  plus URL without query): the latest success and the latest failure.

## 6. List both Agent IDs

Both the Agent's IDs go in the manifest and in the allow-list used by the
sender check (`DEBUG_AGENT_EXTENSION_IDS` in the reference):

```json
"externally_connectable": {
  "ids": ["bpiondflhhdplemamgggcdajclmoeple", "<the Web Store ID, once assigned>"]
}
```

Never `"*"`.

## 7. A Client reload clears the history

`chrome.storage.session` is cleared when the Client extension is reloaded
(and when the browser closes), so calls and bodies recorded before a reload
are gone. The history survives the service worker being suspended and
restarted. If a storage write fails (usually quota), the list answer carries
`saveFailures`; a nonzero count means a restart may lose some calls.
