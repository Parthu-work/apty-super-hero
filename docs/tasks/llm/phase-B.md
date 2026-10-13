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
