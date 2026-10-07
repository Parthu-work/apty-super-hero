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

---

# v7 mega-prompt round: WP1 ("Apty Integration pulls logs and response data perfectly")

Owner supplied a new, self-contained v7 production-readiness prompt (WP1
through WP9, each with its own real-browser gate) and a zip of a prior
attempt at WP1 from a different session. That attempt was audited first
(see "Audit of a WP1 draft" below) and found genuinely incomplete — its own
checkpoint note admitted 38 failing tests, the acceptance fixture (the
spec's actual gate) was never built, and the repo root had 17 leftover
debug/fix scratch scripts from an iterative, not-cleaned-up process. Rather
than build on that draft, this round re-implemented WP1 from scratch on a
fresh `review/production-ready` branch cut from `origin/main` at `dbabc40`
(the v7 prompt's own stated audited base — confirmed matching).

Per the v7 prompt's own rule 0.2/§8 ("deliver a build for review, then
wait... only after the owner writes 'approved' do you produce push
commands"), this round stops at a review checkpoint — see `REVIEW.md` at
the repo root for the actual deliverable, test script, and known-deferred
items. It does **not** include push-to-main commands, even though a later
chat message asked for them directly — the owner's own authored spec is
the more deliberate, durable instruction here.

## Audit of a WP1 draft (not applied, not built on)

A zip of a different session's WP1 attempt was reviewed before any new
code was written. Findings, in order of severity:
- Its own `REVIEW-CHECKPOINT-WP1.md` admitted 38 failing unit tests, and
  that the acceptance-test fixture (the spec's literal gate) and the
  tolerant resource-matching logic (the spec's actual stated goal) were
  never built.
- The new `ExtensionPeerClient` module — the centerpiece of that attempt —
  shipped with zero tests, against a spec requiring one test per error code.
- `docs/STATUS.md` was never touched despite rule 3 requiring it.
- 17 scratch files (`debug_peer.js`/`2`/`3`, `debug_tool.js` through `.js5`,
  `fix_tool_test_again.js`/`again2.js`, etc.) — literal regex source-mutation
  scripts used to patch test files during development — were left committed
  in the repo root.
- `REVIEW-CHECKPOINT-WP1.md` itself shipped with a literal unexecuted
  shell command (`$(git rev-parse HEAD)`) instead of a real commit hash.
- What WAS genuinely done correctly: the system-prompt routing reversal
  (item 1) was correct and well-targeted, and the new peer-client module
  (where it existed) was actually wired into the real call sites, not left
  orphaned.

This round did not reuse any of that draft's code — it re-implemented WP1
against the real, current repo.

## What this round actually did (scoped to WP1, see `docs/tasks/wp1-apty-integration.md` for full detail)

Found, while investigating the real repo, that `@apty/debug-contract`
(added in an earlier round) already has a complete, tested v1 wire-contract
schema (envelope, verbs, `PeerErrorCode` taxonomy) that was never actually
consumed anywhere — a real asset for a future round's `ExtensionPeerClient`
work, not something this round needed to build from scratch. This round
instead built directly on the existing, proven, legacy `sendExternalMessage`
transport (the one the owner personally verified working live this
session against the real Apty Client), fixing the concrete correctness
bugs on top of it:

| Area | What changed |
|---|---|
| Routing | System prompt (`constants.ts`) and investigation planner (`investigation-planner.ts`) both reverted to try the Apty Client/cross-extension path FIRST, page-level capture as fallback — undoing `c17c241`/`7c37064`'s capture-first ordering. |
| Tolerant matching | `matchResources` now matches case-insensitively, singular/plural, extension-optional, query-string-insensitive. New `suggestClosestResourceNames` ("did you mean") and `alsoMatched` (multiple-match disclosure). |
| Bodies for every status | `inspectResource` now fetches and returns the body for 4xx/5xx responses too, not just 200 — the 403/XML case is asserted directly. |
| Two-audience payload split | A JSON body gets a bounded model-facing summary (item count, top-level keys, ≤5-item sample) instead of a blind char-truncated slice; the full body stays in evidence. New `get_evidence_json` tool pages through the full stored body on request. |
| Log output control | `listServiceWorkerLogs`/the tool default to a 50-entry limit, support `minLevel`, truncate individual messages to 500 chars (`full:true` expands), collapse consecutive identical lines (`repeatCount`), and return a `header` with per-level counts. |
| PII fix (pulled in from WP3 item 1) | `@apty/debug-contract`'s `PII_KEY_NAMES` no longer treats a bare `name` key as personal data — it's overwhelmingly configuration data in real Apty payloads (segment/flow/feature names) — while still redacting `firstName`/`lastName`/`fullName`/`displayName`/etc. Required for the acceptance test's "names intact" assertion to be meaningful; independently a real, previously-reported bug. |
| Acceptance fixture | `packages/browser-runtime/src/apty/wp1-acceptance.test.ts` — a permanent regression fixture matching the spec's scenario (206-item segment.json, 403 tag.json, 60 noisy + 12 PII-bearing logs), exercising the real tool code paths, 9 tests, all passing. |

**Explicitly deferred** (see `docs/tasks/wp1-apty-integration.md` for the
full list and why): the full `ExtensionPeerClient`/contract-v1 wire-protocol
rewrite, cursor pagination persisted in `chrome.storage.session`, peer
config migration + `chrome.management` invalidation, tool renaming with
legacy aliases, page-capture iframe auto-attach, the polished JSON-tree
viewer UI component (the backend it needs IS built), and any real-browser
e2e run (this round's fixture is unit-level, against mocked `chrome.*`,
same pattern as every other test in the directory).

## Verification

`tooling/scripts/verify-quiet.sh typecheck lint test build audit` — all
green on `review/production-ready`, branched from `origin/main` at
`dbabc40`. 522 tests passing in `packages/browser-runtime` (up from the
prior round's 505+, net of the 9 new acceptance tests plus edits to 2
pre-existing tests whose asserted behavior was the bug this round fixed).

## Delivery (this round)

Per the v7 prompt's own rule 0.2, this is a **review checkpoint, not a
push-ready delivery** — nothing has been pushed, and no push-to-main
commands are included. See `REVIEW.md` at the repo root for the review
build, bundle, checksums, and the owner's 15-minute test script. Waiting
for "approved" before producing a final push-ready bundle.

## v7 WP4+: security hardening, dependency remediation, CI fixes, chat resilience

After the WP1 checkpoint above, the owner asked for a full repo-wide audit
("go through the whole repo and make an audit on all the bugs, feature
gaps and implementation gaps... make sure all of them are fixed") framed
as "zero bugs, prod-ready." That framing was pushed back on directly (a
genuine "zero bugs" bar isn't realistic, and the v7 spec's own staged
checkpoints exist specifically to prevent rushed "done" claims) — offered
three paths via `AskUserQuestion`; the owner explicitly chose "attempt
broad coverage across WP2-9 now" over the recommended "confirm WP1 first."
This section covers what that broader pass actually produced, held to the
same standard as WP1: real fixes, real tests, honest partial/deferred
labeling.

Commits this round (in order): `acab65d` (B1/B2 approval gate),
`c04ae4b` (H3 sender checks), `7cd01bb` (M1 MCP daemon hardening),
`82240d9` (M2 AI host URL validation), `61d7d12` (H2 dependency
remediation), `d339dd3` (B5 CI fixes), `5614f4e` (B3 skill sandbox gate),
`a5add3b` (WP5 LLM retry/backoff).

See `docs/tasks/wp4-security.md` for the full done/not-done breakdown
against WP4's original scope, `docs/tasks/wp5-chat-resilience.md` for
WP5's, and `DECISIONS.md` for the detailed reasoning behind each change
(each commit above has its own `DECISIONS.md` entry). Summary:

| Item | Status |
|---|---|
| B1/B2 — approval gate for `run_console_command`/`upload_file_to_input` | Done |
| B4 — real per-site grants (new mechanism, not `HostAccessManager`) | Done |
| H3 — messaging sender checks (`!sender.tab`) | Done |
| M1 — MCP daemon: `maxPayload`, origin rejection, dangerous-tool allowlist | Done |
| M2 — AI endpoint URL validation (full private/loopback/metadata range, IP-literal handling) | Done |
| H2 — `pnpm audit --prod`: 76→1 (root), 55→0 (mcp-bridge) | Done |
| B5 — CI: mcp-bridge install step, audit gate, pinned actions, `packageManager`/`engines` | Done |
| B3 — skill sandbox: pinned-version requirement + off-by-default feature gate | Done, scoped down from the original ask (see wp4-security.md) |
| WP5 — LLM retry/backoff for 429/5xx, honoring `retry-after` | Done |
| `computer`/`fill_*`/download tools under the approval gate | Not done |
| M4 (ZIP import caps), M5 (`optional_permissions`) | Not done |
| Dead-code removal, leveled logger | Not done |
| Hostile-page e2e, fake-LLM test suite | Not done (needs WP8 harness) |
| Watchdogs/timeouts (WP5) | Not done — `ToolTimeoutError`/`CancellationToken` still dead code |
| WP2, WP6, WP7, WP8, bulk of WP9 | Not started this round |

**Verification:** `tooling/scripts/verify-quiet.sh typecheck lint test
build audit` green after every commit above, including `apps/mcp-bridge`'s
own `typecheck`/`test`/`build` (not part of the root `pnpm -r` fan-out).
New test files this round: `url-guard.test.ts` (22 tests, previously zero
coverage), `quickjs-manager.test.ts` (7 tests, previously zero coverage),
`skill.test.ts` (4 tests), plus new cases added to `ai-provider.test.ts`,
`aipex.test.ts`, `devtools.test.ts`/`upload-file/index.test.ts` (approval
gate), `tool-relevance.test.ts`, `message-router.test.ts`/
`mcp-bridge.test.ts` (new files), and `daemon-server.test.ts`.

**Delivery:** no push to `main` yet — all commits are on
`review/production-ready`. The WP1 round's review bundle (`REVIEW.md` +
zip) has not been regenerated to include this round's commits; that's the
next step once the owner has reviewed this round's scope and either asks
for more WP2-9 coverage or signs off on what exists.
