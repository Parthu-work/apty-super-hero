# Data flow

Where data leaves the extension, and which code stands between the page and
each destination. [PRIVACY.md](../../PRIVACY.md) is the user-facing version of
the same rules; this page names the code that enforces them.

## To the AI provider

Every request to the model is built by `AptyAgent` (`packages/agent-core`)
and passes the same steps, in this order, before it leaves the browser:

1. **Tool results** are masked when the tool returns them:
   `applyResultPrivacy` with the current value policy, wrapped around every
   tool in `packages/browser-runtime/src/tools/index.ts` (URLs and page titles),
   and the page readers' own value policy (`prepareNodeForPolicy` in
   `packages/dom-snapshot/src/value-policy.ts`: form fields, editable regions,
   the page's name).
2. **A check answered without the model** (`createDiagnosisResponder`,
   `packages/browser-runtime/src/apty/diagnosis/responder.ts`) gets the same
   `applyResultPrivacy` before it is kept in the session, and a failed call's
   error text is redacted where it is read (`quotedErrorText`). Nothing is
   sent for the answer itself; it goes with the next model request.
3. **KB card text** (KB-RAG) reaches the model only as a `search_kb` result
   (`packages/browser-runtime/src/tools/kb.ts`, wrapped like every tool) or as
   the KB matches answer the responder keeps in the session (step 2), at
   most 4,000 characters of the imported pack's text per result. The pack
   comes from IndexedDB (`apty-kb-db`, one pack per Apty version); nothing is
   fetched. `applyResultPrivacy` keeps a whole `kb://<digits>#L<1-4>`
   citation as it is and masks the rest as usual; a hit names its card's
   Confluence site and space rather than a URL, so the URL policy does not
   take it for a visited page. Since K16 the KB matches answer covers any
   message no check pack claims (not only short symptom phrases), and
   `search_kb` is offered with any Apty, network, DevTools, selector or
   symptom question, so card text reaches the provider in more chats than
   before; never for a bare how-to, a file request or casual chat.
4. **Attached contexts** (page, tab, HAR or DOM Health chips) are worded under
   the URL and title policy (`formatContextsPrivately`,
   `apps/browser-extension/src/hooks/outbound-filters.ts`).
5. **The outbound filters** (`createOutboundFilters`, same file) run on the
   whole request on every model call:
   1. `createOutboundSanitizer`: tool results redacted in the current mode,
      user messages' structural secrets masked in Strict and Standard.
   2. `createRequestBudgetFilter`: a result over 2,000 tokens is cut, and
      results older than the newest 4 become stubs.
   3. `createContextBudgetFilter`: the request budget from Settings, if set.
   4. `createRequestReportFilter`: counts only, kept in
      `chrome.storage.session` for the Data handling card.
6. **The provider wrapper** (`apps/browser-extension/src/services/ai-provider.ts`)
   adds `store: false` for OpenAI and cache breakpoints for Anthropic.

The summary request of **Summarize earlier turns** (off by default) runs the
same outbound filters inside `ConversationCompressor`
(`packages/agent-core/src/conversation/compressor.ts`). It carries the
earlier user and assistant messages and the results of checks answered
without the model, never other tool results. It goes to the same provider with the
same key; only its model id can differ (`summaryModel`, by default
`claude-haiku-5-5` on Anthropic).

Screenshots follow **Settings → Data handling → Screenshots** (ask by
default); a denied screenshot sends no image.

## To an MCP client

The local bridge (`apps/mcp-bridge`) receives tool results after the same
masking, in the same redaction mode, as PRIVACY.md states. It never
receives chat messages.

## To the Apty Client and Studio

`chrome.runtime.sendMessage` to the extension IDs saved in Options, for
their logs, status and observed resources
(`packages/browser-runtime/src/apty/service-worker-diagnostics.ts`). With
no ID saved, the checks use the Apty Client ID the page shows (the
`window-script.js` it injects) once that Client answers a status ping
(`diagnosis/apty-files.ts`). They take no ID from a tool call
(`tools/diagnosis.ts`).

## To Apty's content CDN

When the Apty Client does not answer, the checks `GET` the same public
content files the Client reads (and, for Ask Dapty, the user's stored chat
when the page holds the user's ID) from the content URL in the Client's
`player-config.json` or the page's `window.__APTY_PLAYER_CONFIG__`, with
`credentials: "omit"` (`apty/apty-cdn-source.ts`). Nothing is sent but the
path. Bodies go through the body deny list and redaction like the Client's
record. **Settings → Apty Integration → Apty Client: content CDN** turns it
off: then the page is not probed for the Client's config and no CDN request
is made.

## Never sent

- A HAR file picked on **Check a HAR file**: read in the panel, kept in
  memory while the page is open (`har-check-page.tsx`). Its result can be
  handed to a new chat as a chip; the file and its name are not.
- The DOM Health validation bundle and other exports: saved or copied only
  when you click.
- The **page network capture a check uses** (K15): a capture of the tab
  keeps the whole redacted body of each Apty content call (a `tenant-…`
  path), through the body deny list, in the service worker's memory only,
  for 15 minutes after it stops. A check reads its files from it; the
  bodies are never part of a tool result. **Capture and reload** on the
  verdict card starts such a capture only when clicked.
- A HAR saved from the **4.x Client's service worker** (K15): it holds that
  extension's own content calls and their bodies; it is read in the panel
  like any HAR, through the same deny list and redaction, and never stored.
  The tab's page is used for it only after the user ticks "Use the page
  open in this tab", and only matched locally.
- A KB pack: read from the file you pick in Options and kept in IndexedDB,
  one per Apty version (4.x, 5.x, common).
  Only the chunks a search returns go to the model (above); the verdict
  card's "From the KB card" and the KB matches card show it in the panel
  only. The pack builder (`tooling/scripts/kb/build-kb-pack.mjs`) is the
  only code that talks to Confluence, run by the KB owner, not the extension.

## Kept on the device

See [PRIVACY.md, What is stored on your device](../../PRIVACY.md#what-is-stored-on-your-device).
The session keeps raw tool results, before masking; masking happens on the
way out, every time.

## Tested by

- `tooling/e2e/masking-proof.e2e.test.mjs`: one page with PHI-like strings in
  every place Strict masks, read by every reading tool; none reach the model.
- `tooling/e2e/phi-fixture.e2e.test.mjs`: a page's URL and title, to the model
  and to an MCP client.
- `tooling/e2e/llm-outbound.e2e.test.mjs`: secrets in tool results and typed
  messages, typed values, screenshots and the request reports.
- `tooling/e2e/request-limits.e2e.test.mjs`: the summary request is masked.
- `tooling/e2e/kb-answer.e2e.test.mjs`: a `search_kb` result reaches the model
  with its citation; `kb-matches.e2e.test.mjs`: the KB matches card makes no
  model request.
