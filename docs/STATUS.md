# Status — v6 mega-prompt round

Tracks progress against the v6 mega-prompt's 13 work packages (WP1–WP13),
originally audited against `main` at `6b84f4a`. Updated before stopping,
per rule 8.

**Update**: the WP1+WP2 checkpoint below was applied and pushed —
`origin/main` is now at `618f9a7` (the WP1+WP2 checkpoint's own last
commit). The "Post-WP2: ad-hoc fixes and features" section below tracks a
new round of work on top of that, driven directly by the owner reporting
real bugs while testing the build, not by the next numbered work package
(WP3) — flagged explicitly since it's a process deviation from "one work
package per session," made because the owner asked for these specific
fixes by name, not because the numbered-WP process was abandoned.

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

## Delivery (WP1+WP2 checkpoint)

Applied — `origin/main` is at `618f9a7`, the last commit of this
checkpoint. Per rule 9, this session never pushed it itself; the owner
applied the handed-off bundle.

## Post-WP2: ad-hoc fixes and features (this round, on top of `618f9a7`)

Driven by the owner testing the real build and reporting concrete bugs,
plus one explicitly-requested feature. 5 commits:

| Commit | What |
|---|---|
| `eef9164` | Google's AI-provider model dropdown used 3 dead pinned model ids (`gemini-2.5-flash-exp` never existed; `gemini-1.5-pro`/`gemini-1.5-flash` since retired — confirmed live against a real account's 404). Switched to Google's own floating aliases (`gemini-flash-latest`, `gemini-pro-latest`), which Google itself remaps as generations retire, so this list doesn't need re-pinning again. |
| `e055531` | Anthropic's model list was similarly pinned to 3 retired snapshots (`claude-sonnet-4-20250514` etc.) — updated to the current Claude 5 family. Unlike Google, Anthropic has no floating-alias convention, so this one will need updating again by hand once these are themselves superseded. |
| `7643641` | DOM Health's expanded report card had no scroll boundary of its own — it renders inside the chat panel's footer area (promptExtras), not the message list (the only ancestor with a real scroll container), so a large report could get silently clipped by the outer shell's `overflow-hidden` with nothing to scroll. Gave the report its own `max-h-[60vh] overflow-y-auto`. |
| `5217718` | **New feature**: network capture (`start_network_capture`/`stop_network_capture`) now captures actual response bodies for XHR/Fetch requests with a textual mimeType (redacted, truncated at 8000 chars, skipped above 1MB) — directly answers "what did segments.json return" against whatever page is being debugged, since the Apty Widget runs embedded in that page and CDP already sees its network calls. Extracted the decode/redact/bound helpers that already existed (privately) in the cross-extension body-inspection path into a shared `resource-body-utils.ts` so both paths use identical logic. |
| `e332eeb` | DOM Health's "no frame responded" evidence text now includes the actual per-frame failure reason (timeout message, `chrome.runtime.lastError`'s real message, etc.) instead of stopping at a bare frame count — the detail already existed per-frame, it was just being discarded before reaching the UI. |

**Explicitly NOT done, flagged rather than silently skipped:**

- **The other 11 AI providers' model lists** (OpenAI, Groq, Mistral, DeepSeek, etc.) were not audited/fixed. This sandbox's network access can't reach most providers' own docs reliably, and web search returned inconsistent, partly-fabricated-looking results for some (e.g. an unverifiable claim about "GPT-6"/"GPT-5.6") — replacing a possibly-stale id with a confidently-wrong invented one would be worse than leaving it. Fix on request, same as Google, once a real failure is reported.
- **`get_network_diagnostics`** (`devtools.ts`, the older fixed-window network tool) has the identical "never captures response bodies" gap as `start_network_capture` had — not extended this round. `start_network_capture`/`stop_network_capture` is the one the capture-then-inspect workflow actually uses, so it was prioritized; the fixed-window tool is a known follow-up, not forgotten.
- **Cross-extension log/body pulling from a separate Apty Client/Studio extension** (the "Apty integration" panel) remains gated on that *other* product shipping its `apty-debug-agent:*` message-contract cooperation (`externally_connectable` allowlisting this extension's id) — a real product dependency this repo cannot unilaterally fix, already documented in `DECISIONS.md`. Investigated and confirmed still accurate this round, not re-attempted.
- **A known, deliberate tradeoff in the new body-capture feature**: a JSON response key literally named `name` (or `email`/`phone`/etc.) is redacted to `<REDACTED>` by the same `redactSensitiveText` every other response body in this codebase already goes through — this is existing, consistent, conservative behavior, not a new bug, but it does mean a real API response containing a field exactly named `name` will show that field masked. Not loosened without being asked to, since doing so would be a real privacy-tradeoff decision made silently.
- **"Fix all gaps and bugs, make it demo ready"** — not attempted as a single unscoped action. Only the specifically-named items above were addressed.

## Delivery (post-WP2 round)

Applied — `origin/main` is at `1dc8089`, the last commit of that round.

## Post-WP2, round 2: live-testing bugs found via the "get segments.json" workflow

The owner actually drove the agent through real chat against a real page
(`mingle-portal.inforcloudsuite.com`) and hit three distinct, concrete
bugs in the exact feature just shipped (network response-body capture).
All three were found from a single real transcript, not speculation. 3
commits, on top of `1dc8089`:

| Commit | What |
|---|---|
| `7c37064` | Investigation planner: no `PLAN_TEMPLATE` matched a direct resource-retrieval request ("get segments.json"), so it fell through to the generic failure-diagnosis plan, whose "check-network" step only ever suggested `get_network_diagnostics` — never the body-capturing `start_network_capture`/`stop_network_capture`. Added a dedicated `retrieve-resource-data` category, checked first; added the capture tool alongside the old one in every existing check-network step too. |
| `ddd0f06` | **The actual blocker in practice**: "stop the capture" kept turning into "start a new one." Root cause — MV3 suspends an idle service worker after ~30s, and the owner's real rate-limit waits (26-56s between turns) were long enough to wipe the in-memory capture state every time, exactly matching the risk `network-capture-session.ts`'s own header comment already named but didn't defend against. Fixed with a `chrome.alarms` keepalive, reusing the exact mechanism `ws-mcp-server.ts` already uses for the identical problem. 7 new tests. |
| `c17c241` | **The real root cause, bigger than the planner gap**: the system prompt's own "APTY CLIENT EXTENSION RESOURCE INSPECTION" section explicitly told the model, using "give me segments.json" as its own literal example, to use the cross-extension path (`connect_apty_client`/`inspect_extension_network`) — confirmed broken until the Apty Client ships cooperation — and never mentioned `start_network_capture`/`stop_network_capture` at all. This fired on the very first turn, before `start_investigation` was ever called, so the planner fix alone couldn't have prevented it. Rewrote the section to require trying the capture-based path first, demoting the cross-extension path to an explicit fallback. |

Each was found and fixed in the order the real transcript surfaced it —
planner gap first, then the keepalive issue once a longer-running
real test exposed it, then the system-prompt issue once it became clear
the model wasn't even reaching the planner's fixed logic. `c17c241` is
very likely the single highest-impact fix of the three for real usage,
since it's the first instruction the model consults, before any
investigation machinery runs at all.

## Verification

`tooling/scripts/verify-quiet.sh typecheck lint test build audit` is green
as of the last commit (`c17c241`) on `claude/confident-hawking-1b8l61`.

## Delivery (post-WP2, round 2)

The owner applied this round's bundle themselves (not this session) —
confirmed via `git fetch origin main`: `origin/main` reached `8d2f161`, a
clean fast-forward from `1dc8089`.

## Post-WP2, round 3: fresh-install provider-seeding bug, found live

The owner loaded the pushed build (`8d2f161`) on a genuinely fresh install
(no prior `chrome.storage.local` state) and hit "No providers found" on
the AI Configuration tab — the built-in OpenAI/Anthropic/Google providers
never appeared. 1 commit, on top of `8d2f161`:

| Commit | What |
|---|---|
| `c510f4f` | `SettingsPage`'s settings-load effect only ran its provider-seeding logic (`mergeWithDefaultProviders`) when `storageAdapter.load()` returned a non-null object — i.e. when *some* settings had already been written, even an empty `{}`. A real fresh install has no settings key at all, so `load()` resolves to `null`, the whole seeding branch was skipped, and `customModels` stayed `[]`. Fixed by treating a `null` load result the same as `{}`. Added a regression test covering exactly this (`load` resolving `null`). |

This was already flagged as a real, unverified risk in a prior audit
(`docs/audit/UI_AUDIT.md`'s "first-run edge case in Settings' provider
seeding" item) — that audit couldn't confirm whether `chrome.storage.local`
really returns a bare `null`/absent key on first install vs. an empty
object, since it only had a mocked-storage screenshot harness, not a real
extension load. The owner's live report confirms it does, and that the bug
is real in production, not just in the mocked harness.

## Verification (round 3)

`tooling/scripts/verify-quiet.sh typecheck lint test build audit` is green
as of `c510f4f` on `claude/confident-hawking-1b8l61`.

## Delivery (this round)

Per rule 9, nothing has been pushed. `c510f4f` is local to
`claude/confident-hawking-1b8l61`, on top of `origin/main`'s `8d2f161` —
confirmed a clean fast-forward. This round's handoff includes a production
build zip, a git bundle, and exact push-to-main commands.
