# WP2. Producer module and hand-off for the Apty Client (Widget) team

**Status: not started this round** (scope was WP1 only this pass — see
`00-context.md` and `REVIEW.md`).

Deliver in `docs/integrations/apty/`: a rewritten `README.md` stating the
§3 facts (replacing the outdated reference), a generated `CONTRACT.md`, a
TypeScript `apty-debug-bridge.producer.ts` for the Widget's WXT background
entry, the packed contract package, the development runtime-paste fallback
steps, and "Findings for the Widget team" (403s on `tag.json`,
`labels.json`, `checklist.json`, `most-used-content.json`; duplicate
concurrent fetches within ~1.5s; ~30 user-preference fetches in ~8 minutes;
every failure logged twice; analytics events logged at info level with
full page context; minified logger prefixes).

If `apty-widget-debug-bridge.js` and `apty-widget-network-addon.js` are
supplied, start from them (verified against this repo's connect code and
in real Chrome for connection, logs and the request list). Merge them into
one production module that: is the first import of the background entry
and registers listeners synchronously at top level, gated by
`__APTY_DEBUG_BRIDGE__` and `__APTY_AGENT_IDS__`; answers only
allow-listed senders and only `apty-debug-agent:*`, returning `false`
otherwise; wraps `console.*`, `error`, `unhandledrejection` and global
`fetch`; persists both buffers in `chrome.storage.session` with a
persisted `seq`, bucketed keys, immediate flush for errors and debounced
flush otherwise, capped bytes, and quota-error handling; answers network
verbs in one listener, synchronously where required, with bodies only
when enabled via `set-capture` and a configurable cap; applies the shared
redactor and source-side filters; speaks legacy verbs and contract v1;
ships unit tests with a fake `chrome`.

**Gate:** producer unit tests pass; the module passes the WP1 fixture
scenarios.

(Note: this repo already ships a reference producer implementation at
`docs/integrations/apty/apty-widget-service-worker.reference.ts` from an
earlier round, covering only the status/logs handlers, not the full
contract-v1/network verbs above — a real gap this WP still needs to close.)
