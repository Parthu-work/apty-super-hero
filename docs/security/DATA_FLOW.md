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
3. **KB card text** (KB-RAG) is withheld from the model by default (KB-RAG
   K22, D-SEC1). It can only ever be in a request as a `search_kb` result
   (`packages/browser-runtime/src/tools/kb.ts`) or as the KB matches answer
   the responder keeps in the session (step 2), at most 4,000 characters of
   the imported pack's text per result. Each such result carries the KB
   source tag (`source: "kb"` and its card ids and layers,
   `packages/agent-core/src/kb/egress.ts`), set where it is made
   (`kbToolResult`). The first outbound filter (step 5.1) replaces every
   tagged result's text with "KB card text withheld by organization policy.
   Cards shown to the user: <ids>." unless `kbEgressAllowed` allows it: only
   when every pack in use is a verified demo pack (signed with the demo key,
   its site ends in `.invalid`, D-SEC10), or
   an organization policy sets `kbToModel: "approved"` and the request's
   destination is on its allow-lists ([ORG_POLICY.md](ORG_POLICY.md)). When
   KB text may not go, `search_kb` is not offered at all, and its prompt
   section is left out. The pack comes from IndexedDB (`apty-kb-db`, one
   pack per Apty version); nothing is fetched. Only packs in use count: a
   pack is used when a trusted key signed it and it is within its dates
   (KB-RAG K23, D-SEC8, D-SEC11), checked at import and at every read, so an
   unsigned, untrusted, revoked or expired pack answers nothing and adds no
   text to any request. When card text is allowed,
   `applyResultPrivacy` keeps a whole `kb://<digits>#L<1-4>` citation as it
   is and masks the rest as usual; a hit names its card's Confluence site and
   space rather than a URL, so the URL policy does not take it for a visited
   page.
4. **Attached contexts** (page, tab, HAR or DOM Health chips) are worded under
   the URL and title policy (`formatContextsPrivately`,
   `apps/browser-extension/src/hooks/outbound-filters.ts`).
5. **The outbound filters** (`createOutboundFilters`, same file) run on the
   whole request on every model call:
   1. `createKbEgressFilter` (`packages/browser-runtime/src/runtime/kb-egress.ts`):
      withholds tagged KB text as in step 3, failing closed when the check
      cannot run. A request that leaves with KB text is recorded first
      (`apps/browser-extension/src/services/kb-egress-log.ts`: time,
      provider, origin, model, card ids and layers, pack versions and
      sha256 values, chat or summary; never text); if the record cannot be
      written, the KB text does not go.
   2. `createOutboundSanitizer`: tool results redacted in the effective
      mode, user messages' structural secrets masked in Strict and Standard.
      The effective mode is never weaker than Standard while a non-demo KB
      pack is loaded, nor than an organization policy's `redactionFloor`
      (D-SEC3; `effectiveSettings`, `packages/agent-core/src/config/effective-settings.ts`).
   3. `createRequestBudgetFilter`: a result over 2,000 tokens is cut, and
      results older than the newest 4 become stubs.
   4. `createContextBudgetFilter`: the request budget from Settings, if set.
   5. `createRequestReportFilter`: counts only, kept in
      `chrome.storage.session` for the Data handling card.
6. **The provider wrapper** (`apps/browser-extension/src/services/ai-provider.ts`)
   refuses a destination an organization policy does not allow, before any
   request: `createAIProvider` checks the provider, origin and model when it
   is built and for each model id, and its `fetch` checks every request
   again against the policy as read then (D-SEC4). An invalid policy allows
   no destination. The wrapper also adds `store: false` for OpenAI and cache
   breakpoints for Anthropic.

The summary request of **Summarize earlier turns** (off by default) runs the
same outbound filters inside `ConversationCompressor`
(`packages/agent-core/src/conversation/compressor.ts`); the KB filter also
runs over the earlier turns before they become the summary request's text,
so a KB matches answer in them is withheld the same way, judged for the
summary model. It carries the
earlier user and assistant messages and the results of checks answered
without the model, never other tool results. It goes to the same provider with the
same key; only its model id can differ (`summaryModel`, by default
`claude-haiku-5-5` on Anthropic).

Screenshots follow **Settings → Data handling → Screenshots** (ask by
default); a denied screenshot sends no image.

## To an MCP client

The local bridge (`apps/mcp-bridge`) receives tool results after the same
masking, in the same redaction mode, as PRIVACY.md states. It never
receives chat messages. A tool result with the KB source tag reaches it as
"KB result withheld by policy. Cards: <ids>." unless an organization policy
sets `kbToMcp: true` (D-SEC5; `resultForMcp` in
`packages/browser-runtime/src/ws-bridge/ws-mcp-server.ts`); `search_kb` is
not among the tools the bridge publishes. With `allowMcpBridge: false` the
extension opens no connection to the bridge.

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
  Its text goes to the model only as step 3 allows; the verdict card's
  "From the KB card" excerpt never enters the session, and the KB matches
  card says whether its text goes and where.
- The record of KB text sent (`apty-kb-egress-db`): ids, never text; saved
  only when you click Export. The pack builder (`tooling/scripts/kb/build-kb-pack.mjs`) is the
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
  with its citation from a demo pack, and is withheld (and `search_kb` not
  offered) once a non-demo pack is loaded; `kb-matches.e2e.test.mjs`: the KB
  matches card makes no model request, and a non-demo pack's excerpt goes
  as card ids only.
- `tooling/e2e/org-policy.e2e.test.mjs` (the E2E-only policy build): locked
  fields, a refused AI host gets no request, the MCP bridge kept off, and
  KB text to an approved destination with its send record.

## Cases, support bundles and feedback (KB-RAG K25)

The decision record of each turn (route, version, packs, KB outcome: ids,
numbers and codes) is a `turn_decision` event the side panel keeps with the
turn; it is not a session item, so no model request carries it. Cases and
feedback are written to IndexedDB `apty-cases-db` (stores `cases` and
`feedback`) by the side panel only. A support bundle, the tracking-sheet CSV
and the `kb:eval` questions file are built from those stores on the device,
pass Strict redaction and the content deny list, and are shown in the review
dialog; only Copy or Download moves them, and the extension makes no network
request for any of them (tested in `support-bundle.e2e.test.mjs` and
`feedback.e2e.test.mjs`). Tool schemas sent to Anthropic and Groq are
rewritten to what those providers accept (`provider-schema.ts`); the tools
still validate their input with their own schemas.
