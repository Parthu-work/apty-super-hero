# WP4. Security hardening

**Status: most of the originally-scoped items done this round.** See
`DECISIONS.md` for the full reasoning behind each; this file tracks
done/not-done against the original scope below.

## Done this round

- **B1/B2 — approval layer for risky tools.** `run_console_command` and
  `upload_file_to_input` now gate their real side effect behind explicit,
  in-conversation user approval (`packages/browser-runtime/src/tools/
  approval.ts`'s `gateRiskyAction`/`confirm_risky_action`) — no risky
  action runs on a tool's first call, ever. `computer`, `fill_*`, and
  downloads are **not yet gated** — only the two highest-risk tools named
  in the original audit were covered this round.
- **B4 — real per-site grants**, but via a new, narrower mechanism rather
  than resurrecting `HostAccessManager`: once a risky action is approved
  on a page origin, that origin is persisted (`chrome.storage.local`) so
  later calls on the *same* origin skip re-asking. `HostAccessManager`
  itself (`apps/browser-extension/src/services/host-access.ts`) is left
  in place, still unused — deleting dead code was judged lower priority
  than not risking a confusing mode-switch behavior change by rewiring it.
- **H3 — messaging sender checks.** `message-router.ts`/`mcp-bridge.ts`'s
  privileged handlers (`relay-to-active-tab`, `start-recording`,
  `stop-recording`, `ws-bridge-connect`) now require `!sender.tab` (ruling
  out a content-script-mediated path from an arbitrary page) alongside
  `sender.id === chrome.runtime.id`.
- **M1 — MCP daemon hardening.** `maxPayload` bound on all three
  WebSocket servers; `/bridge` and `/cli` now reject *any* present
  `Origin` header, not just web-page-shaped ones; a `DANGEROUS_TOOL_NAMES`
  allowlist gate (`--allow-dangerous-tools`, off by default) on
  `tools/call`.
- **M2 — AI endpoint URL validation.** Rewrote `validateHostUrl`
  (`apps/browser-extension/src/services/ai-provider.ts`) to classify the
  full private/loopback/metadata IPv4+IPv6 space (reusing the SSRF
  range-detection helpers already built for the skill fetch sandbox,
  `@apty/browser-runtime/vm/url-guard`) instead of an exact-string
  blocklist that was also only active in PROD builds and never blocked
  plain `http:`. Cloud metadata is always blocked; other private ranges
  are blocked unless the host is loopback (so local model servers like
  Ollama keep working); `http:` is only allowed for a confirmed-loopback
  host.
- **`pnpm audit --prod` remediation.** 76 advisories (1 critical, 24 high)
  down to 1 accepted-risk high with no upstream fix available (documented
  exception, see `DECISIONS.md`'s H2 entry) for the root workspace;
  `apps/mcp-bridge`'s separate lockfile: 55 down to 0.
- **B3 — skill sandbox**, scoped down from the original ask. Did NOT
  implement `credentials:"omit"`/a network allow-list/response caps, and
  did NOT remove `esm.sh` runtime loading (removing the CDN-loading
  capability entirely would mean skills can never use any third-party
  package, a much larger product change than this round's scope). Instead:
  added `requirePinnedVersion()` so a CDN import must specify an exact
  version (closes "same import silently resolves to different code
  tomorrow", not full SRI-style integrity pinning, which `esm.sh` doesn't
  support), and gated the entire skills feature behind a new, off-by-
  default settings toggle (`AppSettings.skillExecutionEnabled`) with an
  explicit in-UI warning — the escape hatch the original spec itself
  suggested, given the real remaining residual risk (documented
  DNS-rebinding gap in `url-guard.ts`, unchanged) wasn't closeable within
  this round without a different network primitive.
- **CI gaps found and fixed in the same pass** (not originally itemized
  under WP4, but found during this audit): `apps/mcp-bridge` had no CI
  install step at all (every `typecheck`/`test`/`build` step touching it
  would fail on a clean checkout); no `pnpm audit` gate; the three GitHub
  Actions used were unpinned (tag, not SHA). See `DECISIONS.md`'s B5
  entry.

## Not done this round (deferred)

- **`computer`, `fill_*`, download tools, cross-origin tab creation, any
  extension-ID contact** — not brought under the B1/B2 approval gate.
- **M4 — ZIP import caps** (skill package upload size/entry-count limits).
- **M5 — `optional_permissions`** for `history`/`bookmarks`/`management`,
  non-conflicting keyboard shortcut.
- **Dead-code removal** (`external-messaging.ts`, the `claudechrome.com`
  model-list path, `aipex-*` identifiers).
- **Replacing `console.*` calls with a leveled logger.**
- **A hostile-page end-to-end test** — needs the WP8 real-browser e2e
  harness, which doesn't exist yet.

**Gate (original, not yet fully met):** approval and grant tests (✅ for
the two tools covered), hostile-page e2e (❌ not built), daemon tests
(✅), `pnpm audit --prod` high count reduced or justified (✅), manifest
validator enforces permission justification (❌ not attempted).
