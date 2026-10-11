# Technical decisions

One line per decision, in the order of the archived file. The full text of each,
unchanged, is in [`docs/archive/DECISIONS.md`](docs/archive/DECISIONS.md);
the link on each title goes to its section. Dates are when the decision
entered this file in git (the repository history starts on 2026-09-30, so
earlier ones read "≤ 2026-09-30"). "Record" marks a round summary rather
than a single decision.

Decisions from the hardening round (Phases A–D) are in `REVIEW.md` and the
work-package specs under `docs/tasks/master/`; new decisions go at the end
of this table, with their text in a section of the archive file or in the
document they concern.

| Decision | Date | Status |
|---|---|---|
| [v5 mega-prompt: styling root cause and the first UI/product-shell slice (this round)](docs/archive/DECISIONS.md#v5-mega-prompt-styling-root-cause-and-the-first-uiproduct-shell-slice-this-round) | ≤ 2026-09-30 | Record |
| [v4 mega-prompt: what shipped, by work package (this round)](docs/archive/DECISIONS.md#v4-mega-prompt-what-shipped-by-work-package-this-round) | ≤ 2026-09-30 | Record |
| [Apty debug bridge: what actually shipped in this pass, and what's still open](docs/archive/DECISIONS.md#apty-debug-bridge-what-actually-shipped-in-this-pass-and-whats-still-open) | ≤ 2026-09-30 | Record |
| [Apty debug bridge (service-worker logs + connected-app console logs): WP0 findings and the ADRs they justify](docs/archive/DECISIONS.md#apty-debug-bridge-service-worker-logs--connected-app-console-logs-wp0-findings-and-the-adrs-they-justify) | ≤ 2026-09-30 | Accepted |
| [Apty DOM Health frame-addressing uses `chrome.webNavigation`, not `chrome.debugger`/CDP — and click-based state discovery is opt-in, off by default](docs/archive/DECISIONS.md#apty-dom-health-frame-addressing-uses-chromewebnavigation-not-chromedebuggercdp--and-click-based-state-discovery-is-opt-in-off-by-default) | ≤ 2026-09-30 | Accepted |
| [Apty DOM Health uses two snapshots and a fixed weighted rule engine, not a persistent recorder or an LLM-scored heuristic](docs/archive/DECISIONS.md#apty-dom-health-uses-two-snapshots-and-a-fixed-weighted-rule-engine-not-a-persistent-recorder-or-an-llm-scored-heuristic) | ≤ 2026-09-30 | Accepted |
| [`run_console_command` executes scoped JS via the existing CDP debugger session, not a new execution architecture](docs/archive/DECISIONS.md#run_console_command-executes-scoped-js-via-the-existing-cdp-debugger-session-not-a-new-execution-architecture) | ≤ 2026-09-30 | Accepted |
| [Apty Client resource inspection uses cross-extension messaging, not `chrome.debugger` — verified, not assumed](docs/archive/DECISIONS.md#apty-client-resource-inspection-uses-cross-extension-messaging-not-chromedebugger--verified-not-assumed) | ≤ 2026-09-30 | Accepted |
| [Investigation-aware network capture was reimplemented fresh on `main`, not merged from PR #11](docs/archive/DECISIONS.md#investigation-aware-network-capture-was-reimplemented-fresh-on-main-not-merged-from-pr-11) | ≤ 2026-09-30 | Accepted |
| [The autonomous orchestrator is a recommend+guardrail layer the model consults, not a second execution engine](docs/archive/DECISIONS.md#the-autonomous-orchestrator-is-a-recommendguardrail-layer-the-model-consults-not-a-second-execution-engine) | ≤ 2026-09-30 | Accepted |
| [Unify the Apty component model at the investigation layer, not the evidence layer](docs/archive/DECISIONS.md#unify-the-apty-component-model-at-the-investigation-layer-not-the-evidence-layer) | ≤ 2026-09-30 | Accepted |
| [Removed `debugger-manager.ts`'s extension-iframe deletion outright, no replacement mechanism](docs/archive/DECISIONS.md#removed-debugger-managertss-extension-iframe-deletion-outright-no-replacement-mechanism) | ≤ 2026-09-30 | Accepted |
| [Why no external investigation orchestration loop this session](docs/archive/DECISIONS.md#why-no-external-investigation-orchestration-loop-this-session) | ≤ 2026-09-30 | Record |
| [Investigation planner is a deterministic pattern registry, not a second LLM call](docs/archive/DECISIONS.md#investigation-planner-is-a-deterministic-pattern-registry-not-a-second-llm-call) | ≤ 2026-09-30 | Accepted |
| [The "no unverified confirmed diagnosis" guard lives in the store, not the tool](docs/archive/DECISIONS.md#the-no-unverified-confirmed-diagnosis-guard-lives-in-the-store-not-the-tool) | ≤ 2026-09-30 | Accepted |
| [`InvestigationSession` is a new, separate store — not bolted onto `Session`/`ConversationData`](docs/archive/DECISIONS.md#investigationsession-is-a-new-separate-store--not-bolted-onto-sessionconversationdata) | ≤ 2026-09-30 | Accepted |
| [The side panel UI reads evidence/investigation stores directly, not through a message bus](docs/archive/DECISIONS.md#the-side-panel-ui-reads-evidenceinvestigation-stores-directly-not-through-a-message-bus) | ≤ 2026-09-30 | Accepted |
| [Investigation lifecycle changes go through explicit tools, not implicit inference](docs/archive/DECISIONS.md#investigation-lifecycle-changes-go-through-explicit-tools-not-implicit-inference) | ≤ 2026-09-30 | Accepted |
| [Friendly tool-call names reuse the existing i18n `tools.*` translation layer](docs/archive/DECISIONS.md#friendly-tool-call-names-reuse-the-existing-i18n-tools-translation-layer) | ≤ 2026-09-30 | Accepted |
| [No new UI framework/design system](docs/archive/DECISIONS.md#no-new-ui-frameworkdesign-system) | ≤ 2026-09-30 | Accepted |
| [No RAG layer, ever, in this repo](docs/archive/DECISIONS.md#no-rag-layer-ever-in-this-repo) | ≤ 2026-09-30 | Accepted |
| [Apty diagnostics are honest stubs, not fake implementations](docs/archive/DECISIONS.md#apty-diagnostics-are-honest-stubs-not-fake-implementations) | ≤ 2026-09-30 | Accepted |
| [Config lives in `chrome.storage.local`, seeded from build-time env, not read directly from `import.meta.env` in browser-runtime](docs/archive/DECISIONS.md#config-lives-in-chromestoragelocal-seeded-from-build-time-env-not-read-directly-from-importmetaenv-in-browser-runtime) | ≤ 2026-09-30 | Accepted |
| [BYOK only, no proxy fallback (carried over from the prior session)](docs/archive/DECISIONS.md#byok-only-no-proxy-fallback-carried-over-from-the-prior-session) | ≤ 2026-09-30 | Accepted |
| [Kept AIPex's generic browser/tab/tool infrastructure; did not rename internal identifiers](docs/archive/DECISIONS.md#kept-aipexs-generic-browsertabtool-infrastructure-did-not-rename-internal-identifiers) | ≤ 2026-09-30 | Accepted |
| [`get_network_diagnostics` / `get_runtime_diagnostics` use a bounded live capture window, not a persistent recorder](docs/archive/DECISIONS.md#get_network_diagnostics--get_runtime_diagnostics-use-a-bounded-live-capture-window-not-a-persistent-recorder) | ≤ 2026-09-30 | Accepted |
| [Redaction is pattern-based, not a full DLP system](docs/archive/DECISIONS.md#redaction-is-pattern-based-not-a-full-dlp-system) | ≤ 2026-09-30 | Accepted |
| [Console/runtime event classification is a fixed regex taxonomy, applied after redaction, not a second LLM call or an ML model](docs/archive/DECISIONS.md#consoleruntime-event-classification-is-a-fixed-regex-taxonomy-applied-after-redaction-not-a-second-llm-call-or-an-ml-model) | ≤ 2026-09-30 | Accepted |
| [WP1.7 (always-on `<all_urls>` MAIN-world console-bridge content script): owner decision — keep all-sites for now](docs/archive/DECISIONS.md#wp17-always-on--main-world-console-bridge-content-script-owner-decision--keep-all-sites-for-now) | 2026-10-01 | Amended by B5: the page script can be turned off or excluded per site |
| [v7 WP1 round: scoped to concrete correctness fixes, not the full peer-client rewrite](docs/archive/DECISIONS.md#v7-wp1-round-scoped-to-concrete-correctness-fixes-not-the-full-peer-client-rewrite) | 2026-10-06 | Accepted |
| [v7 WP4 H2: pnpm.overrides for dependency vulnerabilities](docs/archive/DECISIONS.md#v7-wp4-h2-pnpmoverrides-for-dependency-vulnerabilities) | 2026-10-07 | Accepted |
| [v7 WP4 B5: CI workflow fixes](docs/archive/DECISIONS.md#v7-wp4-b5-ci-workflow-fixes) | 2026-10-07 | Accepted |
| [v7 WP4 B3: skill sandbox — opt-in gate instead of a full rewrite](docs/archive/DECISIONS.md#v7-wp4-b3-skill-sandbox--opt-in-gate-instead-of-a-full-rewrite) | 2026-10-07 | Accepted |
| [v7 WP5: automatic LLM retry/backoff, scoped narrower than "everything recoverable"](docs/archive/DECISIONS.md#v7-wp5-automatic-llm-retrybackoff-scoped-narrower-than-everything-recoverable) | 2026-10-07 | Accepted |
| [v7 WP6: scoped to the 3 items verifiable without live-provider or live-browser testing](docs/archive/DECISIONS.md#v7-wp6-scoped-to-the-3-items-verifiable-without-live-provider-or-live-browser-testing) | 2026-10-07 | Accepted |
| [v7 WP4 follow-up: extending the approval gate to fill_*/computer/downloads](docs/archive/DECISIONS.md#v7-wp4-follow-up-extending-the-approval-gate-to-fill_computerdownloads) | 2026-10-07 | Accepted |
| [v7 M4: ZIP import caps, and a stale type shim that was quietly widening fflate's real types](docs/archive/DECISIONS.md#v7-m4-zip-import-caps-and-a-stale-type-shim-that-was-quietly-widening-fflates-real-types) | 2026-10-07 | Accepted |
| [v7 M5: optional_permissions for bookmarks/history/management, and a dead keyboard shortcut](docs/archive/DECISIONS.md#v7-m5-optional_permissions-for-bookmarkshistorymanagement-and-a-dead-keyboard-shortcut) | 2026-10-07 | Accepted |
| [v7 WP4 dead-code cleanup: a live undisclosed third-party fetch, an unreachable external-message handler, and an incorrectly-scoped "aipex-* identifiers" item](docs/archive/DECISIONS.md#v7-wp4-dead-code-cleanup-a-live-undisclosed-third-party-fetch-an-unreachable-external-message-handler-and-an-incorrectly-scoped-aipex--identifiers-item) | 2026-10-08 | Accepted |
| [v7 WP4: leveled logger — built, not adopted at the 523 existing call sites](docs/archive/DECISIONS.md#v7-wp4-leveled-logger--built-not-adopted-at-the-523-existing-call-sites) | 2026-10-07 | Superseded (logger adopted, below) |
| [Logger adopted; skills lose CDN imports; MCP token moves to the handshake](docs/archive/DECISIONS.md#logger-adopted-skills-lose-cdn-imports-mcp-token-moves-to-the-handshake) | 2026-10-08 | Accepted |
