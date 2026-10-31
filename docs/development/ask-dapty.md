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

apty-super-hero never calls ai-service itself. It observes the calls the
widget already makes, through one of four sources. Which one works depends
on how Apty runs on the page.

| Source | Mode | What it holds | Needs | Status |
| --- | --- | --- | --- | --- |
| The Apty Client's record | Extension | The chat call's answer and the stored chat files, through the existing Client contract (`apty-debug-agent:list-observed-resources` and `get-resource-body`) | The Client routes `sendWidgetChatMessage` and `getWidgetChatData` through `observedFetch` | Built here (`dapty-loader.ts`), default source |
| A HAR file | Either | The chat call with its request (`postData`, which holds the whole earlier conversation as `context`), its answer and its `Origin` header | The customer records a HAR with the chat open | Built here (`har.ts` `daptyFromHar`, HAR page "The Ask Dapty chat") |
| The page's network | Injected | The chat POST's request body (`chrome.webRequest`), and its answer during a recording (`chrome.debugger`) | Nothing from Apty | Capture layer (session B: `dapty-page-capture.ts`), wired at integration |
| The widget's chat panel | Either | The rendered question, answer and suggestion names (no ids), from `<apty-widget>`'s open shadow root | Nothing from Apty | Capture layer (session B: `dapty-widget-reader.ts`), wired at integration |

Why the sources differ: in Injected mode the widget's code runs in the page
and calls `fetch` itself (`player/src/main-content-script/api-client/widget-chat-api-client.service.ts:50-55`),
so the tab's network shows the call. In Extension mode the call runs in the
Client's own service worker (`player/src/background/messaging/background-script-ipc.service.ts:136-157`),
and Chrome lets no other extension see that traffic: in a Chromium test
`chrome.webRequest` saw nothing and attaching `chrome.debugger` to the
other extension's worker was refused. So Extension mode needs the Client's
cooperation, the same way every other Client check does.

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

## Integration with the capture layer

`ResponderSources.daptyOf(runContext, clientExtensionId)` chooses the
source; it is unset today, so the check reads the Client's record. At
integration it reads, in this order: the page's calls for the
conversation's tab (`getDaptyPageCalls`, through `daptyEvidenceFromCalls`
with source `page`), the Client's record, then the widget's chat panel
(`readDaptyWidgetTurns`, through `daptyEvidenceFromDom`), taking the first
that holds a conversation. Both raw shapes (`RawDaptyCall`,
`RawDaptyDomTurn`) are declared in `dapty-types.ts` and identically in the
capture layer, so the two join without a shared file.
