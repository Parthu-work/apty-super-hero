# Ask Dapty check

The Apty widget has an AI assistant, "Ask Dapty". An end user asks it a
question, ai-service answers from the tenant's indexed documents (or the
support docs web search), and the answer can carry up to five suggestions:
workflows or knowledge items the user can open. The Ask Dapty check reads
that conversation, checks the chat call and every suggestion against the
Apty Client's content files, and shows the result in the side panel with no
model call.

Everything below about Apty's behaviour is read from `aptyInc/apty-dap`
`origin/development` and is not runtime-verified.

## How apty-super-hero connects to Ask Dapty

apty-super-hero never calls ai-service itself, and needs no Apty credential
or setting. It observes what the widget already does, and reads the same
public files the Apty Client reads. Which source holds the chat depends on
how Apty runs on the page.

| Source | Mode | What it holds | Needs | Status |
| --- | --- | --- | --- | --- |
| The page's network | Injected | The chat POST's request body, always (`chrome.webRequest`); its answer while the tab is recorded (`chrome.debugger`, the card's "Record the next Ask Dapty chat") | Nothing from Apty | Works today (`dapty-page-capture.ts`) |
| The Widget's own conversations | Extension | Every turn with its suggestions' ids, from the Widget's state (`apty-debug-agent:get-widget-chat`) | The Client adopts the reference module's `recordWidgetChatTurn` ([`docs/integrations/apty`](../integrations/apty/README.md)) | Wired, waiting on the Client |
| The Apty Client's record | Extension | The chat call (with its request body when the Client records it) and the stored chat files, through `list-observed-resources` and `get-resource-body` | The Client routes `sendWidgetChatMessage` and `getWidgetChatData` through `observedFetch` | Wired, waiting on the Client |
| Apty's content CDN | Either | The content files the check needs, and the user's newest stored chat with every turn and its suggestions' ids | Nothing from Apty; for the stored chat, the user's ID on the page | Works today (`apty-cdn-source.ts`) |
| A HAR file | Either | The chat call with its request (`postData`, which holds the whole earlier conversation as `context`), its answer and its `Origin` header | The customer records a HAR with the chat open | Works today (`har.ts` `daptyFromHar`, HAR page "The Ask Dapty chat") |
| The widget's chat panel | Either | The rendered question, answer and suggestion names (no ids), from `<apty-widget>`'s open shadow root | Nothing from Apty | Works today (`dapty-widget-reader.ts`), last resort |

Why the sources differ: in Injected mode the widget's code runs in the page
and calls `fetch` itself (`player/src/main-content-script/api-client/widget-chat-api-client.service.ts:50-55`),
so the tab's network shows the call. In Extension mode the call runs in the
Client's own service worker (`player/src/background/messaging/background-script-ipc.service.ts:136-157`),
and Chrome lets no other extension see that traffic: in a Chromium test
`chrome.webRequest` saw nothing and attaching `chrome.debugger` to the
other extension's worker was refused. Today's Client also answers no
message from another extension (it has no `onMessageExternal` listener), so
a Client ID alone gives nothing.

### Reading Apty from the page and its CDN

What the Client does, which the CDN source repeats (`apty-cdn-source.ts`,
from apty-dap `development`, read only):

1. **Find Apty on the page.** In Injected mode the page sets
   `window.__APTY_PLAYER_CONFIG__` (`player/src/config/config.ts`). In
   Extension mode the Client injects
   `<script src="chrome-extension://<id>/window-script.js">` into every page
   (`main-content-script/inject-custom-script.ts`), which names its ID, and
   serves `player-config.json` as a web-accessible resource
   (`wxt.config.ts`). Either gives `contentURL` and `tenantId`. The script
   tag is the signal: Chrome leaves `chrome-extension://` loads out of the
   page's resource timing.
2. **Pick the application and environment.** `tenant-{t}/app-urls.json`,
   and the first application, then environment by order, whose URL pattern
   matches the page (`cdn.service.ts` `getActiveIds`; wildcard patterns, as
   with the regex URL flags off by default).
3. **Read the content files.** `tenant-{t}/app-{a}/app-data.json` and
   `tenant-{t}/app-{a}/env-{e}/{workflow,knowledge-content,rule}.json`
   (`cdn-path.builder.ts`), with `?timestamp=` and no credentials, as the
   Client does.
4. **Read the stored chat.** `users/{userId}/widget-chat/chat-list.json`,
   then the newest `{chatId}.json` under the application
   (`widget-chat-storage.service.ts`). `userId` is the value
   `app-data.json`'s `config.userIdentificationConfig` names: a dotted
   window path, a session or local storage key, or a key of
   `window.aptyAugmentation` (`user-tracking.service.ts`,
   `window-ipc-handles.service.ts`). With `AptyId`, the user's ID is a
   random ID in the Client's own extension storage, which no other
   extension can read, so the check falls back to the chat panel and the
   card says why.

Every body goes through the body deny list and redaction like the Client's
record (`/widget-chat/` withholds the stored chats). The content URL must
be `https` (or `http` on this machine, for tests), and a user or chat ID
that would change the path is not used. One CDN read per check run serves
both the chat and the files.

The calls, as ai-service defines them
(`shared/contracts/src/ai/ai-chat-widget/ai-chat-widget.schema.ts`):

- `POST {aiBackendURL}/ai-service/api/v1/ai/{tenantId}/widget/chat?applicationId={appId}`
  with `{ message, context: [{ role, content }], envId, applicationType }`,
  answered `{ reply, suggestions: [{ id, name, type }], title? }`, where
  `id` is the item's `sourceId`. A `/stream` variant sends server-sent
  events; nothing in the repo calls it today, and the parser reads its
  `done` and `suggestions` frames too.
- `GET {contentURL}/tenant-{t}/app-{a}/users/{u}/widget-chat/{chatId}.json`,
  the stored conversation `{ id, name, messages }`, and `chat-list.json`
  (`widget/ai-chat/widget-chat-storage.service.ts:26-31`).

## What the check decides

`diagnosis/dapty-conversation.ts`, in order:

| Gate | Rule | Fails when | Evidence in apty-dap |
| --- | --- | --- | --- |
| Chat turned on | DAP-01 | `app-data.json` `config.widgetConfig.features.aiAssistant` is false | `widget/OpenedWidget.tsx:49`; a self-hosted config also forces it off (`cdn/cdn.service.ts:193-205`) |
| Chat call | DAP-02, DAP-03 | The newest call failed (status 0), or returned 4xx/5xx | the call itself |
| Allowed origin | DAP-04 | Injected mode only, for a failed call: the page's origin is not among the origins of the application's environment URLs; a URL with no `https://` allows none | `ai-chat-widget/widget-cors.service.ts:86-107` |
| Answer | DAP-05 | Dapty gave its fixed "couldn't find information" reply | `ai-chat-widget.service.ts:23-24` |
| Suggestions | DAP-06 | A suggested item is not in this environment's `workflow.json` or `knowledge-content.json` | Dapty lists items from ai-service's own cached copy, unfiltered (`widget-content.service.ts`); a click launches only a published item whose visibility rule passes (`cdn/cdn.service.ts:441-477`), otherwise the player logs "Workflow … is unavailable" (`workflow-engine.service.ts:526-534`) |

Each suggestion gets one of: opens; opens only if its visibility rule
passes (named); not published here; several items carry the name;
unchecked. An item hidden from the widget's list still opens from Dapty,
which launches by id, and the card says so.

What the check cannot decide: what the indexed documents say (only
ai-service can search them), the visibility rules' result, and, from the
chat panel, the suggestions' ids (it matches by name and says so).

## Privacy

- Every text of the conversation is redacted in the current mode before
  the check reads it (`dapty-parse.ts`); bodies go through the body deny
  list (`/widget-chat/` as an entry withholds the stored chats).
- The card shows the user's last question (redacted, at most 200
  characters, collapsed), suggestion names and statuses, never a URL, a
  tenant or application id, or a user id.
- The transcript the model may read on a follow-up carries the same, with
  the result's URL policy applied like any tool result.

## Where it runs

- In the chat: a message about Dapty with a problem word ("Dapty suggested
  a workflow but nothing opens", "the AI assistant is not answering",
  "Dapty 没有回答") is answered by the check (`dapty-route.ts`); a how-to
  question or a request to investigate goes to the model.
- For the model: `run_diagnosis` with kind `dapty`.
- On the HAR page: "What is missing?" → "The Ask Dapty chat".

## Source order

`readDaptyForTab` (`dapty-sources.ts`) is the source for the chat and for
`run_diagnosis`. It reads, in order, and takes the first that holds a
conversation:

1. the page's calls for the conversation's tab (Injected mode);
2. the Widget's own conversations reported by the Client, with the
   recorded calls' outcome for the newest call (Extension mode);
3. the Client's recorded calls and stored chats;
4. the user's stored chat on Apty's content CDN;
5. the widget's chat panel (names only).

The Client is asked with the saved ID, or the ID the page shows when none
is saved and that Client answers a 1.5 s ping (the 5.x Client takes every
external message and answers none it does not know, so asking it would
wait out every timeout). The content files come from the Client, or from
the CDN when the Client does not answer, and the card says so. The same
source, `readAptyFilesForTab` (`apty-files.ts`), serves the widget,
visibility and selector checks.

A reader that fails counts as holding nothing. In Injected mode the request
is always captured but the answer only while the tab is recorded, so a card
with no answer offers "Record the next Ask Dapty chat (2 minutes)"; the SE
asks Dapty again on the page, then asks for the check again.

## Evidence bundle

For the live-tenant test (evidence E1 to E12), the Ask Dapty card has
**Export evidence** when Settings → Troubleshooting → Developer tools is
on. It shows the bundle for review ("Review before sharing", the same
dialog as DOM Health's validation bundle), then saves
`apty-dapty-evidence-<timestamp>.json`.

What it holds (`diagnosis/dapty-evidence.ts`, `bundleVersion`
`apty-dapty-evidence/1`):

- the Agent's version and build commit, and the Chrome version;
- the card's result (`DiagnosisResult`), without the user's last question;
- timing: ms from the message to the card, for the content files, and per
  source;
- which source answered, and for each one tried before it: the page's call
  count, the Client ping (`saved-id`, `answered`, `silent`, `not-on-page`),
  the Client record's connection failure, whether the CDN may be read, the
  CDN probe (`ok` or `AptyPageProbe`'s reason) and the stored chat's state;
- for each content file: name, scope (tenant, app or env), status, HTTP
  status, size and top-level keys; for `app-urls.json` the count of
  applications and environments and the pattern shapes (scheme or none,
  wildcard, regex-looking, empty); for `app-data.json` the
  `userIdentificationConfig.type` and the `aiAssistant` flag; for
  `workflow.json` and `knowledge-content.json` the item count and, per
  suggestion, whether its id matched an item's `sourceId`, its `id`, or
  neither;
- the newest chat call: status, failed and error text, the request's
  `context` length, and the answer's keys and suggestion count;
- the stored chat: its message count and the suggestion fields present;
- the chat panel: which markers matched
  (`data-chat-dialog="show.feedback"`, `.MuiTypography-body1/2`,
  `.MuiButton-root`) and the turns of each kind.

No conversation text, URL, or tenant, application, user or chat id goes
in; every string left is redacted in the current mode. The trace is
collected only when the chat answers the check without the model, kept on
the card's result, and never in the transcript or a tool result the model
reads.

`tooling/scripts/dapty-bundle-to-fixture.mjs <bundle.json> <name> --har
<capture.har>` turns a bundle and the SE's redacted HAR into a fixture
under `packages/browser-runtime/src/apty/diagnosis/fixtures/dapty-live/`
(`expected.json`, `evidence.json`, `capture.har.json`); it refuses a HAR
that still holds an email address, a cookie or an authorization header.
