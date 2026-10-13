# Review: `optimize/llm-requests`, Phase A (O1–O5)

| | |
|---|---|
| Branch | `optimize/llm-requests` (local only, never pushed) |
| Base | `origin/main` at `c64838b` |
| Code head | `c65edcf`; the branch head is the next commit, which adds this file |
| Build zip | `apty-agent-review-A-c65edcf.zip`: a clean build of `c65edcf`, the contents of `apps/browser-extension/dist` with `manifest.json` at the top |
| Git bundle | `apty-agent-review-A-c65edcf.bundle`: refs `HEAD` and `refs/heads/optimize/llm-requests`, requires `c64838b`; the 7 Phase A commits plus this file |
| Checksums | `SHA256SUMS.txt` (SHA-256 of the zip and the bundle) |

This file replaces the previous round's `REVIEW.md` (the
`hardening/open-work` review), following the convention of one review per
round; that text is in git history: `git show c64838b:REVIEW.md`. The spec
for this work is in [`docs/tasks/llm/`](docs/tasks/llm/00-rules.md).

Nothing here was run against a real AI provider or a real tenant. Token
numbers are estimates (characters / 4) on fixed synthetic scenarios; masking
was proven against fixture pages and a mock model in a real browser.

## Decisions

Answered by the owner during Phase A (both **yes**):

1. DOM Health reports (`run_dom_health_audit`,
   `run_application_dom_health_audit`) get a 12,000-token ceiling instead
   of the 2,000-token default (O2).
2. `capture_screenshot_with_highlight` is gated by the screenshot setting
   too, not only the two tools the spec named (O4).

Built-in defaults from the spec, for a yes/no each:

1. Strict withholds form values; Standard masks them; Off shows them.
2. `screenshotPolicy` defaults to "ask".
3. User messages get structural-secret masking in Strict and Standard, not
   in Off.
4. Pruning keeps the newest 4 tool results whole; the per-result cap is
   2,000 tokens.
5. Prompt caching on by default, for Anthropic only (Phase B; nothing built
   yet).

## Commits

| Commit | Work package |
|---|---|
| `590e1e5` | Spec saved as `docs/tasks/llm/`; request-size harness and `npm run report:request-size` |
| `4bee90e` | O1: one outbound filter masks everything sent to the model |
| `a6ee5cf` | O2: cap tool results and stub old ones |
| `f18929f` | O1, O2: keep tool results valid JSON when masking and capping (found by the existing e2e) |
| `2f4b03f` | O3: mask or withhold typed values in page reads by mode |
| `2c0334c` | O4: ask before a screenshot is sent to the model |
| `c65edcf` | O5: show the last requests sent to the AI provider |
| branch head | This `REVIEW.md` |

## Gates (clean build of `c65edcf`)

```
$ rm -rf apps/browser-extension/dist
$ tooling/scripts/verify-quiet.sh typecheck lint test audit build
✓ typecheck (16s)
✓ lint (2s)
✓ test (101s)
✓ audit (1s)
✓ build (32s)
$ npm run format:check                 → exit 0
$ npm run audit:test-skips             ✓ every skipped test says why
$ npm run audit:any                    ✓ 605 explicit any, none above the baseline
$ npm run audit:docs-links             ✓ every relative link in the Markdown files resolves
$ node tooling/scripts/check-extension-id.mjs
✓ The manifest key yields the pinned Agent ID bpiondflhhdplemamgggcdajclmoeple
```

Unit tests (no skipped test anywhere):

```
packages/apty-debug-contract   Tests  72 passed (72)
packages/agent-core            Tests 265 passed (265)
packages/dom-snapshot          Tests 395 passed (395)
packages/ui                    Tests 224 passed (224)
packages/browser-runtime       Tests 964 passed (964)
apps/browser-extension         Tests 303 passed (303)
apps/mcp-bridge                Tests  44 passed (44)
tooling/scripts (node:test)    pass 17, fail 0
```

```
$ npm run test:e2e        (Chromium from /opt/pw-browsers, against the clean build)
# tests 108
# pass 108
# fail 0
# skipped 0
```

95 of the 108 existed at the base; 13 are new
(`tooling/e2e/llm-outbound.e2e.test.mjs`).

**`npm run test:coverage` exits 1 in this container, exactly as it does at
the base.** Three existing tests time out at Vitest's 5-second default under
coverage instrumentation: `collector-budget.test.ts` and
`health-collector.test.ts` (dom-snapshot), and
`response-body-viewer.test.tsx` (extension). None touch code this branch
changed. I ran the same command at `c64838b` in a scratch worktree: the
same tests time out, two runs out of two. All three pass in the normal unit
run above. With `--testTimeout=30000` on the command line (the tests
themselves unchanged) every package passes its thresholds:

| Coverage | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| agent-core | 76.29 | 70.25 | 83.73 | 78.02 |
| dom-snapshot | 91.41 | 83.45 | 97.82 | 93.17 |
| ui | 45.08 | 35.51 | 43.86 | 45.86 |
| browser-runtime | 52.25 | 48.88 | 56.41 | 52.17 |
| apty-debug-contract | 84.91 | 78.46 | 93.18 | 87.66 |
| browser-extension | 44.74 | 45.84 | 42.29 | 44.63 |
| mcp-bridge | 21.27 | 18.15 | 24.74 | 21.51 |

The packaged manifest still has `"externally_connectable": {"ids": []}`;
the unpacked build is 14,699,640 bytes (`du -sb dist`). No dependency,
permission or network call was added (`pnpm-lock.yaml` and the manifest
unchanged; `package.json` only gains the `report:request-size` script; the
screenshot setting and request reports use the existing `storage`
permission). TruffleHog 3.99.2 (release checksum verified) over
`origin/main..HEAD` (the 7 commits before this file), no exclude list,
verification off: `"chunks":183 "bytes":166063 "verified_secrets":0
"unverified_secrets":0`. The tests contain made-up `ghp_…` and JWT strings on
purpose; TruffleHog does not report them.

## Request size, before and after

`npm run report:request-size` at `c65edcf`. "Before" is the request as the
agent builds it (identical to the base); "after" is what the outbound
filters send. Estimated tokens.

| Scenario | Tools | Before | After | Change |
|---|---|---|---|---|
| casual ("hi") | 0 | 3,929 | 3,929 | 0 |
| followup ("ok go ahead") | 0 | 5,454 | 5,454 | 0 (Phase B, P1) |
| apty-question | 15 | 7,723 | 7,723 | 0 |
| segments-json | 22 | 9,166 | 9,166 | 0 |
| dom-health | 6 | 5,647 | 5,647 | 0 |
| click-task | 8 | 6,400 | 6,400 | 0 |
| investigation, 10 earlier results | 15 | 15,273 | 11,163 | −27% |
| long chat, 8 earlier turns | 15 | 13,803 | 11,063 | −20% |
| one 60,000-character result | 4 | 19,585 | 6,598 | −66% |

Whole registry: 65 tools; schema tokens 14,341 at the base, 14,597 now
(+256, the approval note O4 adds to the three screenshot tools); system
prompt 3,928 tokens on every call. The system prompt and tool schemas are
Phase B (P1, P2, P3).

## O1: one outbound filter (done)

- `AIPexOptions.outboundFilters` (`agent-core/src/types.ts`) run inside
  `callModelInputFilter` in `aipex.ts`, after the existing shaping, before
  every model call. A filter that throws fails the call: input is never sent
  unfiltered. Filters also receive the call's instructions and tools (used
  by O5).
- `createOutboundSanitizer({ getMode })`
  (`browser-runtime/src/runtime/outbound-sanitizer.ts`) redacts every tool
  result in the current mode, read on each call. A JSON result is redacted
  by key and then string by string, so it stays valid JSON. User messages get
  only structural secrets masked (tokens, keys, JWTs, emails), in Strict and
  Standard. Results are cached by call id and redone when the mode changes;
  items are never dropped or reordered.
- The chain is built in `apps/browser-extension/src/hooks/outbound-filters.ts`
  (sanitizer, budget, report) and passed through `useAgent`'s
  `agentOptions`. `agent-core` imports nothing from `@apty/debug-contract`.
- Red then green: unit tests failed 3 of 4 against the old `aipex.ts`; the
  e2e failed 3 of 3 against a build without the wiring ("page secret
  reached the model") and passes now. The JSON fix was found by the existing
  `agent.e2e` network-capture test (`"session":<REDACTED>"…`), reproduced in
  a unit test first.
- Size: none.

## O2: cap and prune tool results (done)

- `browser-runtime/src/runtime/request-budget.ts`:
  `MAX_TOOL_RESULT_TOKENS = 2000`, `FULL_RESULTS_KEPT = 4`,
  `STUB_PREVIEW_CHARS = 200`.
- A JSON result is shrunk in rounds (long strings, long arrays, deep
  objects, keys of nested objects) until it fits, keeping its top-level keys
  and scalars, and marked `truncatedForModel: {originalChars}`. Other text is
  cut with `[truncated: first N of M characters sent]`. Results with an
  `evidenceId` and a bounded preview are left alone.
- Results from earlier turns beyond the newest four become
  `{"stubbed":true, tool, size, evidenceId?, preview}`. The current turn is
  never stubbed. Calls keep their results.
- DOM Health reports: 12,000-token ceiling (owner: yes). Measured in the
  `dom-health-apps` fixtures: 9,177 to 70,886 characters; with the 2,000
  cap, 8 existing DOM Health e2e tests failed.
- Red then green: unit tests failed with the module absent and again for
  each shrink stage; the e2e failed 2 of 2 without the filter ("sent 100047
  characters") and passes now.
- Size: see the table (−20% to −66% on the scenarios with old or large
  results).

## O3: typed values in page reads (done)

- `dom-snapshot/src/value-policy.ts`: pure `ValuePolicy`
  (`show | mask | withhold`, default `show`), `applyValuePolicy`,
  `applyUrlPolicy`, `prepareNodeForPolicy`. The collector marks a name that
  came from the value (`nameIsValue`: a select's chosen option, a textarea's
  own text).
- `browser-runtime/src/runtime/value-policy.ts` maps the mode: Strict
  withholds, Standard masks (`[masked]`, length not revealed), Off shows.
- Applied where snapshots are formatted for the model
  (`formatSnapshot` in `automation/snapshot-provider.ts`), which covers the
  CDP (focus mode) and DOM (background mode) snapshots and every caller:
  values, the text inside an editor, a name taken from the value, and the
  chosen `<option>` of a select.
- `get_editor_value` returns `[masked]` or a "withheld" refusal;
  `get_page_metadata` drops (Strict) or masks (Standard) URL query values
  and the fragment; `take_snapshot` is capped at 4,000 tokens with a note
  pointing to `search_elements`.
- Settings copy (each mode's description, the Data-handling card) and
  `PRIVACY.md` say what happens to form values and that page text is sent
  as shown.
- Red then green: unit tests failed against the old code (formatter, tools,
  collector flag); the e2e failed 2 of 3 with the policy forced to Show
  ("Jane Testpatient reached the model"), the Off control passing, and
  passes 3 of 3 now.
- Size: none on the synthetic scenarios.

## O4: screenshot consent (done)

- `AppSettings.screenshotPolicy`: `ask` (default) | `allow` | `never`,
  control in Settings → Data handling → Screenshots, strings in `en.json`
  and `zh.json`.
- `browser-runtime/src/tools/screenshot-consent.ts`: `ask` goes through
  `gateRiskyAction` with a summary naming the site only ("Send a screenshot
  of https://… to your AI provider"); `allow` captures; `never` refuses
  without capturing. The setting is read on every call.
- `capture_screenshot`, `capture_tab_screenshot` and
  `capture_screenshot_with_highlight` are wrapped, only when the image would
  reach the model. `capture_screenshot_to_clipboard` is untouched. MCP calls
  run the same tools in the service worker and go through the same gate.
- Red then green: the e2e failed 3 of 4 against a build without the wiring
  (the "always allow" control passing) and passes 4 of 4 now: Deny sends no
  image, Allow once sends it, Always allow sends without asking, Never
  refuses.
- Size: +256 schema tokens when all screenshot tools are offered.

## O5: what was sent (done, one item partial)

- The last filter builds a report per model request: time, redaction mode,
  estimated tokens (system prompt, tool schemas, history, tool results,
  total) and counts (items, tool results, stubbed, cut, screenshots). No
  text, URLs or tool names. Kept in `chrome.storage.session` (memory only,
  cleared when the browser closes), the newest 5.
- Shown as "Recent requests" on Settings → Apty Integration → Preflight and
  in the Data-handling card.
- Red then green: unit tests failed with the module absent; the e2e failed
  without the report filter and passes now, checking both places and that
  the stored reports hold no typed text, URL or tool name.
- Partial: the spec's "values masked" count is not reported; the sanitizer
  does not count its replacements.

## Not done, or partial

- O5's "values masked" count (above).
- O3 does not cover checkbox and radio states, or plain page text: a
  patient name printed on the page is sent in every mode (documented).
- No MCP-specific e2e for the screenshot gate; the gate function and the
  approval relay are shared with the tested side-panel path.
- Phases B and C: not started, as the rules require.

## Conflicts between the prompt and the repo

- **`take_snapshot` is not a tool the model can call** (`tools/index.ts`
  leaves it out on purpose). The model reads pages through
  `search_elements`. O3 applies the policy where both are formatted, and
  caps `take_snapshot` as asked.
- **The 2,000-token cap against "report DOM Health exactly as returned"**
  (system prompt): resolved with the DOM Health ceiling (owner: yes).
- **Cutting a JSON result as text** gave the model, and the existing tests,
  invalid JSON: replaced by the structural shrink.
- **Strings in `en.json` and `zh.json`**: the new O4 strings are there. The
  copy edited for O3 and the O5 list follow the Data-handling card's own
  inline English/Chinese strings, which do not use those files.
- The prompt's figures checked out: 65 tools, a 3,928-token system prompt,
  14,341 schema tokens (prompt: about 14,320), and the per-scenario sizes
  within 0.2%. Redaction modes already had one entry point
  (`runtime/redaction-mode.ts`), which O1 and O3 reuse.

## Observed, not changed

- `apty/network-capture-session.ts:314` and
  `apty/extension-network-inspector.ts:787` pass response bodies through
  `redactText`. That free-text pass turns a JSON object under keys such as
  `"session"` into invalid JSON (`"session":<REDACTED>"…`). O1 avoids this
  for what is sent to the model; changing those callers changes redaction
  semantics, which this work may not do.
- A single long turn is never pruned (the spec keeps the current turn
  whole): up to 30 model calls, each result capped. Phase B's context budget
  (P4) is the place for it.
- Assistant messages and function-call arguments are sent as the model
  wrote them; no filter changes them.
- Unit tests in one package read sibling packages through their built
  `dist`, which `npm run typecheck` writes. After changing a package's
  exports, run typecheck (or build) before the unit tests; CI already does.
- In this container `axe-core` was declared but not installed;
  `pnpm install --frozen-lockfile` restored it without changing the
  lockfile.

## Owner test scripts (about 5 minutes each)

Load the zip unpacked, set an AI provider, open the side panel. To see what
was sent: right-click the side panel → Inspect → Network, select the request
to your provider, open Payload, and search it (Ctrl+F).

**O1, masking at the boundary**

1. Settings → Data handling → Redaction: Strict. In the chat send
   `my key is ghp_ab12cd34ef56gh78ij90kl12mn` (a made-up token).
   **Expected:** the payload has `<REDACTED>` where the key was.
2. Switch to Off (confirm), send the same text.
   **Expected:** the key is in the payload as typed.
3. Back to Strict.

**O2, cap and stubs**

1. Open a long page (a long Wikipedia article). Send "check the form field
   text on this page".
   **Expected:** in the payload, that tool message is at most 8,000
   characters, still valid JSON, with "…more characters not sent" in its
   `data` and a `truncatedForModel` field.
2. Ask five more questions that read the page.
   **Expected:** the oldest tool results in the latest payload are
   `{"stubbed":true,…}`; the newest four are whole.

**O3, form values**

1. On any page with a text field, type `Jane Testpatient` into it. Strict:
   send "check the form field values on this page".
   **Expected:** the payload never contains `Jane`.
2. Standard: same question. **Expected:** `[masked]` where the value was.
3. Off: **Expected:** `Jane Testpatient` appears.

**O4, screenshots**

1. Settings → Data handling → Screenshots: Ask each time. Send "take a
   screenshot of this page".
   **Expected:** a prompt "Send a screenshot of https://… to your AI
   provider". Deny: the agent says it was denied, and no image is in the
   payload.
2. Again, Allow once. **Expected:** an image in the payload.
3. Set Never, ask again. **Expected:** no prompt; the agent says
   screenshots are off.

**O5, recent requests**

1. After a few messages, open Settings → General → Data handling, then
   Apty Integration → Preflight.
   **Expected:** "Recent requests" lists up to 5 rows with token sizes,
   counts and the redaction mode, and none of what you typed.

## After your "approved"

I will hand over the commands to apply this to `main` from the bundle,
with a rollback. I do not push.
