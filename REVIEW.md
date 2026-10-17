# Review: `hardening/prod-ready`, Checkpoint 3 (Phases 1–3), Phase 4 and the PR review

| | |
|---|---|
| Branch | `hardening/prod-ready`, pushed to `origin` at your request for the PR review (never `main`, no force-push) |
| Base | `origin/main` `c64838b` (unchanged since Checkpoint 1) plus the 8 Phase A commits and Phase 1 |
| Code head | Checkpoint 3: `e492c55`. Phase 4 (below) adds `4f8f755`..`451ef90`; the branch head is the commit after, which updates this file and STATUS |
| Build zip | `apty-agent-prod-phase3-e492c55.zip`, a clean build, `manifest.json` at the top; also the release-style pair `apty-agent-v0.1.0.zip` and `apty-agent-v0.1.0-webstore.zip` |
| Git bundle | `apty-agent-prod-phase3-e492c55.bundle`: `HEAD` and `refs/heads/hardening/prod-ready`, excluding `origin/main` (Phase A, Phase 1 and Phase 2) |
| Checksums | `SHA256SUMS.txt` |
| Spec | [`docs/tasks/prod/`](docs/tasks/prod/00-rules.md) |

This file replaces the earlier reviews: `git show c2ac898:REVIEW.md` has
Phase 1 (S1–S7) in full, and `git show 1e4284b:REVIEW.md` is Checkpoint 2.
You approved Checkpoint 1 and then asked to "complete all the phases", so
Phases 2 and 3 ran without a separate "continue". Checkpoint 2's files are in
`~/Downloads/apty-agent-prod-phase2/`, this checkpoint's in
`~/Downloads/apty-agent-prod-phase3/`.

Nothing here was run against a real AI provider, a real tenant or the
Chrome Web Store. Browser tests ran in Chrome for Testing 145 against a mock
model, fixture pages and the real MCP daemon.

## Owner decisions (D1–D7)

Still unanswered, so every default below is applied **provisionally**.
Please confirm or change each.

| ID | Decision | Applied |
|---|---|---|
| D1 | Distribution | Default: **unlisted Web Store**. The listing, smoke test and R9 list assume it. |
| D2 | Extension ID | Default: **adopt the Web Store's ID**. The store zip has no `key`; the unpacked zip keeps the pinned ID for development, enterprise and tests. Client and Studio must allow-list both (R7). |
| D3 | Skills in the store build | Default (Phase 1): imported skills stay; the model can't write scripts. The remote-code answer is written for this. |
| D4 | Tab titles in Strict | Default (Phase 1): withheld in Strict. |
| D5 | Licence | Default: **MIT**; `LICENSE` adds "Copyright (c) 2026 Apty". Check the legal entity name. |
| D6 | Icon artwork | Default: you supply it; **R6 is partial** until then. |
| D7 | Providers for PHI | Default (Phase 1): Settings warns for every provider. |

## Commits (Phase 2)

| Commit | Subject |
|---|---|
| `a0fd0d7` | chore(deps): remove unused dependencies and dead code; one @openai/agents-core (R1) |
| `57308f4` | build(release): release only from main; run every CI audit; one 0.1.0 changelog (R5) |
| `487af35` | build: ship LICENSE, third-party notices and the Inter OFL (R4) |
| `450a0b4` | feat(settings): version the stored settings and migrate them (R3) |
| `f486316` | feat(branding): move AIPex storage names to Apty ones, with a migration; Apty names on pages (R2) |
| `9b25b8c` | feat(release): two extension IDs per D2; copy the running ID (R7) |
| `288c2a4` | docs(store): single purpose, description, remote code, data use, screenshots (R6, partial) |
| `a05429f` | docs(release): prepare the Infor LN re-run and say where results go (R9) |
| `1dbe264` | test(i18n): ratchet on hard-coded UI text; en/zh key parity; keys typed from en.json (R8) |
| `dac9c14` | feat(i18n): move the DOM Health, skills, route probe, preflight, data-handling, recent-requests and provider-error text into en/zh (R8) |
| `5cf6110` | fix(options): label the ID Copy button so it doesn't also match "Extension ID" (R7) |
| `e492c55` | test(e2e): let a closed tab's favicon request land before clearing; format the Copy button |
| (next) | docs: Checkpoint 2 review and status |

## Gates (Checkpoint 2, code head `e492c55`)

`rm -rf apps/browser-extension/dist`, then `tooling/scripts/release-dry-run.sh`
(format, lint, typecheck, unit tests, `test:coverage` with the default
timeouts, build, the full e2e suite, every audit, packaging, checksums):

```
✓ version check (0s)
✓ format lint typecheck test coverage (117s)
✓ build (13s)
✓ real-browser tests (439s)
✓ audits (7s)
✓ production dependency audit (4s)
✓ pinned extension ID (0s)
✓ package (2s)
✓ checksums (0s)
✓ verify checksums (0s)
```

End-to-end, inside that run:

```
# tests 122
# pass 122
# fail 0
# cancelled 0
```

All 13 tests that failed in Checkpoint 1 on the base build too now pass:
the harness computed unpacked extension IDs from macOS's `/var/…` temp path
while Chrome uses the real `/private/var/…` path (fixed in R2,
`tempDir` returns the real path), and the A1 test counted a late
`/favicon.ico` from the previous test's tab (setup fixed, 3/3 runs green).

Unit tests, after Phase 1 → after Phase 2:

| Suite | Phase 1 | Phase 2 |
|---|---|---|
| apty-debug-contract | 80 | 80 |
| agent-core | 271 | 282 |
| dom-snapshot | 395 | 395 |
| browser-runtime | 1069 | 1086 |
| ui | 264 | 268 |
| browser-extension | 313 | 317 |
| mcp-bridge | 60 | 60 |
| tooling scripts (`node --test`) | 23 | 42 |

Coverage (default timeouts this time; every threshold passed):

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| apty-debug-contract | 85.45% | 78.84% | 93.18% | 88.02% |
| agent-core | 78.70% | 72.52% | 85.25% | 80.50% |
| dom-snapshot | 91.41% | 83.45% | 97.82% | 93.17% |
| browser-runtime | 57.21% | 54.33% | 62.25% | 57.21% |
| ui | 50.09% | 39.32% | 48.85% | 51.22% |
| browser-extension | 46.09% | 46.70% | 44.16% | 46.01% |
| mcp-bridge | 31.47% | 26.17% | 34.43% | 31.64% |

Other gates:

```
npm run format:check       Checked 790 files. No fixes applied.
npm run audit:any          ✓ 604 explicit any, none above the baseline
npm run audit:i18n         ✓ 277 hard-coded UI strings, none above the baseline
npm run audit:notices      ✓ THIRD_PARTY_NOTICES.txt matches the production dependencies
npm run audit:branding     ✓ No unreviewed AIPex branding found.
npm run audit:docs-links   ✓ every relative link in the Markdown files resolves
pnpm audit --prod          No known vulnerabilities found   (mcp-bridge: the same)
check-extension-id.mjs --store <store-dist>/manifest.json   ✓ has no "key"
```

Secret scan: TruffleHog 3.99.2 (Homebrew),
`trufflehog git file://<repo> --since-commit c2ac898 --branch hardening/prod-ready --no-verification`,
no exclude list: 602 chunks, **0 verified, 0 unverified**. Repeated on the
branch head before packaging.

## Phase 3: final verification

- **Rebase:** `origin/main` is still `c64838b` (fetched today); the branch
  already contains it and has no merge commits, so there was nothing to
  rebase.
- **Gates on the branch head** (`rm -rf apps/browser-extension/dist` first):

  ```
  ✓ typecheck (8s)
  ✓ lint (1s)
  ✓ test (46s)
  ✓ audit (4s)
  ✓ build (13s)
  npm run format:check       Checked 790 files. No fixes applied.
  npm run audit:test-skips   ✓ every skipped test says why
  npm run audit:any          ✓ 604 explicit any, none above the baseline
  npm run audit:docs-links   ✓ every relative link in the Markdown files resolves
  check-extension-id.mjs     ✓ The manifest key yields the pinned Agent ID bpiondflhhdplemamgggcdajclmoeple
  pnpm audit --prod          No known vulnerabilities found   (package.json has no ignoreCves)
  ```

- **Coverage, full e2e and the release dry run:** the dry run under
  "Gates" (Checkpoint 2) ran on `e492c55`, the same code: coverage with the
  default timeouts, e2e 122/122, every step ✓.
- **TruffleHog over `origin/main..HEAD`** (`--no-verification`, no
  exclude list): 3,484 chunks, **0 verified, 0 unverified**.
- **The final Web Store zip in Chromium** (`apty-agent-v0.1.0-webstore.zip`
  unpacked, no `key`, loaded through `E2E_EXTENSION_DIR`):

  | Probe | Result |
  |---|---|
  | S1 exfiltration (`exfiltration.e2e`) | 2/2 pass |
  | S3 deletion (`stored-data.e2e`) | 2/2 pass |
  | S4 PHI fixture (`phi-fixture.e2e`) | 2/2 pass |

  The PHI fixture first timed out twice (870 s wall time against a 600 s
  limit) and once failed with "Service worker did not start" on the dev
  build too: the laptop was sleeping. Rerun with `caffeinate -dims`, it
  passed 2/2 in about 10 s on both the store zip and the dev build.
- **Request size** (`npm run report:request-size`), base `5fe5227` →
  head: every scenario is identical, raw and as sent (for example
  `investigation-10-turns` 11,163 tokens, `snapshot-heavy` 6,598, `casual`
  3,929). The whole registry's schemas went from 14,597 to 14,683 tokens
  (+0.59%), under the 2% limit; the system prompt stays 3,928.

## After Checkpoint 3: fix for an unoffered tool call

Found while writing the R2 e2e and listed as "observed": when the model
called a tool that wasn't offered for the message (the side panel offers
tools by relevance), the runner threw "Tool X not found", the agent
reported it as a provider error and never finished the turn, and the side
panel showed nothing. Now a registered tool the model asks for is added to
the offered set and the turn runs again, and a tool that doesn't exist is
reported as `TOOL_NOT_FOUND` naming it.

- `aipex-unknown-tool.test.ts` (the real `run()`): before, "expected
  [session_created, …] to include execution_complete" and "expected
  LLM_API_ERROR to be TOOL_NOT_FOUND"; after, 2/2.
- `core-tools.e2e` "runs a tool the message's wording didn't offer":
  "find the save button" offers no UI tools, the model calls
  `search_elements`, and the reply arrives. On the Checkpoint 3 build:
  "No new reply matching /^RESULT:/"; on this build: pass.
- Release dry run on this commit: every step ✓, e2e 123/123.

## Phase 4: the items Checkpoint 3 left out

You asked whether the PR held every bug, gap and fix, and then to
"complete all the phases". These are the ten items it did not hold
(numbered as in that answer). Two of them change rules the plan had kept
fixed: item 7 (redaction) and item 8 (approval). Each has its own
commit. The "before" lines are the new tests run on the code before the
change.

| # | Change | Commit | Before → after |
|---|---|---|---|
| 6 | **Strict** replaces record numbers (6+ digits), GUIDs, long hex ids with `:id` and emails with `:email` in URL paths, for example `/patients/884213` → `/patients/:id`. Standard keeps the path, as before. | `4f8f755` | `value-policy.test` "replaces record numbers, GUIDs, long hex ids and emails…": 1 failed → pass |
| 7 | A sensitive key whose object or array is cut off by truncation (`{"cookie":{"sid":"abc…`) is redacted to the end of the text; before, the rest passed through. | `b360e33` | `json-redact.test` "redacts an unclosed sensitive object or array to the end" (2 rows): 2 failed → pass |
| 8 | DOM Health's **application-safe** mode (link-only discovery) now asks first, like application-deep; the prompt says how many pages it may open and that nothing is clicked. It can be remembered for the site; deep still can't. Page mode still runs without asking. | `fa5766c` | `dom-health.test` "asks before link-only discovery too…": 1 failed → pass |
| 9 | Agent session history that no saved conversation leads to (by id or through the session it forked from) and that has been idle for 24 h is deleted after each save. A side panel closed without "New chat" used to leave one forever. A session with no timestamp is kept. | `b9e119f` | `agent-session-migration.test` (2) and `conversation-storage.test` "sweeps after a save…": 3 failed → pass |
| 10 | A failing plugin hook is logged as `[Apty Agent] Plugin <id> <hook> failed (<error type>)`; before, `console.error` printed the error, which can carry page text. | `55e5c58` | `aipex-plugin-logs.test`: "expected '[Apty Agent] Failed to setup plugin l…' not to contain 'PATIENT-884213'" → pass |
| 11 | The chat shows its own `data:` and `blob:` screenshots inline again. S1 had blocked them along with remote images. Remote images stay blocked, and a `data:` URL that is not an image is still not rendered. | `1afbd8d` | `response.test` "renders a local data: image…": 1 failed → pass; "never renders a data: URL that is not an image" passes before and after |
| 12 | The conversation, screenshot and skills IndexedDB databases move from `aipex-*` to `apty-*` names (copy, read back every key, then delete), like `aipex-sessions` in R2. A record already under the new name wins. | `3aec0af`, `2f22cc1`, `d53b20f` | `legacy-storage.e2e` first test, extended: see below |
| 13 | The remaining hard-coded UI text is in `en` and `zh` (495 keys each, 57 files, including Preflight's results and the error screen). The ratchet went from 277 to 13. | `c5f8b5c` | `preflight-panel.test` new zh case; ratchet 13 |
| 14 | knip's unused files (14 files, 1,285 lines) and unused exports are removed, along with `@radix-ui/react-hover-card` and `embla-carousel-react` from `@apty/ui`. The explicit-any baseline went from 604 to 603. | `914c3d0`, `08aea1e` | typecheck, lint, every unit test |
| 15 | `@openai/agents` and `@openai/agents-extensions` 0.7.2 → 0.20.0. See the notes below. | `6e9ab92`, `753e815`, `2a15cf3` | below |

**Item 15 notes:**

- **Strict tool schemas.** 0.20 rejects `z.record` in a tool's parameters
  and won't take `strict: false` with Zod. The intervention tools' `params`
  is now an object with explicit nullable fields, and nulls are dropped
  before the intervention runs (`tools/interventions/index.test.ts`).
- **Tool error messages.** 0.20 tells the model only "An error occurred
  while running the tool". Tools rely on the error's text to say why they
  refused (for example "disabled in background mode", checked by
  `computer.test`), so `tool()` in `@apty/agent-core` puts back 0.7's
  message. The result still passes through the outbound filters.
- **undici.** 0.20 pulls in `openai` 7 and undici 7 with known advisories.
  A pnpm override pins `undici >= 7.29.1`, `pnpm audit --prod` finds
  nothing, and THIRD_PARTY_NOTICES is regenerated.
- **Request size.** 0.20 writes every optional field as required plus
  nullable and repeats its description inside the non-null variant. Raw
  totals, Checkpoint 3 (every scenario identical to the base `5fe5227`) →
  after the upgrade → after `2a15cf3`, which
  drops the repeated description (`tools/index.test.ts`: "expected [ 'What
  to echo', 'What to echo' ] to have a length of 1" → pass):

  | Scenario | Before | 0.20 | Now | Change |
  |---|---|---|---|---|
  | apty-question | 7,723 | 8,097 | 7,892 | +2.2% |
  | segments-json | 9,166 | 9,565 | 9,345 | +2.0% |
  | dom-health | 5,647 | 5,854 | 5,668 | +0.4% |
  | click-task | 6,400 | 6,828 | 6,490 | +1.4% |
  | investigation-10-turns (as sent) | 11,163 | 11,537 | 11,332 | +1.5% |
  | casual, followup, snapshot-heavy | unchanged | | | 0% |
  | Registry schemas (65 tools) | 14,683 | 16,000 | 15,200 | +3.5% |

  The 2% limit is for S4 and S5, but I note it here: the rest of the
  growth is the `anyOf […, {"type":"null"}]` wrappers strict mode needs.
  The model may now send `null` for an optional field. The SDK drops it
  before parsing (checked: `{"a":null}` parses as `{}`), and
  `tools/index.test.ts` covers it.

**Existing tests changed in Phase 4 (setup or expectation, with the reason):**

- `dom-health.test` S5 "runs link-only discovery without asking" became
  "asks before link-only discovery too…". That is the item 8 behaviour,
  which reverses S5's choice. The earlier tests in that file now answer
  the approval in `beforeEach`, and their assertions are unchanged. A new
  test checks that page mode still doesn't ask.
- `response.test` S1 "keeps Streamdown's own block on data: images" became
  "renders a local data: image…" (item 11). A new test keeps a non-image
  `data:` URL out.
- e2e setups answer the item 8 prompt: `agent.e2e` (DOM Health on a tab
  opened before a restart), `dom-health-routing.e2e` and the
  `dom-health-apps` helper (any `run_application_dom_health_audit` whose
  mode isn't `page`). Their assertions are unchanged.
- `stored-data.e2e` reads `apty-conversations-db`, and tests that named
  the old database use the new constants (item 12).
- `apty-client.e2e` A2 deny-list test: its setup now sets
  `redactionMode: "standard"`. Under Strict, item 6 turns
  `/users/4815162342.json` into `/users/:id.json`, and the test asserts the
  real path to show it got the right request. The assertion is unchanged.
  Found by the release dry run: 122/123, then 8/8 for that file after the
  change.

**Gates on `451ef90`:**

```
✓ typecheck  ✓ lint  ✓ test  ✓ audit  ✓ build
unit tests: debug-contract 83, agent-core 288, dom-snapshot 397,
            browser-runtime 1094, ui 269, extension 318, mcp-bridge 60
i18n ratchet   ✓ 13 hard-coded UI strings
audit:any      ✓ 603
pnpm audit --prod   No known vulnerabilities found
```

**Real-browser tests on `451ef90`** (Chrome for Testing 145, mock model):

- Full suite: 122/123. The failure was `preflight.e2e` "with a Client that
  has no bridge module", which timed out loading the Options page after 30 s
  while I was building another commit at the same time. Run alone
  afterwards: 5/5. The release dry run on `08aea1e` had passed it.
- Item 12, `legacy-storage.e2e` with the extended first test, on the
  pre-Phase-4 build (`bb08694`, through `E2E_EXTENSION_DIR`): "Timed out
  waiting for the chat to be saved". The second test then failed too
  because the first left the browser broken; run alone on that build it
  passes 1/1. On this build: 2/2.
- **TruffleHog** over `origin/main..HEAD` (`--no-verification`; the scan
  began at an older commit, so it covers all 59 branch commits): 4,266
  chunks, **0 verified, 0 unverified**.

## PR #20 review, before merging

Four reviewers each read one area of the whole diff: agent-core, storage
and privacy, tools and the MCP bridge, and UI and the extension. CodeQL
ran on the PR too. Each finding below was confirmed by a test that fails
on the code before the fix.

| Severity | Finding | Fix | Before → after |
|---|---|---|---|
| High | After the R2/item 12 database move, `apty-conversations-db` and `apty-screenshots-db` ended at version 2, which the Agent opens at version 1. Every open failed with `VersionError`, so history and screenshots stopped working for upgrading users. | `1e86836`: a new target is created at the source's version. An existing target that lacks a store keeps the old database for a later retry. | `legacy-storage.e2e` opens each database at the Agent's version: `VersionError` → pass |
| High | ZenFS names its store after the database, so the skills store was copied as `aipex-skills-fs`, where ZenFS never reads it. The source was then deleted. | `1e86836`: the store is renamed too. The e2e test now seeds ZenFS's real layout. | "Timed out waiting for the skill files to move" → pass |
| High | A malformed frame on an `/extension` socket still authenticating (no token needed) or on `/cli` stopped the daemon: an unhandled `error` event. | `e09740d` | 2 unhandled `WS_ERR_INVALID_UTF8` errors → pass |
| Medium-high | My fix for unoffered tools (`0632df0`) reran the turn from the user's message even after a tool had run, repeating that tool. | `6c00ba9`: it reruns only before any output; later, the turn ends with `TOOL_NOT_FOUND` naming the tool. | the tool ran 31 times → 1 |
| Medium | Settings saved with only `aiProvider` (for example `anthropic`) got the default `providerType` `openai`. Test Connection then sent the key to OpenAI, and Save wrote `aiProvider: openai`. | `fc3b5cd`: settings version 2 derives `providerType` from `aiProvider`. | `undefined` → `claude` |
| Medium | MCP calls have no bound tab, so since S5 every MCP `switch_to_tab` and same-origin `create_new_tab` asked first, and failed with the side panel closed. | `d10eba0`: MCP compares with the active tab, as on main. Another origin still asks, and so does a chat with no bound tab. | 2 prompts → 0 |
| Medium | Strict rewrote the URLs in the user's own skill text (`/orders/123456?view=audit` → `/orders/:id`), so the agent opened the wrong page. | `b8e1ac6`: skill content tools are exempt. `execute_skill_script` output still goes through the policy. | → pass |
| Medium | A 3.x daemon refuses the S6 extension, which only sees a socket error and retries forever. | `dd5ca85`: `/health` advertises challenge auth. The extension names an outdated daemon and says to update to **apty-mcp-bridge 4.0.0** (the version is bumped for the protocol change). | "WebSocket error" → the update message |
| Low | A handshake abandoned when the daemon restarted timed out 5 s later and wiped out the newer connection, because both shared the auth reply slots. | `a1d9d2b` | stuck `connecting` → `connected` |
| Low | In Strict, a short tab title ("Home") was replaced throughout the attached page text. | `4783817`: titles under 12 characters are replaced only on their own line or the `Title:` line. | → pass |
| Low | A legacy session database connection stayed open after a failed move or a delete. | `98944cb` | → pass |
| CodeQL (6 high, 1 medium) | Quadratic `[[screenshot:` placeholder regex (7.5 s on 260 KB of model output); `Math.random` for node ids, screenshot uids and the redaction pseudonym salt; an auth reply lookup without a function check; 1024-bit keys in a test; an error's text in an e2e server reply. | `3fd0be4`, `3c9cf86` | regex 7,457 ms → under 500 ms |

**Reviewed and kept as designed:**

- **New tabs with long paths.** A same-origin new tab whose path, query and fragment add up past 128 characters still asks. That is S5's rule, and an S5 test asserts it.
- **Strict URL masking.** Strict masks URLs in page-derived results: it drops queries and, since item 6, replaces ids in paths. That is the point of Strict. Standard keeps paths.
- **Truncated JSON.** An unclosed sensitive object in truncated text is redacted to the end. That errs toward hiding.
- **Cross-origin MCP tab switch.** It still needs approval (S5).

**Nothing on main was lost.** Every `it`/`test` title on main and on the branch was compared: main has 2,122 and the branch 2,473. The 8 titles missing on the branch were each renamed or replaced by a stricter test: S3 click echo, R2 `data-apty-nodeid`, S5 DevTools and approval grants, S6 token handshake. The exception is S3's three click-recording tests, which were removed with the dead code they covered (see Phase 1).

**Gates on the final head** (release dry run, `rm -rf dist` first):

```
✓ format lint typecheck test coverage   ✓ build   ✓ real-browser tests (123/123)
✓ audits   ✓ production dependency audit   ✓ pinned extension ID   ✓ package, checksums
unit: debug-contract 83, agent-core 290, dom-snapshot 397, browser-runtime 1103,
      ui 273, extension 318, mcp-bridge 61
request size: unchanged from Phase 4 (registry 15,200 schema tokens)
TruffleHog origin/main..HEAD: 4,347 chunks, 0 verified, 0 unverified
```

## Work packages (Phase 2)

Each behaviour change has a test that failed on the code before it and
passes after; the outputs are in the commit messages' tests and listed here.

### R1. Dependencies and dead code: done

- **Removed** from `apps/browser-extension`: `assistant-ui`, `bip39`,
  `ahooks`, `markdown-to-jsx`, `remark-gfm`, `@modelcontextprotocol/sdk`,
  `tokenlens`, and 20 packages only `@apty/ui` imports (it declares them
  itself). From `@apty/ui`: `markdown-to-jsx`, `remark-gfm`, `tokenlens`.
  Each had no import (a script that checks every `from`/`import()`/
  `@import` in the package); build, unit tests and the model-path e2e files
  passed without them, and the full e2e suite later passed 120/120.
- **`pnpm audit --prod`:** before, with the ignore entry removed: 1 high
  (`braces`, path `apps__browser-extension>assistant-ui>jscodeshift>micromatch>braces`).
  After: "No known vulnerabilities found". The `ignoreCves` entry is gone;
  `docs/archive/DECISIONS.md` records why the old reason was wrong.
- **`@openai/agents-extensions` `^0.5.4` → `^0.7.2`:** `pnpm why` went from
  two `@openai/agents-core` (0.5.4, 0.7.2) to one (0.7.2). `aisdk` moved to
  the `ai-sdk` subpath (three imports changed).
- **Dead code:** 20 files, 4,491 lines: `tools/{bookmark,history,organize-tabs}.ts`,
  `tools/tools/{clipboard,context-menus,extensions,sessions,tab-groups,window-management}`,
  `tools/tools/utils/wait-helper.ts`, `ui/src/i18n/i18n.ts`, and nine unused
  ai-elements (`artifact`, `branch`, `chain-of-thought`, `context`, `image`,
  `inline-citation`, `open-in-chat`, `task`, `web-preview`). No test covered
  them. `hooks/use-storage.ts` is **not** dead (two importers); see Conflicts.
- **Stale `packages/dom-snapshot/src/*.d.ts`** (6) deleted;
  `packages/dom-snapshot/.gitignore` now ignores `src/**/*.d.ts`
  (`git check-ignore` confirmed).
- **`knip.json`** lists the real entry points (manifest entries, Vite
  inputs, tooling scripts and e2e, the mcp-bridge bins). knip now reports 15
  unused files, 71 unused exports and a few dependency findings; they are
  listed as follow-up, not removed, because R1 scopes removal to the Facts.
- **Follow-up:** `@openai/agents` 0.7 → 0.20 (not done here, as asked).
- **Dependabot PRs** (open, checked through the GitHub API; none merged):

  | PR | Bump | Verdict |
  |---|---|---|
  | #15 | `pnpm/action-setup` 5.0.0 → 6.1.0 | Safe: CI green; touches `ci.yml` and `release.yml` |
  | #7 | `@types/node` 25 → 26 (dev) | Safe once rebased onto this branch: CI green, types only |
  | #3 | `@types/chrome` 0.1 → 0.3 (dev) | Safe once rebased: CI green, types only; it edits the extension's `package.json`, which R1 changed |
  | #5 | `@radix-ui/react-dropdown-menu` 2.1.16 → 2.1.25 | Safe after rebase: patch, CI green; R1 removed the extension's copy, so only `@apty/ui`'s remains |
  | #17, #18 | `actions/upload-artifact` 4 → 7, `actions/download-artifact` 4 → 8 | Not yet: CI is green but CI never runs `release.yml`; merge both together and run a release dry run (`workflow_dispatch`) first |
  | #16 | `actions/setup-node` 6.5 → 7.1 | Not safe: its CI run failed |
  | #4, #8 | `assistant-ui`, `ahooks` | Close: R1 removed both packages |

### R2. Branding and storage keys: done

- **Keys:** `STORAGE_KEYS` use `apty_*`; the input-mode and ZenFS keys moved
  too. `storage/legacy-storage.ts` copies each old key, reads it back, and
  only then removes the old one; a value already under the new name wins.
  It runs at service-worker start (before the redaction mode and page-hook
  settings are read), on update (before the R3 settings upgrade), and when
  `ChromeStorageAdapter.load` finds a new key empty.
- **Database:** `aipex-sessions` → `apty-sessions`, copied and verified
  before the old database is dropped. Deleting a conversation or "Delete
  everything" still reaches sessions not yet moved (S3 holds).
- **On customer pages:** `data-apty-nodeid`/`-uid`/`-highlighted`, and
  `apty-agent-*` ids and classes. Plain `apty-*` would have collided with
  Apty Widget detection (`[id^="apty-"]`), so the Agent uses `apty-agent-`
  and Widget detection now skips it. Logs say `[Apty Agent]`; skill-creator
  text says Apty Agent.
- **`check-branding.mjs`** scans `.js`/`.mjs` and matches whole tokens
  case-sensitively. Before, its `"AIPex"` entry was compared
  case-insensitively and so allowed every line: the check could not fail.
- **Tests (red → green):** `legacy-storage.test.ts` (7; interrupted copy,
  failed copy, torn copy, idempotence), `storage-adapter.test.ts` (lazy read),
  `agent-session-migration.test.ts` (6), `lifecycle.test.ts` (update moves
  settings and grants, then versions them), `widget-diagnostics.test.ts`,
  `check-branding.test.mjs` (4), and `tooling/e2e/legacy-storage.e2e.test.mjs`:
  seeds settings, grants and sessions under the old names, restarts the
  Agent, and finds them under the new names with the conversation intact and
  the chat working; and a page the agent worked on carries `data-apty-nodeid`
  and no "aipex". On the old build the second test fails showing
  `data-aipex-nodeid`, `#aipex-content-root` and `#aipex-border-overlay`.
- **Not renamed** (listed in `check-branding.mjs`): the conversation,
  screenshot and skills IndexedDB names, which hold user data and were not in
  scope; internal message strings; the screenshot placeholder host; the
  `AIPex` class; two mcp-bridge env vars.

### R3. Settings schema version: done

`settingsVersion`, `SETTINGS_MIGRATIONS` and `migrateSettings` (idempotent,
never downgrades) in agent-core; `withSettingsDefaults` fills missing
fields. `onInstalled` (update) writes migrated settings back; the Settings
page and the side panel's settings hook migrate on load; the Settings page
applies defaults, also when a General-tab switch saves. Tests: a field added,
renamed and removed across versions, plus idempotence, no downgrade and
garbage input (11, red → green); the Settings page saves defaults and the
version (red → green); the update handler (red → green).

### R4. Licences: done (D5 default: MIT)

`LICENSE` adds "Copyright (c) 2026 Apty" under AIPex's line;
`THIRD_PARTY_NOTICES.txt` is generated from `pnpm licenses list --prod`
(346 packages; 20 ship no licence file and say so) by
`tooling/scripts/third-party-notices.mjs`, and `npm run audit:notices`
fails when it is stale. A Vite plugin emits `LICENSE` and the notices into
the build; the Inter OFL ships as `assets/Inter-OFL.txt`.
`check-dist-licences.mjs` ends every `npm run build` and fails when any of
the three is missing (before: "missing: LICENSE, THIRD_PARTY_NOTICES.txt,
…"). The root and extension `package.json` say MIT.
**For you:** four production packages are LGPL-3.0-or-later (`@zenfs/core`,
`@zenfs/dom`, `memium`, `utilium`, used by the skill file system). Bundling
LGPL code into a closed or store build has obligations; please have this
checked.

### R5. Release hygiene: done

`release.yml` fetches full history and fails a tag whose commit is not on
`origin/main` (`check-tag-on-main.mjs`, 3 tests, red → green). The gate adds
`audit:any`, `audit:docs-links`, `audit:i18n`, `audit:notices` and
`pnpm audit --prod` (also for the mcp-bridge), as CI runs them; the local
dry run does the same. `CHANGELOG.md` has one `0.1.0 — 2026-10-16` section
and an empty "Unreleased".

`tooling/scripts/release-dry-run.sh` (the release job, locally; full output
under "Gates"):

```
Release dry run for v0.1.0 (nothing is published)
✓ version check (0s)
- tag on main: checked by release.yml for a tag push only
✓ format lint typecheck test coverage (117s)
✓ build (13s)
✓ real-browser tests (439s)
✓ audits (7s)
✓ production dependency audit (4s)
✓ pinned extension ID (0s)
✓ package (2s)
✓ checksums (0s)
✓ verify checksums (0s)
Packages: /tmp/release-dry-run/release/
```

### R6. Store package: partial (icons wait for D6)

- Single purpose = the manifest `description`, word for word.
- Store description copy written.
- Remote code: recommended answer **Yes**, with the exact text for the D3
  build (imported skill scripts in the bundled sandbox; page JavaScript only
  after a per-run approval). Answering "No" would be inaccurate. Your call.
- Data use: health information, PII, authentication information,
  personal communications, web history, user activity and website content,
  each with what the code sends.
- `<all_urls>`: one position in both the listing and STATUS: kept for 0.1.0,
  because customers run their applications on their own domains.
- Five 1280×800 screenshots of the real extension on a synthetic demo app
  (`docs/store/screenshots/`, `screenshot-harness.mjs --store`), checked by eye.
- `tooling/scripts/rasterize-icons.mjs` renders 16/48/128 px icons, the
  store's 128 px icon and the 440×280 tile from your artwork, with the
  existing Chromium (its e2e test passes on a sample SVG). **Missing:** the
  artwork (D6), so the icons are still AIPex's.
- The store zip is built exactly as `release.yml` builds it (see Gates); its
  manifest has no `key` and passes `validate:extension`.

### R7. Extension ID: done (D2 default: the Web Store's ID)

The unpacked/enterprise zip keeps the pinned `key`
(`bpiondflhhdplemamgggcdajclmoeple`, still the e2e harness's
`AGENT_EXTENSION_ID`); the Web Store zip has none and gets the store's ID at
first upload. `check-extension-id.mjs --store` fails a store manifest that
still has a key (test, red → green); `release.yml` and the dry run use it.
`docs/integrations/apty/README.md#extension-ids` states both IDs and that
the Client and Studio must allow-list both; STUDIO.md, SMOKE_TEST.md and
RELEASING.md point to it. Settings → Apty Client now has a Copy button for
the running ID (red → green); Studio already had one.

### R8. i18n: done

- **Moved:** every hard-coded string in `dom-health-card.tsx`,
  `SkillDetails.tsx`, `route-probe-panel.tsx`, `preflight-panel.tsx`, the
  Data-handling card, the recent-requests list and the provider errors
  (model list, Test Connection, tool calling). 280 keys in `en.json` and
  `zh.json`; English values are unchanged, so existing tests that read
  English still pass. The screenshot-policy control already used `t()`.
  Model-list and connection-test helpers take a translate function, English
  by default; `ai-provider.ts` stays free of i18n.
- **Ratchet** `tooling/scripts/check-i18n-baseline.mjs` (TypeScript parser;
  JSX text, string children, user-visible attribute strings per file),
  wired into CI, the release gate, the dry run and verify: **418 strings in
  56 files → 277 in 52**. `dom-health-card.tsx` 85 → 0, `SkillDetails.tsx`
  29 → 1 (the file name `SKILL.md`), `route-probe-panel.tsx` 17 → 0,
  `preflight-panel.tsx` 10 → 0, `recent-requests.tsx` 1 → 0.
- **Parity test** `packages/ui/src/i18n/locales.test.ts`: the same keys,
  non-empty values and the same `{{placeholders}}` in en and zh.
  Translation keys are now typed from `en.json` instead of a hand-kept union.
- **Behaviour test:** the DOM Health card in Chinese shows "尚未检查" and a
  "检查 DOM 健康度" button. Before: "Unable to find an element with the
  text: 尚未检查". After: passes.
- **Bug fixed on the way:** without an `I18nProvider`, `t()` dropped its
  parameters, so `{{x}}` showed literally.
- **Left in English, by scope:** the Preflight checks' own labels and fixes
  (`services/preflight.ts`), `validateHostUrl` errors and raw provider error
  text. The other 277 strings are elsewhere and the ratchet keeps them from
  growing.

### R9. Human-only items: prepared

`docs/development/real-tenant-validation.md` has the Infor LN re-run with
0.1.0: build, settings, screens, each of the four rule changes with where to
see it (bundle field, or the DOM Health card where the bundle doesn't carry
it), and a results table. `docs/release/SMOKE_TEST.md` says where results go
and to run it for both the unpacked and the Web Store install. Not run.

Only people can do these:

1. The Infor LN real-tenant re-run.
2. The manual smoke matrix on Chrome and Edge stable.
3. The Chrome Web Store submission (unlisted, per the D1 default), including
   the remote-code answer and the data-use form.
4. Turning on GitHub secret scanning and push protection.
5. The Apty Client and Studio teams allow-listing the final IDs (both).
6. Supplying the icon artwork (D6) and checking the LGPL packages.

## Not done, or partial

- **R6 icons:** wait for your artwork (D6). Everything else in R6 is done.
- **R9:** prepared only; the real-tenant re-run, the smoke matrix and the
  store submission need people.
- **R8:** 13 hard-coded strings remain (277 before Phase 4); the ratchet
  stops them growing.

## Conflicts between the prompt and the repo

1. **Facts that differ:** `hooks/use-storage.ts` is not dead (imported by
   `automation-mode-toolbar.tsx` and `browser-agent-config.ts`), so R1 kept it.
   `utils/wait-helper.ts` is at `tools/tools/utils/wait-helper.ts`.
2. **The branding check could not fail** (its `"AIPex"` entry, compared
   case-insensitively, allowed every line). Rewritten in R2.
3. **Existing tests changed, with the reason:**
   - Storage key names in test setups (`aipex_settings` → `apty_settings`,
     `aipex_theme` → `apty_theme`; 11 files, unit and e2e). The asserted
     values are unchanged; where an assertion names the key passed to
     `save()`, only the key changed.
   - Page-visible names in tests (`data-aipex-*`, `aipex-capture-highlight`
     and the like; 9 files): the R2 rename, same assertions.
   - `dom-health-apps.e2e` overlay test expects the matcher `id:apty-agent-`
     instead of `id:aipex-`: the Agent's own UI is still left out, under its
     new id prefix.
   - `element-capture.test.ts`: the fixture's own-class `aipex-x` became
     `apty-agent-x`.
   - `apty-client.e2e`: reads the S7 per-context evidence keys
     (`apty_evidence_store:<context>`); same assertion. Hidden until now by
     the harness ID bug.
   - `stored-data.e2e`: reads `apty-sessions`.
   - `redaction-mode.test.ts`: an unrelated-key fixture renamed.
   - `lifecycle.test.ts` (my R3 test): the settings key by constant.
   - `agent.e2e` A1: waits 1.5 s for the previous test's favicon request
     before clearing the list.
4. **Test harness:** `tempDir` returns the real path (macOS), and
   `launchBrowser` takes `extraArgs` (for the screenshot window size).
5. **Rule slip:** while the e2e suite ran I once ran
   `check-extension-id.test.mjs` (4 tiny script tests). That suite run passed
   120/120.
6. **R7 regression caught by the dry run:** the new Copy button's label
   matched `getByLabel("Extension ID")`; renamed to "Copy this Agent's ID".

## Observed, not changed

- Four production packages are LGPL-3.0-or-later (see R4).
- The items observed at Checkpoint 3 (the IndexedDB names, the inline
  `language === "zh"` strings, the R1 follow-ups) are fixed in Phase 4.
- Phase 1's observations still stand (`git show c2ac898:REVIEW.md`).

## Five-minute owner test, per work package

Build: `npm run build`, then load `apps/browser-extension/dist` unpacked.

- **R1:** `pnpm audit --prod` prints "No known vulnerabilities found";
  `pnpm why @openai/agents-core -r` finds one version.
- **R2:** load the Checkpoint 1 build, save a setting and chat once; load
  this build over it (same folder, Reload). In DevTools → Application,
  `chrome.storage.local` has `apty_settings` and no `aipex_*` key, and
  IndexedDB has `apty-sessions` and no `aipex-sessions`. On any page after
  a chat, Elements shows `data-apty-nodeid` and no `aipex`.
- **R3:** `apty_settings` now has `settingsVersion: 1`.
- **R4:** the build folder has `LICENSE`, `THIRD_PARTY_NOTICES.txt` and
  `assets/Inter-OFL.txt`; delete one and `npm run check:dist-licences` fails.
- **R5:** `tooling/scripts/release-dry-run.sh` ends with "Packages:".
- **R6:** read `docs/store/WEB_STORE_LISTING.md` and the five screenshots in
  `docs/store/screenshots/`.
- **R7:** Settings → Apty Integration → Apty Client → Copy puts the running
  ID on the clipboard; `unzip -p apty-agent-v0.1.0-webstore.zip manifest.json | grep key` prints nothing.
- **R8:** Settings → General → Language → 中文, then open the side panel:
  the DOM Health card is in Chinese.
- **R9:** read the LN re-run section in
  `docs/development/real-tenant-validation.md`.

## After you write "approved"

I will give the exact commands to fetch and verify the bundle, merge it
with `--ff-only`, push, and roll back with `git revert`. I will not push
anything myself.
