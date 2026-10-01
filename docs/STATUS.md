# Status — v6 mega-prompt round

Tracks progress against the v6 mega-prompt's 13 work packages (WP1–WP13),
audited against `main` at `6b84f4a`. Updated before stopping, per rule 8.

## Phase 0

No separate Phase 0 inventory commit was made this round — the v5 round's
Phase 0 table (`5f0171f`, "Phase 0 table, UI audit, and DECISIONS.md entry
for the v5 round") already covers the repo inventory the v6 prompt's rule 8
asks for, and nothing in the repo's structure changed between `6b84f4a` and
the start of this round that would invalidate it.

**Flag**: rule 8 says to install `.claude/skills`, `.claude/agents`, and
`tooling/scripts/verify-quiet.sh` "from the supplied kit" if they don't
already exist. No such kit was attached to this session. `.claude/skills`
and `.claude/agents` do not exist in this repo and were **not** fabricated —
only `tooling/scripts/verify-quiet.sh` was written (this round, as part of
WP1), since its purpose (one-line-per-step verification output) was fully
specified in rule 8's own text and didn't depend on an external kit's
contents.

## WP1 — Quick fixes and hygiene

| # | Item | Status | Commit |
|---|---|---|---|
| 1 | Remove `byokEnabled` entirely, with migration | Done | `9257066` |
| 2 | Fix MCP install instructions / package identity | Done | `08e8421` |
| 3 | `maxTurns` default 2000 → 30 | Done | `9257066` (bundled — same file as item 1) |
| 4 | `resolveDiagnosticTab` never silently uses the active tab | Done | `75e7ef8` |
| 5 | Evidence store de-dup + per-source quotas | Done | `9031b3c`, with a follow-up correctness fix in `a720de1` (see below) |
| 6 | Permission audit → `docs/security/PERMISSIONS.md` + validator enforcement | Done | `e67598b` |
| 7 | Dynamic content-script registration (replace static `<all_urls>` MAIN-world console-bridge) | **Owner decision: keep all-sites for now** | — |

### Item 5's follow-up fix

`9031b3c`'s original de-dup key used `requestId ?? timestamp` as its
fallback for evidence with no `requestId`. Running the full verification
suite surfaced a real bug: two distinct, legitimately-different log entries
recorded synchronously in the same tool call can share the same
`Date.now()` millisecond, so the timestamp fallback silently treated the
second as a duplicate of the first and dropped it (caught by a pre-existing
test in `devtools.test.ts` going from 3 expected evidence records to 2).
Fixed in `a720de1`: the fallback is now `JSON.stringify(data)` (content),
not `timestamp`, with a new regression test reproducing the exact
collision. Verified via `packages/browser-runtime`'s full test suite plus
`tooling/scripts/verify-quiet.sh typecheck lint test build audit` (all
green) before committing.

### Item 7 — owner decision, not a code change

See `DECISIONS.md`'s "WP1.7 ... owner decision — keep all-sites for now"
entry for the full reasoning and the two options presented (all sites vs.
an only-chosen-sites toggle). The owner chose to keep the current all-sites
console bridge; no code change this round. Revisit in WP12 (security
review / release readiness).

## WP2 — MCP bridge hardening (security)

Done, commit `d2a573e`. `apps/mcp-bridge/src/daemon.ts`'s `isOriginAllowed`
accepted any `chrome-extension://*` origin and any client with no `Origin`
header, and a new `/extension` connection silently replaced the live one —
a real local-hijack surface (the WP0 finding `DECISIONS.md` already
documented). Fixed per the owner's WP2 spec and its clarifications:

- A per-install secret token (`crypto.randomBytes`, `0600` under
  `~/.apty/mcp-daemon/token`) is now required as `?token=<token>` on every
  WS path (`/extension`, `/bridge`, `/cli`) — a query param, since that's
  the only mechanism available uniformly to Node `ws` clients and the
  browser's native `WebSocket`. Compared with a hash-then-`timingSafeEqual`
  check so mismatched lengths never throw.
- `/extension` additionally requires an origin matching a configured
  `allowedExtensionId`; with none configured, every extension origin is
  rejected (fail closed). `--set-extension-id`/`--print-extension-id` CLI
  flags persist/read it.
- A second `/extension` connection while one is live is now **rejected**
  (WS close code 4001), never silently swapped in — a genuinely stale
  socket is still reclaimed, but only via the existing ping-timeout path.
- `--host` non-loopback now logs a WARNING; `GET /health` stays
  unauthenticated and was verified to reveal no secrets.
- `--print-token-path`/`--rotate-token` (daemon.ts, cli.ts,
  `browser-cli.ts`'s `daemon token-path`/`daemon rotate-token`) let an
  operator find/invalidate the token without hand-editing files.
- Extension Options (MCP WebSocket Bridge panel) gained an Auth Token
  field; `wsMcpServer.connect()` now takes `(url, token)`, persisted under
  separate `chrome.storage.local` keys — the token is never in
  `getStatus()`'s `url` field or any log line.

`daemon.ts` (previously a ~480-line script with top-level side effects —
argv parsing, `listen()`, PID file, signal handlers) was split into
`daemon-server.ts` (a `startDaemonServer()` factory with no import-time
side effects) and a thin CLI entrypoint, specifically so the auth/origin/
duplicate-connection logic could be tested at all —
`apps/mcp-bridge/src/daemon-server.test.ts` spins up the real server on an
ephemeral port and drives it with real `ws` clients (wrong token, wrong
origin, origin-less client on `/extension` vs. `/bridge`, rejected second
connection, ping-timeout recovery, fail-closed, correct flow on all three
paths — 16 tests); `daemon-cli.test.ts` spawns the real CLI entrypoint as a
child process for the `--host` warning and token-command tests (4 tests);
`lib/auth-token.test.ts` covers the token/constant-time-compare/extension-id
logic directly (14 tests). 34 new tests total, all green.

`apps/mcp-bridge` had no test setup at all before this (its own standalone
pnpm project, not a workspace member — see `CLAUDE.md`); added `vitest` +
`test`/`typecheck` scripts there, and wired both into this repo's own root
`test`/`typecheck`/`build` scripts (`test:mcp-bridge` etc.) so
`verify-quiet.sh` actually covers it going forward, not just this round.

Both READMEs' setup steps are updated for the token + extension-id pinning
flow. Gate (auth tests green; documented setup steps updated): **green**.

## WP3–WP13

Not started this round.

## Verification

`tooling/scripts/verify-quiet.sh typecheck lint test build audit` is green
as of the last commit (`d2a573e`) on `claude/confident-hawking-1b8l61`.

## Delivery

Per rule 9, nothing has been pushed to `main` or any remote. All 8 commits
this round (`9257066` through `d2a573e`) are local to
`claude/confident-hawking-1b8l61`, on top of `main`'s `6b84f4a`. A
lightweight checkpoint (git bundle + `SHA256SUMS.txt` + `CHECKPOINT.md`,
no build zip) was produced and handed off after WP1; a corresponding
checkpoint covering WP1+WP2 together follows this update. Delivery
artifacts per v6 §8/§13's full format (build zip, full secret scan,
`DELIVERY.md`) are still open per the same interpretation flagged after
WP1 — §13 reads as gated on all 13 work packages, not any one alone.
