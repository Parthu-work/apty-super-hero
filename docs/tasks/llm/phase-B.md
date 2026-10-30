# Phase B (do not start until Phase A is approved and the owner says "continue")

- P1 sticky tool selection: per-session memory keyed by `sessionId`; tools =
  current message's groups plus the groups of the last 3 tool-using turns.
  Fixes "ok go ahead" getting 0 tools.
- P2 modular system prompt: a small byte-stable core plus sections keyed by
  tool group (`packages/ui/src/components/chatbot/constants.ts`).
- P3 prompt caching: Anthropic `cacheControl` breakpoints, via
  `wrapLanguageModel` middleware if needed, proven by a unit test on the
  final params (no real provider call); stable prefix for other providers.
- P4 context budget for the selected model: `contextWindow` setting,
  escalating deterministic pruning, a hard stop with a clear message.
- P5 optional model-based summaries through the existing
  `ConversationCompressor`, default OFF.

## As built

- P4 is built as the **request budget** (`requestTokenBudget`, Settings →
  AI → Request size), not a `contextWindow` setting: the limit that bites
  is usually a provider's per-request or per-minute token limit, not the
  model's context window. `browser-runtime/src/runtime/context-budget.ts`
  runs after O2's cap and before the request report. In order: earlier
  tool results become O2's stubs (only when the stub is shorter), earlier
  messages over 400 characters are shortened, the oldest turns are left
  out whole with a note on the first message sent, the current turn's
  results except the newest become stubs. A request that still does not
  fit throws `REQUEST_OVER_BUDGET`, shown as its own chat error with the
  sizes under Details. Off unless set; 2,000 to 2,000,000.
- An answer length cap (`maxOutputTokens`, 256 to 1,000,000) goes to the
  provider as `max_tokens` through `modelSettings.maxTokens`, read before
  every turn. Off unless set.
- Measured with `npm run report:request-size` (characters / 4): at an
  8,000 budget, long-chat-8-turns goes from 11,164 to 7,996 and
  investigation-10-turns stops, because its system prompt and 15 tool
  schemas alone are 7,816; at 12,000 nothing changes. P2 is what would
  make small budgets usable.
- P2 is built in `packages/ui/src/components/chatbot/constants.ts`:
  - `SYSTEM_PROMPT_CORE` holds the identity, scope, architecture, answer format, security and tool-call rules. It is sent on every call, the same bytes first, so P3 can put a cache breakpoint after it.
  - `SYSTEM_PROMPT_SECTIONS` are keyed by tool name, each sent only when the call offers one of its tools. `composeSystemPrompt(tools)` puts them in a fixed order, and sections that share a heading print it once.
  - The agent's `instructionsFor` option applies it per call. The outbound filters and the request budget see the composed prompt.
  - The text is the earlier prompt's, moved, not reworded.
  - Measured as sent: casual 3,810 → 1,259, segments-json 6,344 → 4,574, dom-health 5,505 → 3,063, investigation-10-turns 11,264 → 10,613. At an 8,000 budget the 10-turn investigation now fits (7,873) instead of stopping.
- P1 is built as `createStickyToolSelector` in `packages/browser-runtime/src/tools/tool-relevance.ts`:
  - A turn is offered its own message's tool groups plus those of the chat's last 3 turns that selected any. A turn that selects nothing ("ok", "thanks") is not remembered, so short replies do not push the investigation out.
  - Memory is per `sessionId`, for the 50 most recently used chats. A new chat, or a turn with no session, starts empty, so "hi" in a new chat still gets no tools.
  - The extension's `useSelectRelevantTools` passes `ChatConfig.selectTools`'s `sessionId` through.
  - Tools now come in the registry's group order, not the order the groups matched, so the same groups always send the same tool list.
  - Measured: the follow-up scenario ("ok go ahead" after "check dom health") goes from 0 tools and 2,784 tokens to the 6 DOM Health tools and 4,585 tokens. That is the cost of offering the tools the turn needs, not a saving. Every other scenario is unchanged.
- P3 is built as an Anthropic middleware in `apps/browser-extension/src/services/ai-provider.ts`:
  - It marks two of Anthropic's four cache breakpoints: the last system message, which also covers the tools rendered before it, and the newest message, which is the tool result inside a tool loop.
  - A unit test checks the request body: `cache_control` on the last system block and on the last block of the last message, and nowhere else.
  - **Cost**: a cache write costs 1.25 times the input price and a read about 0.1 times (0.05 on Claude Opus 5.5), with a 5-minute lifetime. A prefix under the model's minimum (512 to 4,096 tokens, depending on the model) is not cached and costs nothing extra.
  - **Other providers** get no markers. P2's byte-stable core and P1's fixed tool order keep the start of each request the same, which is what prefix caches key on.
  - **Not measured**: cache hits and savings against a real provider. The request budget's edits to earlier turns change the prefix, so a budgeted chat reads less from the cache.
- P5 is not built: `ConversationCompressor` would send the raw history to
  the model outside the outbound filters, so it needs the sanitizer in
  front of it before it can be offered, and it spends tokens to save them.
