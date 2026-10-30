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
- P5 is not built: `ConversationCompressor` would send the raw history to
  the model outside the outbound filters, so it needs the sanitizer in
  front of it before it can be offered, and it spends tokens to save them.
