# WP5. Chat resilience and LLM cost control

**Status: partially done this round (WP4+ audit pass).**

## Done

- **Effective `maxTurns` 30.** `browser-agent-config.ts` was passing `2000`,
  silently overriding `use-agent.ts`'s own already-correct default of 30
  for the real shipped extension (since `BROWSER_AGENT_CONFIG` is spread
  into `useAgent`'s options). Fixed earlier this round.
- **Automatic retry for rate limits/5xx with backoff+jitter honoring
  `retryAfterMs`, max 3 attempts.** Implemented in
  `packages/agent-core/src/agent/aipex.ts` (`LLM_CALL_MAX_ATTEMPTS`,
  `computeLlmRetryDelayMs`, `isRetryableLlmError`), wrapping only the
  call-establishment `run(...)` call in `runExecution` — never mid-stream,
  where partial output has already reached the UI and a retry would
  duplicate or garble it. Deliberately narrower than "retry everything
  `classifyLlmError` marks recoverable": only `LLM_RATE_LIMIT`,
  `LLM_TIMEOUT`, and a confirmed `>=500` status retry automatically — an
  error with no HTTP status at all (the classifier's "assume transient"
  fallback for an unrecognized shape) is NOT auto-retried, since that
  bucket also catches bugs in our own code throwing a plain `Error`, and
  silently retrying those would mask them behind a multi-second delay
  instead of surfacing them immediately. See `DECISIONS.md`'s "WP5" entry
  for the full reasoning and the 3 new tests in `aipex.test.ts` covering
  429-with-retry-after, 5xx-exhausts-retries, and 401-never-retries.
  Network-level errors (no status, connection refused, DNS failure) are
  NOT covered by this change — out of scope for this pass, see below.

## Not done this round (deferred)

- **Watchdogs**: 30s time-to-first-token, 60s stream inactivity, 5min
  total run, 60s per-tool/20s debugger-tool timeout, Stop-returns-to-idle
  within 1s. `ToolTimeoutError`/`CancellationToken` exist in
  `packages/agent-core/src/utils/` but are dead code (never thrown/
  instantiated anywhere) — no `AbortSignal` is threaded from the UI's Stop
  button through to an in-flight provider request or tool call today.
  This is a materially bigger change (needs an abort-aware rewrite of the
  tool-invocation path, not just the LLM call site) and wasn't attempted
  alongside the retry work in the same pass, consistent with this round's
  practice of not bundling an unverified structural change with a
  narrower, tested one.
- **Token budgeting**: capping each tool result to ~2000 tokens, enabling
  the conversation compressor by default, per-provider RPM/TPM throttling.
- **LLM-call diagnostics and a preflight check.**
- **A fake-LLM test suite** covering 429/413/401/404/500, hangs, mid-stream
  stalls, and malformed streams end-to-end (beyond the 3 retry-specific
  unit tests added this round).
- **Network-level transport errors** (connection refused, DNS failure, a
  genuine timeout with no HTTP response at all) — `classifyLlmError`'s
  message-text heuristics catch some of these, but no dedicated handling
  or test coverage was added for them this round.

**Gate (unchanged from original spec, not yet met):** all fake-LLM
scenarios green.
