# Review: `hardening/open-work` (final: Phases A–D)

| | |
|---|---|
| Branch | `hardening/open-work` (local only, never pushed) |
| Base | `origin/main` at `dc27e2f` |
| Code head | `689698c` (D5); the branch head is the next commit, which updates this file |
| Build zip | `apty-agent-review-final-<head>.zip`: a clean build of the branch head, the contents of `apps/browser-extension/dist` with `manifest.json` at the top |
| Git bundle | `apty-final-<head>.bundle`: refs `HEAD` and `refs/heads/hardening/open-work`, requires `dc27e2f`; every commit of Phases A–D |
| Checksums | `SHA256SUMS.txt` (SHA-256 of the zip and the bundle) |

This file replaces the previous round's `REVIEW.md` (the v7 WP1 review),
following that file's own convention of one review per round; that text is
in git history: `git show dc27e2f:REVIEW.md`. Phase D comes first; the
Phase C, B and A reviews follow, unchanged apart from headings.

## Decisions needed from the owner (all phases)

1. Add "save" to the risky click words? (A1; it would prompt on every Save button)
2. A header line inside JSON exports? (A3; it would make the file invalid JSON)
3. Exempt right-click from the click gate? (A1)
4. Add `@vitest/coverage-v8` at a matching version to `apps/mcp-bridge`, ending the mixed-version warning? (C5; a new dependency)
5. Fix the evidence-id de-duplication bug now? (Observed in C3; a two-line fix with a test, outside every work package's scope)

The skills feature stays (D1: `SKILLS_DECISION` was not edited, so KEEP).

## Commits

| Commit | Work package |
|---|---|
| `79f7e66` | Spec saved as `docs/tasks/master/00-rules.md` plus one file per work package |
| `aa35083` | A1: ask before risky clicks and before opening other origins |
| `b2f58a0` | A2: apply the body deny list to Apty Client bodies |
| `d924303` | A3: a redaction mode setting, honoured by every caller |
| `d50a906` | Checkpoint A `REVIEW.md` |
| `d5fa21c` | B3: a structural summary for JSON bodies |
| `0829dbf` | B4: virtualized lists reported as partial coverage |
| `1784d54` | B5: a switch and site exclusions for the page-world script |
| `d179913` | B2: real-tenant validation bundle and threshold overrides |
| `15ab96e` | Checkpoint B `REVIEW.md` |
| `1a9d225` | C4: re-enable the skipped chat tests, fix Stop while submitted |
| `67ba3d0` | C5: a coverage gate in every package |
| `1acf975` | C3: axe accessibility checks and fixes |
| `c8d0d92` | C1: live model list, tool-calling probe, preset audit |
| `ea932f5` | C2: preflight page, demo script, `demo:check` |
| `371e566` | C5 ratchet raised after Phase C's tests |
| `29d9622` | Checkpoint C `REVIEW.md` |
| `f3c53a8` | D2: Apty Studio as a second peer, Agent side (D1 skipped: kept) |
| `17e7ded` | D3: release dry run, local rehearsal, browser smoke test |
| `0030894` | D4: any ratchet, noConsole, typed CDP params |
| `e1835f5` | D5: DECISIONS.md and PROJECT_PROGRESS.md moved to docs/archive (pure rename) |
| `689698c` | D5: decision index, project guide, link checker, docs vs code |
| branch head | This `REVIEW.md` (final) |

B1 was skipped: see below.

## Final gates (clean build of `689698c`)

```
$ rm -rf apps/browser-extension/dist
$ tooling/scripts/verify-quiet.sh typecheck lint test audit build
✓ typecheck (12s)
✓ lint (1s)
✓ test (63s)
✓ audit (1s)
✓ build (26s)
$ npm run format:check                 → exit 0
$ npm run test:coverage                → exit 0
$ npm run audit:test-skips             ✓ every skipped test says why
$ npm run audit:any                    ✓ 605 explicit any, none above the baseline
$ npm run audit:docs-links             ✓ every relative link in the Markdown files resolves
$ node tooling/scripts/check-extension-id.mjs
✓ The manifest key yields the pinned Agent ID bpiondflhhdplemamgggcdajclmoeple
```

Unit tests (no skipped test anywhere):

```
packages/apty-debug-contract   Tests  72 passed (72)
packages/agent-core            Tests 260 passed (260)
packages/dom-snapshot          Tests 367 passed (367)
packages/ui                    Tests 216 passed (216)
packages/browser-runtime       Tests 870 passed (870)
apps/browser-extension         Tests 291 passed (291)
apps/mcp-bridge                Tests  44 passed (44)
tooling/scripts (node:test)    pass 17, fail 0
```

```
$ npm run test:e2e        (Chromium from /opt/pw-browsers, against the clean build)
# tests 88
# pass 88
# fail 0
# skipped 0
```

| Coverage | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| agent-core | 76.25 | 70.13 | 83.73 | 77.99 |
| dom-snapshot | 90.99 | 82.58 | 97.75 | 92.76 |
| ui | 44.71 | 35.04 | 43.09 | 45.52 |
| browser-runtime | 49.93 | 45.95 | 53.85 | 49.87 |
| apty-debug-contract | 84.91 | 78.46 | 93.18 | 87.66 |
| browser-extension | 43.97 | 44.79 | 41.51 | 43.84 |
| mcp-bridge | 21.27 | 18.15 | 24.74 | 21.51 |

The packaged manifest still has `"externally_connectable": {"ids": []}`;
the unpacked build is 14,669,025 bytes (`du -sb dist`). TruffleHog 3.99.2
over `origin/main..HEAD` (22 commits before this file), no exclude list,
verification off: `"chunks":1168 "bytes":1142864 "verified_secrets":0
"unverified_secrets":0`.

The local release rehearsal (D3), run at `17e7ded`:

```
$ tooling/scripts/release-dry-run.sh
Release dry run for v0.1.0 (nothing is published)
✓ version check (1s)
✓ format lint typecheck test coverage (142s)
✓ build (20s)
✓ real-browser tests (374s)
✓ audits (1s)
✓ pinned extension ID (0s)
✓ package (2s)
✓ checksums (0s)
✓ verify checksums (0s)
Packages: /tmp/release-dry-run/release/
```

## D1: Remove the skills feature (skipped: kept by owner decision)

`SKILLS_DECISION` was not edited, so the default KEEP applies. Nothing was
removed; the `'wasm-unsafe-eval'` CSP allowance, QuickJS and the Skills tab
stay.

## D2: Apty Studio, Agent side (done; Studio itself unchanged)

- `packages/browser-runtime/src/apty/peers.ts`: one peer abstraction for
  the Client and Studio: names, where each ID is stored (the Client keeps
  `clientExtensionId`; Studio uses `peers.studio.extensionId`, an older
  `studioExtensionId` is still read), failure messages (the Client's
  wording unchanged, asserted in a test) and the allow-list fix with the
  Agent's ID filled in. The service-worker provider and the Options check
  take a `peer`.
- `get_apty_studio_service_worker_diagnostics`: Studio's status and logs
  over the Client's contract, through the same helper as the Client's
  tool, so the same redaction applies; recorded as `apty-studio` evidence;
  added to the MCP bridge's static tool schemas.
- Settings → Apty Integration → **Apty Studio Extension**: Detect, its ID
  ("Apty Studio's Chrome ID"), Connect / Test connection / Disconnect, the
  Agent's ID and the manifest snippet in read-only fields with Copy, and
  on `not_allowlisted` the fix: `Apty Studio's manifest must list this
  Agent ID in externally_connectable.ids: "<id>"`.
- `docs/integrations/apty/STUDIO.md` for the Studio team.
- Tests: `peers.test.ts` (both peers, storage, messages),
  `apty-client-panel.test.tsx` (+3 Studio), `tools/apty.test.ts` (+3: not
  configured, logs redacted and recorded, refusal named);
  `studio.e2e.test.mjs` with fixture Studios (not allow-listed, no bridge,
  working: handshake, storage shape, the agent reads Studio's logs).
  `apty-client.e2e.test.mjs` passes unchanged.

## D3: Release dry run and smoke matrix (done; GitHub Actions not run)

- `.github/workflows/release.yml`: `workflow_dispatch` with `dry_run`
  (default `true`); top-level `permissions: contents: read`; the release
  name comes from the tag, or `v<manifest version>` on a branch; audits
  include `audit:test-skips`; a step checks the packaged manifest `key`
  yields `AGENT_EXTENSION_ID`; checksums are verified in the build job;
  `publish` runs only for a `v*` tag ref and (push, or dispatch with
  `dry_run` off). Actions stay SHA-pinned; no new action.
- `tooling/scripts/check-extension-id.mjs` (+3 node tests),
  `tooling/scripts/release-dry-run.sh` (`npm run release:dry-run`; output
  above), `docs/release/SMOKE_TEST.md` (Chrome stable and Edge stable,
  with a results table; says branded Chrome 137+ ignores
  `--load-extension`, so the automated e2e cannot run there).
- **I cannot run GitHub Actions.** The workflow was checked by parsing it
  (Python `yaml`) and reading it against the publish job.

## D4: Typing and logging ratchets (done)

- Explicit `any` (Biome): 612 in 107 files before (452 in tests), 605 in
  104 files after (153 outside tests, was 160). The spec's "126" does not
  match today's tree.
- Security-critical files, before → after: `tools/approval.ts` 0 → 0,
  `runtime/trusted-sender.ts` 0 → 0, `apty/external-messaging.ts` 0 → 0,
  `apty/network-capture-session.ts` 3 → 0, `tools/devtools.ts` 2 → 0,
  `ws-bridge/*` 2 → 0, `apps/mcp-bridge/src/*` 0 → 0. CDP event payloads
  are typed (`automation/cdp-event-params.ts`); no runtime change.
- `noExplicitAny: "warn"`; `tooling/scripts/check-any-baseline.mjs` with
  `any-baseline.json` (`npm run audit:any`, CI) fails when a file's count
  rises or a new file adds one. Proved locally: a new file with one `any`
  gives "packages/agent-core/src/any-probe.ts: 1 (allowed 0)", exit 1.
- `console.log/info/debug`: none left in non-test source (the spec's 81
  were already migrated before this branch). Biome `noConsole` (warn and
  error allowed) with documented exceptions (CONTRIBUTING "Logging and
  typing"). Proved: a probe `console.log` fails `npm run lint`.
- Tests: the MCP executor never logs its token and prints nothing at the
  production level; `console-output.e2e.test.mjs`: no log/debug/info from
  the side panel, Options and the service worker through a chat with a
  tool call and the preflight (proved it catches output by emitting one
  line in each, then reverted). The approval path logs nothing.

## D5: Documentation consolidation (done)

| File | Before | After |
|---|---|---|
| `DECISIONS.md` | 1,535 lines | 57 (index) |
| `docs/development/PROJECT_PROGRESS.md` | 1,647 lines | 60 (one page) |
| `docs/archive/DECISIONS.md` | — | 1,535 (verbatim) |
| `docs/archive/PROJECT_PROGRESS.md` | — | 1,647 (verbatim) |

- The move is its own pure-rename commit (`e1835f5`), so
  `git log --follow` keeps the history.
- The index has one row per decision (41): title linked to its archive
  section, the date it entered git (28 predate the repository's first
  commit and read "≤ 2026-09-30"), and a status (Accepted; Record for
  round summaries; Superseded: the "built, not adopted" logger; Amended by
  B5: the all-sites console bridge).
- `tooling/scripts/check-docs-links.mjs` (+3 node tests;
  `npm run audit:docs-links`; CI) checks files and heading anchors. It
  found no broken link before or after the move.
- Docs vs code: every backticked path and tool name in README,
  SECURITY_AUDIT, ARCHITECTURE and PERMISSIONS was checked against the
  tree and the tool registry. Fixed: README's approval list and Studio
  line, ARCHITECTURE's console-bridge paragraph and tool counts,
  PERMISSIONS' `scripting` and `management` uses, two code comments.

## Phase D: not done, or partial

- D3: the workflow has not run on GitHub.
- D4: content scripts' own log level is unchanged; the console e2e does not
  read console output inside web pages.
- D5: links inside `docs/archive/` are not checked (the files are
  verbatim). A background agent meant to cross-check the four documents
  stopped on a rate limit; the check above is my own.

## Phase D: conflicts between the prompt and the repo

- D2: to keep `apty-client.e2e` unchanged (it uses
  `getByLabel("Extension ID")` and `getByText(<agent id>)` on the tab),
  Studio's field is labelled "Apty Studio's Chrome ID" and the Agent ID is
  visible text only in the Client card; elsewhere it is in read-only
  fields.
- D3: `dry_run: false` from a branch still cannot publish (there is no tag
  to release); documented in the workflow.
- D4: counts differ from the spec (612 `any`, not 126; 0 console calls, not
  81).
- D5: "move unchanged" and "fix every broken link" conflict for links
  inside the archive; the checker skips the archive's own links.

## Phase D: observed, not changed

- README's "What it does today" does not list DOM Health, the redaction
  mode, Fetch models, preflight or the validation bundle.
- ARCHITECTURE's "registry grows from 51 to 54 tools" is a historical
  sentence; `audit:tools` counts 126 registrations today (runtime and MCP
  schemas together).

## Phase D: owner test scripts (about 5 minutes each)

### D2: Studio

1. Settings → Apty Integration. **Expected:** an "Apty Studio Extension"
   card below the Client card, with the Agent's ID and a manifest snippet,
   each with Copy.
2. Paste Apty Studio's real ID (from `chrome://extensions`) and Connect.
   **Expected today:** "Installed, but not answering the Agent." with
   "Apty Studio's manifest must list this Agent ID in
   externally_connectable.ids: "bpiondflhhdplemamgggcdajclmoeple"".
3. Dry run with a fixture: create one with
   `node -e "import('./tooling/e2e/harness.mjs').then(h => h.writeFakeClient('/tmp/fake-studio', 'working', 'bpiondflhhdplemamgggcdajclmoeple', 'Studio'))"`,
   Load unpacked, Connect it in the Studio card. **Expected:** "Answering";
   in the side panel "show apty studio's service worker logs" returns two
   log lines.

### D3: release

1. `tooling/scripts/release-dry-run.sh --skip-e2e`. **Expected:** one ✓
   line per step and two zips plus a `.sha256` in
   `/tmp/release-dry-run/release/`.
2. In GitHub (after merging): Actions → Release → Run workflow (dry_run
   on). **Expected:** the build job uploads the packages; publish is
   skipped.
3. Run `docs/release/SMOKE_TEST.md` on Chrome and Edge with the zip.

### D4: ratchets

1. Add `const x: any = 1;` to any source file, run `npm run audit:any`.
   **Expected:** the file is named with "(allowed 0)" or its baseline
   count, exit 1. Remove it.
2. Add `console.log("x")` to a source file, run `npm run lint`.
   **Expected:** `lint/suspicious/noConsole`, exit 1. Remove it.
3. Load the build, open the side panel's DevTools console, chat once.
   **Expected:** no log/info/debug lines (only warnings or errors, if any).

### D5: docs

1. Open `DECISIONS.md` on GitHub. **Expected:** a table; each title jumps to
   its section in `docs/archive/DECISIONS.md`.
2. Break a link in any `.md`, run `npm run audit:docs-links`.
   **Expected:** the file, line and target, exit 1.

# Phase C

## Checkpoint C gates (clean build of `371e566`)

```
$ rm -rf apps/browser-extension/dist
$ tooling/scripts/verify-quiet.sh typecheck lint test audit build
✓ typecheck (11s)
✓ lint (1s)
✓ test (61s)
✓ audit (1s)
✓ build (20s)
```

Unit tests inside `test` (no skipped test anywhere):

```
packages/apty-debug-contract   Tests  72 passed (72)
packages/agent-core            Tests 260 passed (260)
packages/dom-snapshot          Tests 367 passed (367)
packages/ui                    Tests 216 passed (216)
packages/browser-runtime       Tests 861 passed (861)
apps/browser-extension         Tests 288 passed (288)
apps/mcp-bridge                Tests  44 passed (44)
tooling/scripts (node:test)    pass 10, fail 0
$ npm run audit:test-skips
✓ every skipped test says why
```

```
$ npm run test:e2e        (Chromium from /opt/pw-browsers, against the clean build)
# tests 84
# pass 84
# fail 0
# skipped 0
```

Coverage (`npm run test:coverage`, exit 0; every package now measures all
of `src`, see C5):

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| agent-core | 76.25 | 70.13 | 83.73 | 77.99 |
| dom-snapshot | 90.99 | 82.58 | 97.75 | 92.76 |
| ui | 44.71 | 35.04 | 43.09 | 45.52 |
| browser-runtime | 49.77 | 45.76 | 53.67 | 49.71 |
| apty-debug-contract | 84.91 | 78.46 | 93.18 | 87.66 |
| browser-extension | 43.86 | 44.59 | 41.22 | 43.72 |
| mcp-bridge | 21.27 | 18.15 | 24.74 | 21.51 |

The packaged manifest still has `"externally_connectable": {"ids": []}`.
TruffleHog 3.99.2 over `origin/main..HEAD`, no exclude list, verification
off: `"chunks":1068 "bytes":1036641 "verified_secrets":0 "unverified_secrets":0`.

## C4: The skipped tests (done)

The ten skips were all in `packages/ui`:

| Test | Outcome |
|---|---|
| use-chat: reset and delete the session; message handlers; tool handlers; context items; onError; tool call parts | Passed unchanged when re-enabled; re-enabled (a stale NOTE comment removed) |
| use-chat: regenerate | Failed only because the mock agent lacked `rollbackLastAssistantTurn`, added to `useChat` after the test; mock added, assertions strengthened |
| use-chat: interrupt an active stream | **Real bug.** Stop pressed while a turn was still "submitted" (before its generator existed) was lost and the turn started anyway. Fixed with a turn token in `use-chat.ts`; the test now waits for the stream, and a new test, "never starts a turn that was stopped while still submitted", fails on the old code (proved) |
| chatbot: `onNewChat` / `onSettingsOpen` via `handlers` | Targeted props `Chatbot` never had (its own skip comment said so). Settings: deleted, covered by "should call chrome.runtime.openOptionsPage when settings button is clicked". New Chat: replaced by "New Chat clears the conversation and deletes its agent session" |

A second Stop gap: the side panel's own toolbar only offered Stop while
"streaming", so Stop was impossible while "submitted". Now Stop in both
(`automation-mode-toolbar.test.tsx`).

Covered by: Stop while streaming: use-chat "should interrupt an active
stream" and the toolbar test; Stop while submitted: use-chat "never starts
a turn…" and the toolbar test; reset / new chat: use-chat "should reset
chat state…" and chatbot "New Chat clears…"; settings: chatbot "should call
chrome.runtime.openOptionsPage…". No e2e added.

`tooling/scripts/check-test-skips.mjs` (`npm run audit:test-skips`, a CI
step, and 5 node tests) fails on a `.skip`/`.skipIf` without
`// skip-reason:` on that line or the one above. It is not in
`verify-quiet.sh` (not to be overwritten); run it separately.

## C5: Coverage gate (done)

Measured at the start of C5 (all of `src/**/*.{ts,tsx}`, tests excluded),
S/B/F/L: agent-core 76.32/70.31/83.73/78.14; dom-snapshot
90.99/82.58/97.75/92.76; ui 42.77/32.42/41.27/43.62; browser-runtime
47.78/44.57/51.08/47.63; apty-debug-contract 84.91/78.46/93.18/87.66;
browser-extension 38.84/37.79/38.84/38.86; mcp-bridge 21.27/18.15/24.74/21.51.

- `test:coverage` in every package; `mcp-bridge` wired into the root
  script, which CI already runs.
- Thresholds one point below the measured value (re-measured after the
  targeted tests, and raised again after Phase C), documented in
  `docs/development/coverage.md` with the rule that they only go up.
- The six trust-boundary files in browser-runtime and the three
  redaction files in the contract keep their old numbers, as glob groups.
- Targeted tests: chat image downloads (path-traversal guard, data URLs
  only; 0% before), the background router's download request (sender gate
  and fallbacks), the WebSocket MCP executor and transport (0% before:
  localhost only, token only as a subprotocol and never in status, tool
  dispatch, errors, timeout, reconnect vs. user disconnect), cross-extension
  message failures (57% branches before), Settings' Save and Test
  Connection.
- Proved locally, not committed: a 99% statements threshold on the
  critical group gives "ERROR: Coverage for statements (91.92%) does not
  meet … threshold (99%)" and exit 1; a ui global threshold of 45 gives
  "does not meet global threshold (45%)".

## C3: Accessibility (done)

- `axe-core` 4.13.0 is the only new dependency (pinned exactly; 4.14.0
  was five days old). `runAxe(page)` in the harness waits for CSS
  transitions to settle first (a button switching variants measured
  3.32:1 mid-transition) and reports each node's markup and axe's reason.
- `tooling/e2e/a11y.e2e.test.mjs`: the side panel empty, with an approval
  prompt, after a tool result, with the investigation summary and the full
  response viewer, and every Options tab, in light and dark; fails on
  serious or critical. **No rule disabled.**
- Fixes (table in `docs/development/accessibility.md`): `--muted-foreground`
  and `--success` reach 4.5:1; dark destructive alert and built-in badge
  colours; names for every icon-only button and select found; the approval
  `alertdialog` is named by its title; the skill upload's file input is the
  control instead of a `role="button"` wrapper around it.
- Proved it can fail: removing the approval prompt's `aria-labelledby` and
  rebuilding gives "serious aria-dialog-name"; restored.

## C1: Live model list, tool-calling probe, preset audit (done; no real provider called)

- **Fetch models** beside the model field: OpenAI-compatible
  `GET {base}/models` with Bearer; Anthropic `GET {base}/models?limit=1000`
  (+`after_id`) with `x-api-key` and `anthropic-version: 2023-06-01`; Gemini
  `GET {base}/models?pageSize=1000` (+`pageToken`) with `x-goog-api-key`,
  keeping models that support `generateContent`. Up to five pages, 10 s
  timeout, 10-minute cache per provider and base URL (successes only),
  hosts through `validateHostUrl`, named 401/403/404/429/network/timeout
  errors, presets and manual entry kept on failure.
- **Probe** after Test Connection's basic request: one tool
  `report_probe` (never executed), 15 s, one retry when inconclusive.
  "no" = answered without calling it, or a 400/404/422 saying tools are
  unsupported. Saved on the model config for that model id; badge by the
  model field, "No tools" in the list, and a confirmation before selecting
  a model whose last probe said no.
- **Preset audit** (sources below): the Anthropic host was
  `https://api.anthropic.com`, and `@ai-sdk/anthropic` appends `/messages`,
  so every chat went to a 404; the preset is now `…/v1` and
  `createAIProvider` adds `/v1` to a bare origin so saved settings work.
  Together `api.together.ai`; Cohere's OpenAI compatibility URL
  `https://api.cohere.ai/compatibility/v1` (its `/v1` is the native API);
  DeepSeek `https://api.deepseek.com`; Azure the v1 form
  `https://YOUR-RESOURCE.openai.azure.com/openai/v1` (model = deployment
  name). Suggestions: Anthropic `claude-opus-5-5`, `claude-sonnet-5-5`,
  `claude-haiku-5-5`, `claude-fable-5-1` (docs: no floating aliases); Gemini
  `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`;
  Mistral `-latest` kept; DeepSeek `deepseek-flash`, `deepseek-v4-pro`;
  Perplexity `sonar`, `sonar-pro`; every other list emptied. Replicate (no
  OpenAI-compatible chat API) and Perplexity (tool calling undocumented)
  are kept and marked experimental in Settings. Built-in providers saved
  on a superseded host move to the current one.
- Tests: parsers and requests per provider, errors, cache, SSRF refusals,
  probe classification and retry, Settings UI (fetch, failure, badge,
  warning); e2e `model-settings.e2e.test.mjs` against the mock model:
  fetch 401 with manual fallback, fetch success, probe yes / no (text) /
  no (400 refusal) / unknown (503 twice, three requests).

How the docs were checked: a research agent could read only
platform.claude.com in full (this session's proxy blocked the other docs
hosts); the other rows come from web-search extracts of each provider's
own documentation domain. Anything those did not state was treated as
unverified and not hardcoded.

## C2: Preflight page and demo docs (done)

- Options → Apty Integration → **Preflight** (`#preflight`; a bare hash
  now opens the right tab): Run all checks → pass / warn / fail, each with
  its fix and a Copy button: AI provider (live test with latency and the
  probe), Apty Client (installed, handshake, request list; the fix names
  the manifest change with this Agent's ID for `not_allowlisted`, the
  bridge module for `bridge_missing`), this extension's ID, the page and
  every frame answering, console-capture coverage per frame, clipboard
  permission, whether a page script can read extension storage, data
  handling. Export results as redacted JSON; Reset demo data (reuses the
  purge, with confirmation).
- `docs/demo/DEMO.md`; `pnpm demo:check` builds and runs
  `tooling/e2e/preflight.e2e.test.mjs`: all green against the fixture
  Client and a mock model that calls tools, then no API key, a Client that
  does not allow-list the Agent, one without the bridge, and no open page,
  each with its own fix.
- Test Connection and the purge moved to shared services.

## Phase C: not done, or partial

- C1: no real provider was called (no keys); Anthropic's need for
  `anthropic-dangerous-direct-browser-access` from an extension page is
  unverified (extension pages with host permissions are not subject to
  CORS, and chats already reach Anthropic without it).
- C2: in DEMO.md only the segments.json prompt is exercised by e2e; "show
  the apty client's service worker logs" and "why isn't my Apty widget
  showing?" (needs a real Widget) are not.
- C3 covers the screens listed; DOM Health results and the skill detail
  dialog are not in the axe suite.

## Phase C: conflicts between the prompt and the repo

- C1: `ai-provider.test.ts` asserted Groq's first suggestion is
  `openai/gpt-oss-20b`; C1 forbids unverifiable names, so the test now
  asserts Groq has no suggestions (no stale default). Changed, not deleted.
- C1: Replicate was flagged experimental rather than removed, so saved
  settings that reference it still load.
- C1: Anthropic docs now also accept `Authorization: Bearer`; the model
  list uses `x-api-key`, as the chat SDK does.
- C2: Options has no conversation, so "bound tab" is the most recently
  used http(s) tab, named in the result.
- C2: the clipboard check queries the permission rather than writing,
  which would overwrite the user's clipboard. The storage check runs a
  content script that tries to read a key that never exists (Chrome has no
  getter for the access level).
- C3: "the evidence viewer" was taken as the investigation summary and the
  full response viewer.
- C5: `mcp-bridge` has no coverage provider of its own and adding one is a
  new dependency; it uses the root `@vitest/coverage-v8` 4.1.0 with its
  Vitest 4.1.11, and Vitest prints "Running mixed versions is not
  supported". It works today (decision 4 below).

## Phase C: decisions needed from the owner

4. Add `@vitest/coverage-v8` at a matching version to `apps/mcp-bridge`'s
   devDependencies, to end the mixed-version warning?

## Phase C: observed, not changed

- **Evidence ids after de-duplication (a real bug, found by C3's test).**
  `recordEvidence` drops a repeat of the same request but returns a new
  `evidenceId` that is never stored. Inspecting `segments.json` a second
  time in one browser session gives the model and the UI an id the viewer
  cannot find ("The full response is no longer available in this
  session."). Suggested fix: return the stored record's id on a duplicate.
  The a11y test inspects a different resource per theme because of it.
- `downloads.ts` does not advance the image index when a download throws,
  so the next image takes the failed one's name; `data:image/svg+xml` gets
  the extension `svg+xml`.
- Settings' "Please fill in all required fields" save path is
  unreachable from the UI (Save is disabled until key and model exist).
- `--warning` (amber) as text on white is about 3.2:1 (DOM Health tone
  classes); not in a screen the axe suite covers.
- Test Connection logs the raw provider error with `console.error` (moved
  unchanged into `connection-test.ts`); AI SDK errors can carry the request
  body (the prompt "Hi"; never the key) and the response body.

## Phase C: owner test scripts (about 5 minutes each)

Setup as for Phase A (load the unzipped build, configure a model).

### C1: models and tool calling

1. Settings → AI Configuration → your provider. Paste a wrong key, click
   **Fetch models**. **Expected:** "The provider rejected the API key
   (401). Pick a suggestion or type the model id." and the model field
   still accepts typing.
2. Paste the right key, **Fetch models**. **Expected:** "N models from the
   provider", and the model field's suggestions list them.
3. Pick a model known to call tools, **Test Connection**. **Expected:**
   "Connection test successful · Tool calling: yes" and a badge.
4. Pick a model your provider documents as not supporting function
   calling, **Test Connection**. **Expected:** "… Tool
   calling: no — the agent needs it", "No tools" in the provider list;
   selecting another provider and back asks for confirmation.
5. Select **Anthropic** with a key and send a chat. **Expected:** an answer
   (before C1 the preset host made every request 404).

### C2: preflight

1. Open `chrome-extension://<id>/src/entrypoints/options/index.html#preflight`.
   **Expected:** Apty Integration opens with the Preflight card.
2. With the provider, the Client (or the fixture Client from DEMO.md) and
   an application tab ready: **Run all checks**. **Expected:** "All checks
   passed."
3. Remove the Client ID in Apty Integration (Disconnect), run again.
   **Expected:** Apty Client fails with "Fix: Open Settings → Apty
   Integration, click Detect …"; **Copy** copies that fix.
4. **Export results (redacted JSON)**. **Expected:** a file
   `apty-preflight-<time>.json` with `schema: apty-preflight/1`.
5. **Reset demo data** → **Delete conversations and screenshots**.
   **Expected:** "Demo data reset…"; the side panel's history is empty.

### C3: accessibility (spot check)

1. In Options turn on dark theme. **Expected:** muted text and the green
   "Answering" badge stay readable.
2. With a screen reader or the Accessibility pane of DevTools, inspect the
   eye icon by the API key. **Expected:** named "Show API key".

### C4: Stop

1. Ask a long question and click the send button while it shows the
   spinner. **Expected:** the turn stops and nothing streams afterwards.

# Phase B

## Checkpoint B gates (clean build of `d179913`)

```
$ rm -rf apps/browser-extension/dist
$ tooling/scripts/verify-quiet.sh typecheck lint test audit build
✓ typecheck (11s)
✓ lint (1s)
✓ test (56s)
✓ audit (2s)
✓ build (21s)
```

Unit tests inside `test`:

```
packages/apty-debug-contract   Tests  72 passed (72)
packages/agent-core            Tests 260 passed (260)
packages/dom-snapshot          Tests 367 passed (367)
packages/ui                    Tests 200 passed | 10 skipped (210)   (the 10 skips are pre-existing; C4)
packages/browser-runtime       Tests 839 passed (839)
apps/browser-extension         Tests 214 passed (214)
apps/mcp-bridge                Tests  44 passed (44)
tooling/scripts (node:test)    pass 5, fail 0                         (new: npm run test:scripts)
```

```
$ npm run test:e2e        (Chromium from /opt/pw-browsers)
# tests 65
# pass 65
# fail 0
# skipped 0

$ npm run test:coverage   (CI's gate; not part of verify-quiet)
browser-runtime      Statements 90.52%  Branches 82.6%   Functions 93.15%  Lines 92.72%   (exit 0)
apty-debug-contract  Statements 91.7%   Branches 84.67%  Functions 96.42%  Lines 94.83%   (exit 0)
```

The coverage numbers equal checkpoint A's because the gate's include list
covers only a few files; widening it is C5.

The packaged manifest still has `"externally_connectable": {"ids": []}`.

Secret scan, TruffleHog 3.99.2 over every commit in `origin/main..HEAD`,
no exclude list, verification off:

```
$ trufflehog git file://. --since-commit origin/main --branch hardening/open-work --no-verification --no-update --json
"chunks":886  "bytes":861160  "verified_secrets":0  "unverified_secrets":0
```

## B1: Production Widget module (skipped)

The spec says to skip B1 when `docs/integrations/apty/reference-js/` is
missing. It is missing at `dc27e2f` and on this branch, so there is no
`producer.ts`, no paste bundle, no producer e2e and no
`VERIFY_WITH_REAL_CLIENT.md`. Nothing was claimed about a real Client.

## B2: Real-tenant validation tooling (done; the tenant run is the owner's)

What changed:

- `packages/browser-runtime/src/apty/dom-health-thresholds.ts` (new): one
  registry of the tunable thresholds (seed link count, same-URL edges and
  share, unreadable-frame share, unseen virtualized share, collector
  budget, three virtualization detector values), each with default,
  bounds, description and an `unverified` flag. Traversal, scoring, the
  frame collector and the virtualization detector read from it; the old
  exported constants are kept and equal the defaults.
- `AppSettings.domHealthThresholdOverrides`: honoured only while Developer
  tools is on (side panel card and the agent tools). Unknown names,
  non-numbers and out-of-range values are rejected with a reason; every
  active or rejected override is listed in the audit result
  (`thresholdOverrides`) and the bundle. Defaults are unchanged.
- Settings → Troubleshooting (Developer tools on): a JSON field for the
  overrides; invalid JSON is not saved and says so.
- `packages/browser-runtime/src/apty/validation-bundle.ts` (new):
  `buildValidationBundle` copies fields from an allow-list (never copies a
  result and strips it): hosts; URL templates (origin, path with ids
  masked, hash route, never a query); the frame tree with keys only from
  `top`, `data-osp-id`, `name` or `id` (a title key is kept as a hash);
  roles, reasons and failures; counts, coverage, confidence caps, overlays
  with evidence level, duplicate-id counts, virtualized lists, timings and
  `withinBudget`; application coverage, state and transition counts and
  traversal; the route probe's hashes and counts; every threshold; and
  extension and Chrome versions. The result then goes through the DOM
  Health exit redaction and strict contract redaction, whatever the
  redaction mode.
- DOM Health card: "Export validation bundle" (enabled once a page
  result, application result or finished route probe exists) opens
  "Review before sharing" with the exact JSON and Download, Copy, Cancel.
  The route probe hands its finished report to the card.
- `tooling/scripts/bundle-to-fixture.mjs` (new): a bundle becomes
  `<name>.html` (frame-tree skeleton, overlay placeholders, hosts replaced
  with `host-N.example.test`), `<name>.values.json` and a
  `<name>.fixture.test.ts` stub with one `it.todo` per check. It refuses
  other schemas, non-kebab names and overwriting.
- Docs: `docs/development/real-tenant-validation.md` (new: tenant rules,
  athenaOne and LN screens, the checks and the bundle field for each, what
  to send back), `dom-health-architecture.md` (known limitations),
  `PRIVACY.md` (exports), `docs/STATUS.md`.

Tests:

- Unit: `validation-bundle.test.ts` (5): a fixture with a name, record
  number, email, page title, input value and cookie in fields the bundle
  reads and in fields it must not read; none appears in the JSON, URL
  templates have no query, and the structure is checked field by field.
  `dom-health-thresholds.test.ts` (7, including an override changing a
  traversal decision and resetting), `tools/dom-health.test.ts` (+2:
  overrides only with Developer tools), `troubleshooting-card.test.tsx`
  (+10), `validation-bundle-export.test.tsx` (4),
  `dom-health-card.test.tsx` (+1), `bundle-to-fixture.test.mjs` (5).
- e2e, `dom-health-apps.e2e.test.mjs` (6 new): on each of the six
  application shapes, the real side panel runs Check DOM Health (Audit
  Application on the SPA), exports, and the reviewed JSON has the schema,
  the manifest's version, a Chrome version, the host, the active override,
  no URL template with a query, and none of that page's text, titles,
  tenant id or session parameter.

## B3: Structural summary for JSON bodies (done)

- `apty/json-body-summary.ts` (new): `summarizeJsonBody` returns kind, item
  count, top-level keys, the union of item keys with their types, how many
  whole items the preview holds and whether it is partial, in under 1,500
  characters (30 keys, 5 preview items at most).
- The Client resource inspector returns it as `json`; tool descriptions
  and the system prompt tell the model to read it before paging.
- Tests: `json-body-summary.test.ts`, inspector tests, `wp1-acceptance`
  (see conflicts).

## B4: Virtualized lists (done)

- `packages/dom-snapshot/src/health-virtualized.ts` (new): a list is
  virtualized on `aria-rowcount`/`aria-setsize` above the rendered rows, a
  gap in `data-index`/`aria-rowindex`, a tall empty spacer, or a scroll
  height far beyond its rendered rows; nested findings merge.
- Scoring: a confidence cap when more than half of the declared rows were
  never rendered, the risk `virtualized-list-partial-coverage`, and
  `result.virtualized`; the route probe shows rendered/declared rows.
- Tests: detector and scoring units; e2e on a 1,000-row grid with 15
  rendered (counts, signals, LOW confidence, risk, scroll position left
  alone).

## B5: Page-hook kill switch (done)

- The MAIN-world console bridge left the manifest. The service worker
  registers it with `chrome.scripting.registerContentScripts`
  (`runtime/page-hooks-registration.ts`), excludes the listed sites, and
  unregisters it when Settings → Troubleshooting → "Track client-side
  routing and capture console output from page load" is off. Settings
  changes reconcile at once.
- With the hooks off, DOM Health reports routing evidence as unavailable
  (never as "no routing"), the route probe shows unknown counts, and the
  console tool does not inject the bridge.
- `validate-manifest.mjs` checks the emitted bridge path.
- Tests: registration units; e2e on an excluded site (no bridge, routing
  reported unavailable).

## Phase B: not done, or partial

- B1 skipped (above).
- B2: the bundle has not been produced on a real athenaOne or Infor LN
  tenant; that is the owner's run. No threshold was tuned.
- B2: overrides for the collector budget and virtualization thresholds
  reach the content script through the collect message; that path is
  unit-tested, while the e2e exercises an override that the service-worker
  side reads (`sameUrlRatioForClickFirst`).
- B4: the optional scroll sample was not built; the audit never scrolls.

## Phase B: conflicts between the prompt and the repo

- B2: the spec lists the `data-*` free-text cut-off and the
  structure-only cap among the unverified values. The cut-off is in the
  collector's privacy code, not a threshold the audit reads, and the
  structure-only cap is a rule, not a number; neither is in the registry.
- B2: the spec asks for the button "in the DOM Health card and Developer
  tools". Developer tools in Settings live in `@apty/ui`, which may not
  depend on `@apty/browser-runtime`; the button is in the DOM Health card,
  where the developer route probe is, and covers its report.
- B2: the threshold overrides are a global in the service worker or side
  panel for the duration of an audit; two audits running at once in the
  same context would share the later one's overrides.
- B3: at `dc27e2f` the inspector already returned a small `json` summary
  with a 5-item `sample`. B3 replaced `sample` with the key union and
  types; `wp1-acceptance` asserted `json.sample` length, so the same bound
  is now asserted on the parsed preview and `json.inPreview`. A JSON
  object body used to be put in the preview whole, with no size cap;
  fixed.
- B5: the spec says to resolve the hashed script path from the built
  manifest. With the bridge gone from the manifest there is nothing to
  resolve, so the build emits it at `content/console-bridge.js` and the
  validator checks both sides. `match_about_blank` has no equivalent in a
  registered script; `matchOriginAsFallback` is used.
- B5: `page-hooks.test.ts` and `frame-responder.test.ts` were adapted to
  the install-time announcement and the new `historyHooksSeen` field, with
  a test added for each.
- B5 (my error, fixed): a `git checkout` while proving the validator
  reverted uncommitted `vite.config.ts` edits; they were re-applied and
  the clean build and full e2e (59/59 then) re-run before committing.

## Phase B: decisions needed from the owner

The three Phase A decisions are still open (below). No new one.

## Phase B: observed, not changed

- The application audit does not aggregate `virtualized` across states;
  each state's page result carries it.
- The coverage gate's include list is narrow, so B's new modules do not
  move its numbers (C5).
- `tooling/e2e/agent.e2e.test.mjs` line 198 has a Biome `useTemplate`
  info (string concatenation), from A1; info only, `lint` passes.

## Phase B: owner test scripts (about 5 minutes each)

Setup as for Phase A below (load the unzipped build, configure a model).

### B2: validation bundle

1. Settings → Troubleshooting: turn on **Developer tools**. **Expected:**
   a "DOM Health: threshold overrides (JSON)" field appears. Type
   `{"sameUrlRatioForClickFirst": 0.4}` and click elsewhere. Type
   `{"x": "1"` and click elsewhere. **Expected:** "Needs a JSON object
   whose values are all numbers. Not saved." Restore the first value.
2. Open any page with a form (for example
   `https://httpbin.org/forms/post`) and the side panel. Click **Check DOM
   Health** and wait for "Last checked".
3. Click **Export validation bundle**. **Expected:** "Review before
   sharing" with JSON whose `schema` is `apty-dom-health-validation/1`,
   `hosts` is `["httpbin.org"]`, `thresholdOverrides.active` lists
   `sameUrlRatioForClickFirst` 0.4 (default 0.5), `thresholds` lists nine
   entries, and no field contains the page's labels or title.
4. Click **Copy**, paste somewhere: the same JSON. Click **Download**:
   a file `apty-dom-health-validation-<time>.json`.
5. Turn Developer tools off and run step 2–3 again. **Expected:**
   `thresholdOverrides.active` is empty.
6. For the real tenants: follow `docs/development/real-tenant-validation.md`.

### B3: JSON summary

1. With the fake Client from the A2 script connected, ask: "List the
   items in segments.json from the Apty Client." **Expected:** the answer
   says 206 items and names their keys; the tool result (expand it) has
   `json.itemCount: 206`, `json.itemKeys` with types and `json.inPreview`.

### B4: virtualized lists

1. Save the `VIRTUALIZED_PAGE` markup from
   `tooling/e2e/dom-health-apps.e2e.test.mjs` as `grid.html`, serve it
   with `python3 -m http.server 8000`, open it, scroll the grid.
2. Click **Check DOM Health**. **Expected:** confidence Low with "1
   virtualized list(s) render 15 of 1000 declared rows; the other 985 were
   not audited."; the grid's scroll position does not move.

### B5: page-script switch

1. Open any page, then ask "show the apty page logs from page load".
   **Expected:** console output from load is returned.
2. Settings → Troubleshooting: add that page's host to "Sites where that
   script never runs", reload the page, ask again. **Expected:** only
   output after the request; DOM Health's routing evidence reads
   "unavailable" rather than zero.
3. Turn the switch off: the site list disappears; turn it back on.

# Phase A

### Checkpoint A gates (at `d924303`)

```
$ rm -rf apps/browser-extension/dist
$ tooling/scripts/verify-quiet.sh typecheck lint test audit build
✓ typecheck (10s)
✓ lint (1s)
✓ test (52s)
✓ audit (1s)
✓ build (20s)
```

Unit tests inside `test`:

```
packages/apty-debug-contract   Tests  72 passed (72)
packages/agent-core            Tests 260 passed (260)
packages/dom-snapshot          Tests 355 passed (355)
packages/ui                    Tests 188 passed | 10 skipped (198)   (the 10 skips are pre-existing; C4)
packages/browser-runtime       Tests 788 passed (788)
apps/browser-extension         Tests 202 passed (202)
apps/mcp-bridge                Tests  44 passed (44)
```

Audit step: manifest valid, no architecture-boundary violations, no
unreviewed branding, no duplicate tool names, MCP bridge docs consistent.

```
$ npm run test:e2e        (Chromium from /opt/pw-browsers, against the clean build)
# tests 56
# suites 10
# pass 56
# fail 0
# cancelled 0
# skipped 0

$ npm run test:coverage   (CI's gate; not part of verify-quiet)
browser-runtime  Statements 90.52%  Branches 82.6%  Functions 93.15%  Lines 92.72%   (exit 0)
apty-debug-contract  Statements 91.7%  Branches 84.67%  Functions 96.42%  Lines 94.83%   (exit 0)
```

The packaged manifest still has `"externally_connectable": {"ids": []}`.

## Secret scan of the diff

TruffleHog 3.99.2 (the version CI pins; download checked against the
release's published SHA-256), over every commit in `origin/main..HEAD`,
with no exclude list and with verification turned off so no candidate is
sent to a third party:

```
$ trufflehog git file://. --since-commit origin/main --branch hardening/open-work --no-verification --no-update --json
"chunks":707  "bytes":681296  "verified_secrets":0  "unverified_secrets":0
```

## A1: Gate state-changing clicks and new tabs (done)

What changed:

- `packages/browser-runtime/src/tools/click-risk.ts` (new):
  - `classifyClickRisk(target)` is pure. A click is risky when the target
    is a submit control (`button[type=submit]`, `input[type=submit|image]`,
    a typeless `button` inside a `<form>`), or its accessible name contains
    a word from `RISKY_CLICK_WORDS`, or it links to another origin (or a
    non-web URL), or it sits on a frame or canvas, or it cannot be found.
  - `classifyNewTabUrl(url, currentPageUrl)` decides the new-tab policy.
  - `inspectClickTargetInPage` finds the element by snapshot uid (in any
    frame, through open and closed shadow roots) or at a viewport point,
    and describes the control a click would activate.
  - `describeClickForApproval` builds the prompt text: role, accessible
    name, tag, form method and action, link and page origin.
- `click`: safe clicks run at once; risky ones go through `gateRiskyAction`.
- `computer`: the click actions and `left_click_drag` map the screenshot
  point to the element under it (both ends of a drag) and apply the same
  rules. With no screenshot to map the point, or a frame or canvas under
  it, the click asks.
- `create_new_tab`: the same origin as the current tab opens at once.
  Another origin asks, and an "Allow on this site" grant is keyed on the
  destination origin. A non-`http(s)` scheme, or a query plus fragment over
  128 characters, always asks and never offers "Allow on this site". The
  prompt shows the full URL.
- `gateRiskyAction` takes `{ rememberable: false }`: it ignores and never
  creates grants. The prompt hides "Allow on this site" for such requests.
- Every affected tool description has an `APPROVAL:` sentence and tells the
  model that a `denied` result must not be retried. MCP calls use the same
  tools and the existing relay.
- Docs: `docs/security/SECURITY_AUDIT.md` finding #18,
  `docs/security/PERMISSIONS.md` "Tools that wait for a person's click",
  `docs/STATUS.md`.

Tests:

- Unit:
  - `click-risk.test.ts` (33): the classifier table, the new-tab policy for
    same origin, cross origin, long query, long fragment, `data:`,
    `javascript:`, `chrome:` and unparseable URLs, and the inspector
    wrapper (fails closed).
  - `element.test.ts` (+5: click).
  - `computer.test.ts` (+4).
  - `tab.test.ts` (5, new).
  - `approval.test.ts` (+1: a non-rememberable request).
  - `approval-prompt.test.tsx` (+1: no remember button).
- e2e, "approval for clicks and new tabs (A1)" in `agent.e2e.test.mjs`
  (6 tests):
  - Deny on `create_new_tab` to `http://127.0.0.1:<evil port>/?d=<200-char
    secret>` leaves the evil server with **zero requests**, and the prompt
    offers no "Allow on this site".
  - "Allow once" opens it.
  - A benign click runs with no prompt.
  - A "Delete" submit button prompts (showing `Form: POST …/orders/delete`)
    and Deny leaves the page counter at 0.
  - A `computer` click at that button's coordinates prompts.
  - "Allow on this site" for `click` does not enable `create_new_tab`, and
    "Revoke all" in Options makes the click ask again.

  All existing agent tests still pass.

## A2: Deny list for Apty Client bodies (done)

What changed:

- `inspectResource` loads Settings → Data handling's deny list itself and
  checks the resource URL before `getResourceBody`. On a match:
  - it returns `status: "body_denied"`, the request metadata, `deniedBy`
    (the entry) and how to change it;
  - it never calls the Client's `get-resource-body`;
  - it records no evidence, so `get_evidence_json` cannot expose the body.
- `matchingDenyEntry` reports which entry matched (`isUrlDenied` uses it).
- Data-handling card:
  - the list stays editable when page capture is off (Client bodies don't
    depend on that switch);
  - its copy says it covers the Apty Client;
  - the placeholder shows `/users/`, `/api/me` and `/userinfo` as examples;
  - the default stays `[]`.
- `PRIVACY.md`, `docs/TROUBLESHOOTING.md`, `docs/STATUS.md` and the
  inspect tool's description explain `body_denied`.

Tests:

- Unit: `extension-network-inspector.test.ts` (+5): denied (never asks the
  Client, no evidence), a host entry, an allowed body in full, and an empty
  list or no settings. `resource-body-utils.test.ts` (+2) and
  `data-handling-card.test.tsx` (+1, 1 updated).
- e2e, `apty-client.e2e.test.mjs` (1 new):
  - the fake Client serves `/users/4815162342.json` and `segment.json`;
  - with `/users/` on the list the agent gets `body_denied`, and the
    Client's recorded `get-resource-body` calls are exactly `["r1"]` (the
    segments body), so the denied body was never requested;
  - `segment.json` returns in full;
  - clearing the list returns the preference body.

## A3: Redaction mode control (done)

What changed:

- `AppSettings.redactionMode` (default `"strict"`).
- `packages/browser-runtime/src/runtime/redaction-mode.ts` is the one
  accessor:
  - `getRedactionMode()` reads the setting once and caches it;
  - `chrome.storage.onChanged` updates the cache;
  - `currentRedactionMode()` is strict until the first read completes;
  - callers redact only through `redactText` and `redactLogEntries`.
- All 17 call sites in 10 files were moved to those wrappers. The side
  panel and the service worker read the mode at startup.
- `redaction-mode.test.ts` scans every non-test source file in
  browser-runtime, the extension app, ui, agent-core and dom-snapshot, and
  fails on any direct call to the redaction library. I proved it fails by
  adding a temporary direct call (not committed).
- Settings → General → Data handling → Redaction:
  - Strict (recommended), Standard, and Off (development only), each with a
    plain description and its own Preview of a fake sample, before and
    after;
  - Off opens a confirmation dialog that says structural secret redaction
    stays on;
  - the preview function is passed in by the options page, so `@apty/ui`
    still depends only on agent-core.
- Side panel: a persistent "Redaction is OFF" banner with a Change button.
- Exports: message Copy and Download begin with
  `Apty Agent export · redaction mode: <mode> · <ISO time>`. The response
  viewer adds that header to text bodies, and for JSON puts the mode in the
  file name and next to the buttons (see Decisions).
- `PRIVACY.md` (mode table) and `docs/STATUS.md`.

Tests:

- Unit:
  - `redaction-mode.test.ts` (16): reads, defaults, caching (one storage
    read), invalidation by change events, ignores other areas and keys,
    Strict vs Standard vs Off output, a JWT masked in Off, and the bypass
    scan.
  - `redaction-mode-control.test.tsx` (6), `export-header.test.ts` (3),
    `message-item.test.tsx` (+1), `redaction-off-banner.test.tsx` (4) and
    `redact.test.ts` (+1).
- e2e, `redaction.e2e.test.mjs` (3, new):
  - a fresh profile is strict, and the model sees neither the page title
    nor the username;
  - Standard shows the page title and still masks the username;
  - Off needs confirmation ("Keep current mode" leaves Standard), the mode
    survives an Options reload, the side panel shows "Redaction is OFF" and
    keeps it after a reload, the username is visible, and the JWT is still
    masked.

## Phase A: not done, or partial

Nothing in Phase A is partial. Not verified:

- A real model was not used; every e2e test drives the real side panel with
  a scripted model. Whether a real model retries after a `denied` click is
  up to the model; the tool tells it not to.
- No real Apty Client and no real customer tenant were used (B1 and B2 are
  the owner's runs).
- The MCP path for the new click and tab gates is covered by the existing
  relay tests and unit tests, not by a new MCP e2e test.

## Phase A: conflicts between the prompt and the repo

- The prompt says `origin/main` has 190 commits; `git rev-list --count
  origin/main` gives 107 at `dc27e2f`.
- Owner checklist:
  - the boxes were not ticked;
  - `docs/integrations/apty/reference-js/` is absent, so WP-B1 will be
    skipped and reported in Phase B;
  - `SKILLS_DECISION` was not edited, so the default KEEP applies (D1);
  - Chromium is at `/opt/pw-browsers`.
- The prompt's bundle command `git bundle create … origin/main..HEAD`
  produces a bundle with only a `HEAD` ref, which the apply command `git
  fetch <bundle> hardening/open-work:bundle-work` cannot fetch. I built the
  bundle with both `HEAD` and `refs/heads/hardening/open-work` and tested
  the apply flow in a scratch clone (fetch, "fast-forward OK", 4 commits).
- A1:
  - **"save" is not in the word list.** The spec's examples don't name it,
    and the existing core-tools e2e clicks a "Save order" button expecting
    no prompt. See Decisions.
  - **Point lookup method.** The spec offers CDP `DOM.getNodeForLocation`
    or `elementFromPoint` through the frame responder. I used
    `chrome.scripting.executeScript` with `document.elementFromPoint` in the
    top frame (no debugger attach, the same pattern the DOM locator uses).
    A frame under the point counts as unresolvable, so the click asks.
  - **A test updated to the new behaviour.** `computer.test.ts` had "left_click runs immediately with no
    approval", asserting the ungated behaviour this package reverses. It is
    kept, now with a known-safe target, alongside new risky and fail-closed
    cases. No test was deleted.
  - **Unit-test gap for the in-page inspector.** `inspectClickTargetInPage`
    has no jsdom unit test: jsdom is not a browser-runtime dependency, and
    adding it would be a new dependency. It is covered by the real-Chromium
    e2e tests.
- A2:
  - **Privacy statement location.** The spec says "the privacy statement
    under `docs/`", but the privacy statement is `PRIVACY.md` at the repo
    root. I updated that file and `docs/TROUBLESHOOTING.md`.
  - **A test updated to the new behaviour.** `data-handling-card.test.tsx`
    asserted the list is disabled while page capture is off. That would
    stop a user from protecting Client bodies, so the assertion now
    requires it to be enabled.
- A3:
  - **Call-site count.** The spec says 16 non-test callers; I found 17 call
    sites.
  - **How Standard differs from Strict.** In this codebase Standard differs
    from Strict only for page-context keys (`page_title`, `page_search`,
    `page_path`, `referrer`); usernames and other personal-data keys are
    masked in both. Off skips only the key-name pass; PEM, JWT, bearer,
    known token shapes, generic secret key/value pairs and emails are
    masked in every mode. The UI copy says exactly this.
  - **DOM Health's own privacy is unchanged.** Page titles replaced,
    identifier-shaped values and element ids masked: this is structural and
    stays on in every mode. Only its inner text-redaction call follows the
    mode.

## Phase A: decisions needed from the owner

1. **Add "save" to `RISKY_CLICK_WORDS`?** It would prompt on every Save
   button, and the existing core-tools e2e would need its approval
   answered.
2. **A header line inside JSON exports?** The response viewer's JSON
   Copy/Download currently stays valid JSON, with the mode in the file name
   and on screen. A header line would make the file invalid JSON.
3. **Right-click.** A `computer` `right_click` goes through the same
   classifier as other clicks (the spec says "click and drag actions"). It
   can't submit or follow a link, so it could be exempted if the prompts
   are a nuisance.

## Phase A: observed, not changed

- The DOM Health application audit navigates the bound tab itself
  (`apty/page-navigation.ts`, `chrome.tabs.update`) to same-origin links it
  discovered. It is not a model tool call and is not gated (also noted in
  SECURITY_AUDIT #18).
- `tooling/e2e/harness.mjs`:
  - `toolResults()` counts tool messages after the last user message. A
    screenshot sent to the model arrives as a new user message, which
    resets it, so the A1 e2e uses its own per-prompt counting.
  - `openSidePanel()` overwrites the whole settings object, wiping other
    settings.
- `RISKY_CLICK_WORDS` is English only. A destructive control with no
  telling label or form (a `div` with a click handler named "Go") still
  runs at once.
- `inspect_extension_network` returns the request URL in its metadata even
  for `body_denied` (unchanged existing behaviour; the URL goes through the
  inspector's usual handling, not the deny list).
- The response viewer's JSON Copy, and the code-block and selector Copy
  buttons, carry no export header (they copy snippets, not exports).
- `packages/ui` still has 10 skipped tests (C4 in Phase C).

## Phase A: owner test scripts (about 5 minutes each)

Setup for all three:

1. Unzip `the latest `apty-agent-review-*.zip`` into a folder. In Chromium (or
   Chrome for Testing; branded Chrome 137+ ignores `--load-extension` but
   "Load unpacked" still works), open `chrome://extensions`, turn on
   Developer mode, click **Load unpacked** and pick that folder. The ID
   should be `bpiondflhhdplemamgggcdajclmoeple`.
2. In Options → AI provider, configure your own model and key, and click
   Test connection.

### A1: clicks and new tabs

1. Save this as `a1.html`, and in that folder run `python3 -m http.server
   8000`:

   ```html
   <!doctype html><title>count 0</title><h1>Orders</h1>
   <form action="/orders/delete" method="post" onsubmit="event.preventDefault(); window.n=(window.n||0)+1; document.title='count '+window.n">
     <button type="submit">Delete</button></form>
   <button onclick="document.title='details shown'">Show details</button>
   ```

2. Open `http://localhost:8000/a1.html` and open the side panel.
3. Type: "On the current tab, click the Show details button."
   **Expected:** no approval prompt; the tab title becomes "details shown".
4. Type: "On the current tab, click the Delete button."
   **Expected:** a prompt "Allow click?" showing `Click "Delete"
   (<button type=submit>, role button)`, `Form: POST
   http://localhost:8000/orders/delete`, "Why approval is needed: it
   submits a form; its label contains "delete"". Click **Deny**.
   **Expected:** the title stays "count 0".
5. Type: "Open a new tab at https://example.org/?d=" followed by about 200
   characters of text.
   **Expected:** a prompt "Allow create_new_tab?" showing the full URL, with
   only **Allow once** and **Deny** (no "Allow on this site"). Click
   **Deny**. **Expected:** no new tab opens.
6. Type: "Open a new tab at https://example.org/".
   **Expected:** a prompt that offers "Allow on this site for 15 min".
   Click it. **Expected:** the tab opens. Ask again.
   **Expected:** it opens with no prompt.
7. Options → General → Remembered approvals shows `create_new_tab` for
   `https://example.org`. Click **Revoke all**; step 6 asks again.

### A2: deny list for Apty Client bodies

1. Create the test Client from the repo:

   ```sh
   node -e "import('./tooling/e2e/harness.mjs').then(h => h.writeFakeClient('/tmp/fake-client', 'working', 'bpiondflhhdplemamgggcdajclmoeple'))"
   ```

   Load `/tmp/fake-client` unpacked too.
2. Options → Connection → Apty Integration: paste the fake Client's ID from
   `chrome://extensions` and click **Connect**.
   **Expected:** "Answering".
3. Options → General → Data handling: leave "Capture response bodies" off.
   **Expected:** the deny-list box is still editable, and its label
   mentions the Apty Client. Type `/users/` and click elsewhere.
4. In the side panel type: "Get 4815162342.json from the Apty Client."
   **Expected:** the answer says the body was withheld because it matches
   `/users/` in the deny list; no body content (`en-GB`) appears. In
   `chrome://extensions`, open the fake Client's service worker console and
   run `bodyRequests`. **Expected:** it does not contain `"r3"`.
5. Type: "Get the data from segments.json in the Apty Client."
   **Expected:** the segments come back; **View full response** shows 206
   items.
6. Clear the deny list and repeat step 4.
   **Expected:** the preference body (`theme`, `language: en-GB`) is
   returned.

### A3: redaction mode

1. Options → General → Data handling → Redaction.
   **Expected:** **Strict (recommended)** is selected.
2. Click **Preview** next to Standard.
   **Expected:** "Before (sample data)" shows the fake chart title and
   username. "After: Standard" keeps the title, masks the username, and
   replaces the Bearer JWT with `<REDACTED>`. Preview Strict.
   **Expected:** the title is masked too.
3. Select **Standard**. **Expected:** it is saved at once (reload Options to
   check).
4. Select **Off (development only)**.
   **Expected:** a dialog "Turn redaction off?" stating "Structural secret
   redaction stays on: tokens, API keys, JWTs, bearer credentials and
   emails are still masked." Click **Keep current mode**.
   **Expected:** Standard is still selected.
5. Select **Off** again and click **Turn redaction off**. Open the side
   panel.
   **Expected:** a banner "Redaction is OFF (development only) …" with a
   **Change** button. Reload the side panel.
   **Expected:** the banner is still there.
6. Ask any question, then click **Copy** on the answer and paste it
   somewhere.
   **Expected:** the first line reads `Apty Agent export · redaction mode:
   off · <time>`.
7. Click **Change** in the banner, select **Strict**.
   **Expected:** the banner disappears from the side panel.
