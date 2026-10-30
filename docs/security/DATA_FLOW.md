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
3. **Attached contexts** (page, tab, HAR or DOM Health chips) are worded under
   the URL and title policy (`formatContextsPrivately`,
   `apps/browser-extension/src/hooks/outbound-filters.ts`).
4. **The outbound filters** (`createOutboundFilters`, same file) run on the
   whole request on every model call:
   1. `createOutboundSanitizer`: tool results redacted in the current mode,
      user messages' structural secrets masked in Strict and Standard.
   2. `createRequestBudgetFilter`: a result over 2,000 tokens is cut, and
      results older than the newest 4 become stubs.
   3. `createContextBudgetFilter`: the request budget from Settings, if set.
   4. `createRequestReportFilter`: counts only, kept in
      `chrome.storage.session` for the Data handling card.
5. **The provider wrapper** (`apps/browser-extension/src/services/ai-provider.ts`)
   adds `store: false` for OpenAI and cache breakpoints for Anthropic.

The summary request of **Summarize earlier turns** (off by default) runs the
same outbound filters inside `ConversationCompressor`
(`packages/agent-core/src/conversation/compressor.ts`). It carries the
earlier user and assistant messages and the results of checks answered
without the model, never other tool results.

Screenshots follow **Settings → Data handling → Screenshots** (ask by
default); a denied screenshot sends no image.

## To an MCP client

The local bridge (`apps/mcp-bridge`) receives tool results after the same
masking, in the same redaction mode, as PRIVACY.md states. It never
receives chat messages.

## To the Apty Client and Studio

`chrome.runtime.sendMessage` to the extension IDs saved in Options, for
their logs, status and observed resources
(`packages/browser-runtime/src/apty/service-worker-diagnostics.ts`). The
checks read the Client only from the ID saved in Options and take none from
a tool call (`tools/diagnosis.ts`).

## Never sent

- A HAR file picked on **Check a HAR file**: read in the panel, kept in
  memory while the page is open (`har-check-page.tsx`). Its result can be
  handed to a new chat as a chip; the file and its name are not.
- The DOM Health validation bundle and other exports: saved or copied only
  when you click.

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
