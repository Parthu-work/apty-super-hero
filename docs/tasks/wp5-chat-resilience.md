# WP5. Chat resilience and LLM cost control

**Status: not started this round.**

Covers: effective `maxTurns` 30 (configurable) — `browser-agent-config.ts`
currently passes 2000, overriding the `use-agent.ts` default of 30;
automatic retry for rate limits/5xx/network errors with backoff+jitter
honoring `retryAfterMs`, max 3 attempts; watchdogs (30s time-to-first-token,
60s stream inactivity, 5min total run, 60s per-tool/20s debugger-tool
timeout; Stop returns to idle within 1s); token budgeting (cap each tool
result ~2000 tokens, enable the conversation compressor, per-provider
RPM/TPM throttle); LLM-call diagnostics and a preflight check; a fake-LLM
test suite (429/413/401/404/500, hangs, mid-stream stalls, malformed
streams).

**Gate:** all fake-LLM scenarios green.
