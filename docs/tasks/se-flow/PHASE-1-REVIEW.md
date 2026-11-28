# Phase 1 review: workflows, 4.x and 5.x

Running record for the owner's review (PHASE-1-WORKFLOWS.md §8). Filled in
as each work package lands; the final hand-over completes every section.

Branch `claude/blissful-cannon-g8o8bz`, started from
`claude/amazing-gauss-1q2tme` at `f6b682e`.

## 1. Commits per work package

| WP | Commit | Summary |
|---|---|---|
| WP0 | `5f8fdaa` | Baseline and status rows |
| A1 + A2 | `bd40106` | One host gate for every path; fetch time and byte limits; abort on case close |
| WP1 part 1 | `fe59fa4` | WNV-07 per environment from player 5.2.4, version-gated; the coverage-manifest checker |
| WP1 part 2 | (this commit) | `docs/development/coverage-manifest.json` (218 conditions, 768 cited ranges, hashed); `audit:apty-coverage`, `audit:apty-drift` |

## 2. Test output

### WP0 baseline (`f6b682e`)

- `npm run preflight`: green. Unit tests: agent-core 724, browser-runtime
  2,277, ui 535, browser-extension 790, dom-snapshot 468,
  apty-debug-contract 151, mcp-bridge 72, tooling scripts 305.
- `npm run build`: green. `replay-source.e2e.test.mjs`: 3 of 3.
- Audits: all green except `lint:dependencies` (nine test-only exports of
  the replay slice), fixed in A1 + A2.

### A1 + A2

- `npm run preflight`: green. Unit tests: agent-core 734 (+10),
  browser-runtime 2,296 (+19), the rest unchanged.
- Every master §1.4 audit green, `lint:dependencies` included;
  `policy:check` passes on each file in `tooling/scripts/policy/fixtures/expected/`.
- E2E (targeted: every file on a changed path): `replay-source` 3/3,
  `dapty-cdn` 5/5, `dapty-capture` 3/3, `client-test-recorder` 3/3,
  `four-x-evidence` 2/2, `get-evidence` 3/3, `visibility-check` 16/16,
  `org-policy` 4/4, `cases` 3/3. The full suite was started and stopped
  after 7 of 85 files (all passing): at this machine's pace it takes about
  8 hours, so it runs once for the Phase 1 hand-over.
- Found by E2E and fixed before the commit: with the host refused, the
  legacy page-probe path also reported "no Apty config", hiding a 5.x
  player that is on the page; it now keeps the probe and withholds only
  the files.

### WP1 part 2: the coverage manifest

- **How it was seeded.** Every Phase 1 condition (§5.1 plus AUDIT-CORRECTIONS
  §D) was resolved to full `repo:path:line@commit` ranges by 11 agents, one
  per condition group, each opening every file it cited at the pinned
  commit; 11 further agents then tried to refute each citation
  independently. They flagged 24 entries (41 problems). Every problem was
  reviewed by hand: 20 ranges were tightened or replaced with ranges the
  verifier had opened, 7 supporting ranges were added, 5 ranges the merge
  had dropped although the verifier accepted them were restored, 4
  statuses were lowered to `inferred`, and 10 condition texts were reworded
  to match the code (W5-01, P5-01, W5-70, C-18, P4-18, SCR-13/4x, SCR-14/4x,
  D-05, D-26, D-28). Cross-references between conditions that each have an
  entry were removed from the alias lists.
- **Result.** 218 conditions (99 for 5.x, 119 for 4.x), 768 ranges: 162
  `verified`, 36 `corrected` (the inventory's lines were off), 20
  `inferred`, none `not_found`. Every Phase 1 condition ID has an entry
  (`--phase 1`).
- `npm run audit:apty-coverage` (at the pins `3f3adba` / `bbb4cbc`): green.
  `npm run audit:apty-drift` (at the checkouts' HEAD, apty-dap `dc502c81`):
  green after re-verifying the 7 ranges `a2d73e67` moved (below). 63 player
  files under the visibility directories are listed as unmapped (they hold
  no Phase 1 condition: tooltips, launchers, announcements and the like).
- Without both checkouts the command checks the manifest's shape and the
  phase list, prints "line check skipped: reference checkouts not found"
  and exits 0, so preflight and CI never depend on them.

## 3. Fail-then-pass proofs

### A1 + A2

The new tests were run against the previous source (the six changed
browser-runtime source files stashed, the new tests kept): 18 failed, among
them

- `refuses a page-named host off Apty's content domain, with no request, naming the policy key`
- `refuses a given host that equals a private page host`
- `checks each version's ID shapes before any request`
- `keeps the time limit running while a body drips in, and caches nothing` (hung for the 30 s test timeout: the old timer stopped at the headers)
- `stops reading a body past the per-file byte cap, without Content-Length`
- `refuses a body whose Content-Length is over the cap before reading it`
- `counts bytes across the case and stops past the per-case cap`
- `aborts what is under way when the case closes`
- `calls no host the page names off Apty's content domain unless the policy lists it` (the legacy page-probe path)
- `closes the conversation's Apty case, aborting its content requests (A2)`

With the change, all pass.

### WP1 part 1

The nine new WNV-07 tests (`widget display per environment`) were run
against the previous `widget-not-visible.ts`: 9 failed; with the change all
pass. Among them: "no longer lets the application-level setting decide on
5.2.4 and later", "hides the widget before 5.2.4 when the application-level
display is None (it used to pass)", "leaves the audience open, naming both
rules, when they disagree and the version is unknown".

## 4. Owner decisions as answered (2026-11-28)

Every default in master §5 and AUDIT-CORRECTIONS §E, with:

- D-RELEASES: per-environment widget display from player 5.2.4 (§F1). The
  release containing `a2d73e67` (step wait time, §F2) is unknown: those
  rows stay `candidate` and show both values.
- D-KB: not yet. `askDapty` stays absent and no Ask Dapty call is made.

## 5. Facts found changed

- apty-dap moved past the pin (`3f3adba` → `dc502c81`); §F of
  AUDIT-CORRECTIONS records the two commits that change the web player.
- 5.x IDs: `app-urls.json` types application and environment IDs only as
  strings (`application.schema.ts:279-282@3f3adba`); the UUID shape comes
  from the tenant and application schemas (`user.schema.ts:37`,
  `application.schema.ts:256`). The Agent requires UUIDs for all three, as
  A1 says.
- 4.x tenant keys are shortid-style (`player3.0/config/config.json:7`:
  `yA87eWGa`; server `publishing.helpers.ts:820` knows `dynamics365…`
  prefixes), so the 4.x tenant shape is `[A-Za-z0-9_-]{1,64}`.
- 4.x `host_permissions` also include `http://*.apty.io/*`
  (`manifests/manifest.json:11`); with D-HTTP-ONPREM = no, the Agent
  refuses plain http there unless the policy lists the origin.

- Drift between the pin and apty-dap `dc502c81`, found by
  `audit:apty-drift`, all from `a2d73e67` (§F2): five ranges in
  `flow-step.mapper.ts` and `AttachedStep.tsx` moved by 2 to 6 lines with
  the same text (W5-40, W5-48 ×2, W5-51, W5-63), now cited at `a2d73e67`
  with the old range kept as history; W5-45's fixed 5 s wait changed (the
  `a2d73e67` range already covers it); `FlowsFocusTrap.tsx` (C-18) was
  removed. No other cited line changed.
- The coverage inventory's citations were off for 36 conditions (wrong
  lines or file); the manifest holds the corrected ranges, and each
  entry's `note` says what changed.

## 6. Test changes (setup only, and one migrated assertion)

A1 refuses page-named hosts off Apty's domains and IDs of the wrong shape,
so existing fixtures that used `*.apty.example` hosts or IDs such as `t1`
were moved onto valid ones. Assertions are unchanged except where noted.

| File | Change |
|---|---|
| `browser-runtime/src/apty/replay/content-source.test.ts` | Hosts `content.apty.example` → `content.apty.ai`; the "no environment matches" input `nope` → a UUID no app lists; the two 4.x tests list their host in the policy (a 4.x host on `*.apty.ai` is not a 4.x Apty domain); the body-limit constant renamed to bytes. **Migrated:** "a page-named public IP literal (`172.32.0.1`) resolves" now asserts `host_not_allowed`, because no IP literal is an Apty content host (A1) |
| `browser-runtime/src/apty/replay/catalogue.test.ts` | IDs `t1`/`a1`/`e1` → UUIDs (the expected paths built from them) |
| `browser-runtime/src/apty/replay/case-replay.test.ts`, `src/tools/apty-content.test.ts`, `src/apty/apty-cdn-source.test.ts` | Hosts onto `*.apty.ai`; IDs onto UUIDs |
| `browser-runtime/src/apty/diagnosis/dapty-evidence.test.ts` | Host `client.apty.example` → `client.apty.ai`; the "no host in the Strict bundle" list follows the rename, so the assertion still checks the host |
| `tooling/e2e/replay-source.e2e.test.mjs`, `dapty-cdn.e2e.test.mjs` | Run on the E2E policy build with `aptyContentOrigins` = the fake loopback content host |
| `browser-runtime/src/apty/diagnosis/widget-not-visible.test.ts` (3 tests), `apps/browser-extension/src/components/investigation/check-result-card.test.tsx` (1 test) | These tests change only the application-level widget audience, which decides only for players before 5.2.4; their setup now gives the player release `5.2.3`. Assertions unchanged |
| `browser-runtime/src/apty/diagnosis/fixtures/content-5x/app-data.json` | Each environment gets the `widgetDisplayConfig` Apty's migration copied from the application-level setting (AUDIT-CORRECTIONS B6), so every existing 5.x test and E2E sees the same audience under both rules |
| `tooling/e2e/get-evidence.e2e.test.mjs` | Same, for the fake 5.x Client's content URL (`http://127.0.0.1:1`). Without it the Ask-for-evidence card no longer learns "5.x" from a CDN read and offers the 4.x HAR; that card should take the version from the page probe instead (WP2 probes give it), noted for WP2 |

## 7. Partial, and why

- WNV-07 has no source for the player's release yet (`playerRelease` on the
  evidence is filled by WP17 C-1). Until then it decides only where the
  per-environment and application-level rules agree, and otherwise leaves
  the audience open naming both.

- A2's per-case `AbortSignal` reaches `fetchFile` (case close, conversation
  delete, an optional caller signal). The Ask Dapty client and page reads
  it must also reach are built in WP11 and WP5; the responder context's
  `signal` (B1) comes with WP7.

## 8. Not run

- No real tenant, Ask Dapty KB or real model (none given).
