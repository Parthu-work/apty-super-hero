# WP8. Real-browser end-to-end tests and demo readiness

**Status: not started this round.** This round's WP1 acceptance fixture
(`wp1-acceptance.test.ts`) is a thorough unit-level equivalent against the
real tool code paths (mocked `chrome.*`, same pattern as every other test
in the directory) — it is explicitly NOT a substitute for the real-browser
(Puppeteer/Chrome-for-Testing) e2e run this work package calls for.

Covers: `tooling/e2e/` fixtures (fake Client variants, hostile peer, a
local test page with cross-site iframes/errors/edge-case objects) and a
deterministic-extension-ID runner; exactness tests (a scripted sequence of
logs/requests must come back exactly across cursor pages and a real
service-worker restart); a Preflight page in Options; `docs/demo/DEMO.md`;
`pnpm demo:reset`/`pnpm demo:check`.

**Gate:** all e2e scenarios and `pnpm demo:check` green with pasted output.
