# Apty Browser Debugging Agent

## Gap Matrix (audited against the full product spec)

Audited against the "final implementation" specification (evidence
correlation, investigation sessions, selector diagnostics, UI redesign,
security hardening, tool cleanup). This is a large spec; the matrix below
is the honest current state, not aspirational.

| Capability | Current State | Complete? | Issue | Priority | Recommended Action |
|---|---|---|---|---|---|
| Message-history isolation | `Session`/`ConversationManager` + `ConversationData` | Yes | Two id spaces, now reconciled via `agentSessionId` | — | Done |
| Diagnostic tab isolation | `RunContext` + `resolveDiagnosticTab()` + per-session tab binding | Yes | First-turn binding is best-effort; no concurrent multi-pane UI | — | Done (see Multi-Session Isolation notes) |
| Evidence model (types) | `DiagnosticEvidence`/`EvidenceSource` in `apty/types.ts` | Partial | Type exists but nothing ever constructs/stores one — every tool returns its own ad-hoc shape | P0 | Implemented this session — see "Evidence Correlation Layer" below |
| Deterministic evidence correlation | None — LLM infers all relationships from raw tool output | No | Correlation quality depends entirely on system-prompt discipline | P0 | Implemented this session — see below |
| Selector debugging as first-class feature | None — no selector generation/ranking exists anywhere in the repo | No | Apty's core "why can't Studio select this element" question has no dedicated tool | P0 | Implemented this session — `analyze_element_selectors` tool |
| Investigation session lifecycle (start/collect/pause/stop/hypotheses/diagnosis) | `InvestigationSession` (`apty/investigation-session.ts`) + 5 tools (`start_investigation`/`update_investigation`/`record_verification_attempt`/`stop_investigation`/`get_investigation_status`) | Yes | System-prompt-driven (model must call the tools); no server-side enforcement that it does | — | Implemented this session — see "Investigation Session Lifecycle" below |
| Apty Widget/Client/Studio/Service-Worker providers | Honest `not_configured` stubs, Service Worker hardened+tested | Partial | Blocked on real Apty-side contracts | — | Blocked, not actionable from this repo alone |
| Network diagnostics (CDP) | Fixed 500ms–15s `get_network_diagnostics` window **plus** a new start/reproduce/stop capture session (`start_network_capture`/`stop_network_capture`/`get_network_capture_status`) | Yes | Both exist side by side by design — see "Investigation-Aware Network Capture" below | — | Implemented this session |
| Console/runtime event classification | Raw entries returned as-is (level, message, timestamp) | Partial | No classification into apty-error/CSP/CORS/JS-exception buckets | P2 | Not done this session |
| Selector/DOM iframe+Shadow DOM handling | `iframeManager`, DOM/CDP snapshot already handle frames; Shadow DOM traversal exists in the collector | Partial | New selector tool reports iframe/shadow-root context but doesn't yet special-case cross-origin iframe limits beyond what already existed | P2 | Partially covered by new selector tool; deeper work not done |
| Self-healing / stale-UID recovery | None — a stale UID throws and asks the model to re-snapshot | No | Manual recovery only (model calls `search_elements` again) | P2 | Not done this session |
| Tool surface cleanup | `bookmark.ts`/`history.ts`/`organize-tabs.ts`/clipboard tools exist as source but are already excluded from `allBrowserTools` (verified) | Mostly done | `mcp-bridge/src/tool-schemas.ts` has a naive tool-name count mismatch against the real registry that wasn't fully root-caused this session (some of it is nested-directory tools like `download_*`/`upload_file_to_input` that a quick glob missed, not necessarily real bugs) | P2 | Needs a careful, dedicated audit pass — flagged, not done this session to avoid a rushed/wrong fix |
| UI: investigation state banner, evidence panel, timeline, diagnosis card | Live investigation banner + browser context bar (header), collapsible Timeline/Components/Diagnosis summary bar (above input), dedicated selector-analysis view | Yes | No dedicated "start investigation" form (by design — see below); no automated component tests for the header/summary-bar (their pure logic is fully tested) | — | Implemented this session — see "Side Panel Redesign" below |
| Agent activity UX (friendly tool-call descriptions vs raw tool names) | Apty/investigation/selector tool names added to the existing `i18n` `tools.*` translation table with emoji-prefixed friendly labels; raw tool name shown in expanded technical details | Yes | Generic (non-Apty) tool names still just Title-Cased, not hand-written friendly descriptions | — | Implemented this session |
| AIPex branding/UI debt removal | System prompt and agent name already rebranded (prior sessions); internal package names/storage keys deliberately kept (see `DECISIONS.md`) | Partial (by design) | Deliberate scope decision, not an oversight | P3 | No action — see `DECISIONS.md` |
| Security: `host-access-config.json` / console-bridge domain scoping | Still `include-all` / `<all_urls>` | No | Needs Apty's actual target domain list | P1 | Blocked on Apty-side input, not actionable from this repo alone |
| Security: multi-session diagnostic isolation | Implemented (prior work this session cycle) | Yes | — | — | Done — `SECURITY_AUDIT.md` finding 1b updated to Fixed |
| Target domain configuration mechanism | None — no dev/staging/prod/customer-domain config surface | No | Would need Apty's domain list to be useful; building the mechanism without real domains is guessing | P2 | Not done — needs Apty input first |

Priorities: P0 = blocks core product, P1 = required for useful product, P2 =
important improvement, P3 = cleanup/future.

## Gap Matrix vs. the Engineering Automation Master Prompt (this session)

A second, more demanding specification arrived this session: the product's
north star is automating the manual investigation work an Apty SE/SDE does
today (reproduce → gather evidence → correlate → hypothesize → test →
verify → RCA → recommend), with a corrected two-extension Apty product
model (Studio, and one Client/Widget/Player runtime — not four separate
components). Audited against that prompt's own P0/P1/P2 ordering:

| # | Capability | Current State | Complete? | Priority | Recommended Action |
|---|---|---|---|---|---|
| P0.1 | Correct Apty component model (unify Client/Widget/Player + Service Worker) | `AptyComponentKind` = `"apty-client-widget-player" \| "apty-studio"` (investigation-session.ts); UI's `ComponentHealthPanel` renders exactly 2 grouped rows with per-probe drill-down | Yes | — | Implemented this session |
| P0.2 | Investigation planner ("what should I investigate first?") | `investigation-planner.ts`: deterministic pattern registry (tooltip/studio-select/studio-vs-prod/workflow/widget-loading + generic fallback) → ordered `PlanStep[]` with suggested tools; wired into `start_investigation`, exposed via `get_investigation_plan`, progress tracked via `update_investigation` | Yes | — | Implemented this session |
| P0.3 | Investigation orchestration loop (plan→execute→observe→evaluate→decide) | Not built as an autonomous loop external to the model. Decision-support data exists (plan + `get_investigation_status` + `get_investigation_timeline`) for the model's own tool-selection loop (`packages/core`'s agent loop, unchanged) to consume | No | P1 | Not attempted — see "Why no external orchestrator" in `DECISIONS.md`. Would require restructuring `packages/core`'s agent loop, a much larger and riskier change than this session's scope |
| P0.4 | Structured hypotheses (not strings) | `Hypothesis { id, statement, status, confidence, supportingEvidenceIds, contradictingEvidenceIds, createdAt, updatedAt }`; `update_investigation`'s `updateHypothesis` moves one through open→testing→supported/rejected/confirmed/inconclusive | Yes | — | Implemented this session |
| P0.5 | Real verification loop; never let an unverified hypothesis become a confirmed RCA | `record_verification_attempt` can link to a `hypothesisId` (auto-updates its status); `update_investigation` **enforces** (not just instructs) that `confidence: "confirmed"` is downgraded to `"likely"` server-side unless a confirmed verification attempt already exists — testable, not prompt-only | Yes | — | Implemented this session |
| P1.6 | Investigation-aware network capture (start/reproduce/stop session, not fixed window) | `network-capture-session.ts` + 3 tools — attach in background, accumulate across turns, correlate failures to the active investigation on stop; a 15s heartbeat keeps the debugger attached past the 30s idle auto-detach | Yes | — | Implemented this session — see "Investigation-Aware Network Capture" below |
| P1.7 | Console/runtime classification (Apty error / CSP / CORS / JS exception / etc.) | `log-classification.ts`'s `classifyLogEntry()` buckets every `get_apty_page_logs`/`get_runtime_diagnostics` entry into `csp-violation`/`cors-error`/`unhandled-rejection`/`js-exception`/`network-resource-error`/`deprecation-warning`/`apty-error`/`console-error`/`console-warning`/`info`; both tools return a `categoryCounts` tally | Yes | — | Implemented this session (code + unit/integration tests; not yet manually verified in a running browser — see "What's safe to continue" below) |
| P1.8 | Cross-layer correlation (Studio config ↔ production DOM ↔ Client/Widget resolution) | `evidence-correlation.ts` correlates by time/request-id across sources, but has no Studio-config-vs-production-DOM comparison logic specifically; the *plan* now includes a `studio-vs-production` "compare" step, but no dedicated comparison tool exists | Partial | P1 | Not done — would need a new deterministic comparison tool, not attempted this session |
| P1.9 | Selector debugging — engineering-grade explanations | Already answers match-count/uniqueness/stability/dynamic-risk/iframe/Shadow-DOM/recommendation with a "why" (`selector-analysis.ts`, unchanged this session) | Yes | — | Done in a prior session |
| P1.10 | Real Apty Client/Widget/Player integration contract | Unchanged: proposed `window.__APTY_WIDGET__`/`__APTY_CLIENT__` globals, honest `not_configured` until Apty implements them | Blocked | P1 | Blocked on Apty engineering, not actionable from this repo |
| P1.11 | Real Apty Studio integration contract | Unchanged: proposed cross-extension messaging, honest `not_configured` until Studio's real extension ID + handler exist | Blocked | P1 | Blocked on Apty engineering |
| P2.12 | SE/SDE investigation depth modes (one engine, configurable depth) | Not built — no depth/mode concept exists; every investigation runs at one depth | No | P2 | Not attempted this session |
| P2.13 | Investigation UI improvements (plan visibility) | `PlanChecklist` (new this session) shows the plan as a real pending/done/skipped checklist | Partial | P2 | Plan visibility done; deeper "current phase" indicator beyond the existing status pill not attempted |
| P2.14 | Target-domain configuration mechanism | Unchanged: no dev/staging/prod/customer-domain config surface | No | P2 | Not done — needs Apty's domain list first, per original gap matrix |
| P2.15 | Remove remaining AIPex product debt | Unchanged from before this session — see original gap matrix row 26 and `DECISIONS.md` | Partial (by design) | P2/P3 | Not attempted this session (out of P0 scope) |
| P2.16 | Security hardening (Phase 16/17 of the master prompt) | Phase 17's specific ask — audit `debugger-manager.ts` for destructive page manipulation — found and fixed a real issue (see "Debugger Attach No Longer Mutates the Page" below and `SECURITY_AUDIT.md` finding #8). Domain-scoping (host access, console bridge) unchanged/still blocked on Apty's domain list | Partial | P1/P2 | `debugger-manager.ts` fix done this session; domain scoping still blocked |
| P2.17 | SE/SDE scenario/evaluation suite (12 named scenarios) | Not built — no scenario harness exists | No | P2 | Not attempted this session |

**What this session deliberately did NOT attempt, and why**: a true autonomous
orchestrator (P0.3) and the network-capture-session UX (P1.6) both require
non-trivial changes to control flow this session judged too large to do
safely alongside the P0.1/P0.2/P0.4/P0.5 work above — see `DECISIONS.md`.
Real Apty-side integration contracts (P1.10/P1.11) remain blocked on Apty
engineering input, unchanged from every prior session's assessment.

## Current Status

The repo has been rebranded, stripped of AIPex's consumer-product
features, and given a full layer of Apty-specific diagnostics (evidence
model, provider interfaces, DevTools/CDP tools, a debugging-focused system
prompt, deterministic evidence correlation, selector diagnostics, an
investigation-session lifecycle with a deterministic planner and
structured hypotheses, and a real server-enforced verification guard)
plus a redesigned, investigation-first side panel UI that surfaces all of
it, modeling Apty's actual two-extension architecture (Studio, and one
Client/Widget/Player runtime — not four separate components). The Apty
Service Worker diagnostics path has a hardened, tested consumer
implementation plus a complete producer-side reference implementation for
the Apty Widget team (`docs/apty-integration/`). No real Apty Studio/
Widget/Client/Service Worker integration is *live* yet — that requires the
Apty-side halves (a real extension ID, a real global, a real message
handler), which this session cannot build since it doesn't have access to
those codebases; the UI reflects this honestly (`not_configured`/
`not_detected` component-health states, never fabricated "healthy" data).
A real, previously-undocumented issue was also found and fixed this
session: `debugger-manager.ts` was deleting extension iframes from the
live page on every diagnostic debugger attach — see "Debugger Attach No
Longer Mutates the Page" below.

**Multi-session/multi-chat isolation is now implemented** (this session) —
see "Multi-Session Isolation — Implementation Notes" below for what changed
and what's still a follow-up. The prior session's investigation-only
research notes (superseded by a Service Worker diagnostics push before
this) turned out to be exactly right about the fix: thread `RunContext`
through `run()` and prefer the bound tab over `getActiveTab()`.

**A previous session (documentation-only, no code changes)**: a complete
engineering documentation package was published to Apty's Confluence space,
under the folder at
`https://apty.atlassian.net/wiki/spaces/~712020ef582a34887949aa80daf20d290f4d9e/folder/1467613554`.
Root page: **"Apty Live Browser Debugging Agent"**
(`https://apty.atlassian.net/wiki/spaces/~712020ef582a34887949aa80daf20d290f4d9e/pages/1467679209`),
with 12 child pages (01–12, listed in `## Confluence Documentation` below).
The package is grounded in the repository at commit `14693a9` and uses
PLANNED / PARTIALLY IMPLEMENTED / BLOCKED–REQUIRES-APTY-SIDE-SUPPORT status
labels throughout. Writing it surfaced and corrected a pre-existing error in
this file and elsewhere: the tool-registry count was documented as 47 but
is actually 41 (verified directly against `allBrowserTools` in
`packages/browser-runtime/src/tools/index.ts`); corrected everywhere in
this file.

## Current Phase

Phase 4 of the informal roadmap below:
1. ~~Strip AIPex product features, rebrand~~ (done, prior session)
2. ~~Build Apty diagnostic infrastructure: evidence model, provider
   interfaces, DevTools tools, debugging persona~~ (done, prior session)
   ~~+ harden the Service Worker diagnostics path~~ (done, prior session)
3. Wire real Apty Studio/Widget/Client integration once extension IDs and
   contracts are available (not started — needs Apty-side input)
4. ~~Multi-session/multi-chat isolation~~ ~~+ deterministic evidence
   correlation~~ ~~+ selector diagnostics~~ ~~+ investigation-session
   lifecycle object~~ ~~+ investigation-first side panel UI redesign~~
   (all implemented, prior sessions)
5. ~~Publish a complete engineering documentation package to Confluence~~
   (done, prior session — see `## Confluence Documentation` below;
   explicitly a documentation-only task, no code changes)
6. **Autonomous engineering investigation**: ~~correct the two-extension
   Apty component model~~ ~~+ deterministic investigation planner~~
   ~~+ structured hypotheses~~ ~~+ server-enforced verification guard~~
   (all implemented **this session** — see "Unified Apty Component Model,
   Investigation Planner & Real Verification Guard" below). An external
   orchestration loop, investigation-aware network capture, console/
   runtime classification, cross-layer (Studio-vs-production) comparison,
   SE/SDE depth modes, and a scenario/evaluation suite remain open — see
   the new gap matrix above.

## What Was Inherited From AIPex

Kept as generic browser-agent infrastructure (see section 12 of the task
brief's classification: this is infrastructure, not AIPex-the-product):
- Chrome extension shell (Manifest V3, side panel, content script,
  background service worker) — `packages/browser-ext`
- DOM snapshot / element UID system — `packages/dom-snapshot`
- Agent core (tool loop, model abstraction via Vercel AI SDK) —
  `packages/core`
- Browser automation: CDP commander + debugger lifecycle management, DOM
  locators, iframe manager, screenshot capture — `packages/browser-runtime/src/automation`
- MCP bridge (WebSocket, Origin-validated, loopback-only) — `mcp-bridge/`
- Human-in-the-loop intervention system (`monitor-operation`,
  `user-selection`) — `packages/browser-runtime/src/intervention`
- Skill system with a real QuickJS WASM sandbox (not `eval`) —
  `packages/browser-runtime/src/skill`
- 41 existing browser/tab/DOM/screenshot/skill tools in the tool registry

## What Was Removed From AIPex

(Prior session — see `CHANGELOG.md` for the full list.) Proxy/login auth
mode, conversation sharing, user-manual replay-from-website, recording/
screenshot upload to AIPex's own backend, version checking against AIPex's
release feed, voice input (ElevenLabs STT + VAD) and its three.js particle
visualization, AIPex's own marketing/community UI, non-English READMEs,
AIPex's release automation (`bump`/`release` workflows).

## What Was Modified

- **System prompt** (`packages/aipex-react/src/components/chatbot/constants.ts`):
  rewritten from a generic "AIPex browser assistant" (tab/bookmark/history/
  clipboard management, shopping-style task examples) into the Apty Live
  Browser Debugging Agent persona: the debugging loop, evidence-first
  CONFIRMED/LIKELY/POSSIBLE/UNKNOWN diagnosis format, explicit tool-boundary
  honesty rules, and an explicit prompt-injection defense instruction.
  Also fixed a latent type bug: it was a `string[]` assigned to a field
  typed `instructions?: string` — now a real joined string.
- Agent name: `"AIPex Browser Assistant"` → `"Apty Live Browser Debugging Agent"`
  (`packages/browser-ext/src/lib/browser-agent-config.ts`)
- `get_apty_debug_logs` renamed to `get_apty_page_logs` and now redacts
  sensitive values before returning log entries.

## What Was Added

**Evidence model & Apty provider interfaces** (`packages/browser-runtime/src/apty/`):
- `types.ts` — `DiagnosticEvidence`, `EvidenceSource`, `DiagnosisConfidence`,
  `AptyIntegrationStatus`, and the four provider interfaces:
  `AptyClientDiagnosticsProvider`, `AptyWidgetDiagnosticsProvider`,
  `AptyStudioDiagnosticsProvider`, `AptyServiceWorkerDiagnosticsProvider`.
- `redact.ts` (+ `redact.test.ts`, 7 tests) — strips `Authorization`/
  `Cookie`/`X-Api-Key` headers and inline `token=`/`password=`/`Bearer ...`
  patterns from any text or headers before it reaches the model.
- `widget-diagnostics.ts` / `client-diagnostics.ts` — real implementations
  that probe a documented `window.__APTY_WIDGET__` / `window.__APTY_CLIENT__`
  global via `chrome.scripting.executeScript` (MAIN world). **Neither global
  is implemented by Apty yet** — these report `status: "not_configured"`
  until the Widget/Client teams add them.
- `studio-diagnostics.ts` / `service-worker-diagnostics.ts` — cross-extension
  messaging (`chrome.runtime.sendMessage(extensionId, ...)`) and/or an HTTP
  diagnostic endpoint, gated on config that is empty by default. **Neither
  mechanism exists on the Apty side yet.**
- `config.ts` — reads/writes the above extension IDs and endpoints via
  `chrome.storage.local`, seeded at service-worker startup from build-time
  Vite env vars (see `packages/browser-ext/.env.example`).

**New agent tools** (`packages/browser-runtime/src/tools/`):
- `apty.ts` (5 tools): `get_apty_page_logs`, `get_apty_widget_diagnostics`,
  `get_apty_client_diagnostics`, `get_apty_studio_diagnostics`,
  `get_apty_service_worker_diagnostics`.
- `devtools.ts` (2 tools): `get_network_diagnostics` (CDP `Network` domain —
  request/response/status/failures within a bounded capture window),
  `get_runtime_diagnostics` (CDP `Log`/`Runtime` domains — browser-level log
  entries and uncaught exceptions with stack traces, which do NOT go through
  `console.*` and so are invisible to `get_apty_page_logs`).

Total tool count as of that session: 41, as verified against
`allBrowserTools` in `packages/browser-runtime/src/tools/index.ts` (a prior
estimate of 47 in this file was not checked against the registry and was
corrected). **Now 44** — see "Evidence Correlation & Investigation
Timeline" and "Selector Diagnostics" below for the 3 tools added this
session.

- `packages/browser-ext/src/apty-console-bridge.ts` (prior session): a
  MAIN-world content script that buffers console output/errors on every
  page since load — this is what `get_apty_page_logs` reads.

## Evidence Correlation & Investigation Timeline (this session)

Implements the gap matrix's P0 "deterministic evidence correlation" item.
Every diagnostic tool already existed and returned useful data on its own;
what was missing was anything that remembered findings *across* tool calls
within one conversation and pointed out which ones plausibly relate.

**Added**:
- `packages/browser-runtime/src/apty/types.ts` — `DiagnosticEvidence`
  extended with `evidenceId`, `conversationId`, `tabId`, `frameId`, `url`,
  `requestId`, `correlationId`, `scope` (`"tab" | "shared" | "unknown"`),
  matching the fields the product spec asked for. Was previously defined
  but never constructed anywhere (verified in the gap audit); now it is.
- `packages/browser-runtime/src/apty/evidence-store.ts` — a bounded
  (500-entries-per-conversation) `Map<conversationId, DiagnosticEvidence[]>`.
  Deliberately keyed by conversation, the same isolation principle as
  `conversation-tab-binding.ts`'s `Map<sessionId, tabId>` — one
  conversation's evidence must never appear in another's timeline.
- `packages/browser-runtime/src/apty/evidence-correlation.ts` —
  `correlateEvidence()`: groups evidence into clusters via exact-match on
  `requestId`/`correlationId` (regardless of time gap) plus a bounded
  time-window fallback scoped to the same tab (or either side being
  `scope: "shared"`, e.g. a service-worker log). Clusters spanning a
  network failure *and* a console/runtime error are flagged
  `likelySameIncident: true`. `formatTimeline()` renders a compact
  human-readable view. Fully unit-tested (17 tests) with the exact kind of
  scenario the spec's example describes (click → request → 500 → console
  error, all in one flagged cluster).
- Every existing diagnostic tool now records warn/error-level findings as
  evidence as a side effect of its normal return value: `apty.ts`'s 5
  tools (console logs, widget/client status+logs, studio status+logs,
  service-worker status+logs — the latter two correctly tagged
  `scope: "shared"`, never falsely attributed to a tab) and `devtools.ts`'s
  2 tools (failed/error-status network requests with their `requestId`;
  exceptions and warning/error-level runtime log entries). Routine
  log/info-level entries and successful requests are deliberately **not**
  recorded — evidence, not a full log dump.
- Two new tools (`packages/browser-runtime/src/tools/investigation.ts`):
  `get_investigation_timeline` (returns the correlated view of everything
  collected so far in this conversation) and
  `clear_investigation_evidence` (discard evidence when starting a fresh
  investigation within the same chat).

**Not done**: a full `InvestigationSession` object tracking hypotheses/
verification-attempts/final-diagnosis as first-class state (the gap
matrix's separate "investigation session lifecycle" row) — this is
evidence collection + correlation only, which is what actually feeds a
diagnosis; the session-lifecycle wrapper around it is still a
next-session item.

## Selector Diagnostics (this session)

Implements the gap matrix's P0 "selector debugging as first-class
feature" item — Apty's single most common recurring question ("why can't
Studio/a Workflow select this element") had no dedicated tool anywhere in
the repo before this.

**Added**:
- `packages/browser-runtime/src/automation/selector-analysis.ts` — pure,
  deterministic, unit-tested (29 tests) ranking engine. `looksDynamic()`
  flags framework-generated values (purely numeric ids, UUIDs, a
  numeric/hex suffix like `input-928731`, known CSS-in-JS prefixes like
  `css-`/`sc-`/`jss`). `generateSelectorCandidates()` produces, in priority
  order: `data-apty-*` attributes, stable id, aria attributes, semantic
  attributes (name/type/placeholder/role/href), stable classes (excluding
  dynamic-looking ones), a text-based XPath candidate, and a structural
  path as a last resort — tagging iframe/Shadow-DOM context on every
  candidate when relevant. `rankSelectorCandidates()` combines static risk
  with live match data (0 matches → broken, >1 → risky/ambiguous, unique +
  low-risk → recommended) into a ✅/⚠️/❌ verdict, exactly matching the
  product spec's example format (`formatSelectorReport()`).
- `packages/browser-runtime/src/tools/selector.ts` —
  `analyze_element_selectors` tool: given a snapshot `uid` (from
  `search_elements`/`take_snapshot`, same as the existing click/fill
  tools), resolves the live element via CDP, extracts its
  tag/id/classes/attributes/text/ancestor-chain/iframe/shadow-root context
  in one `Runtime.callFunctionOn` call, generates candidates, live-tests
  every candidate's actual match count in a second call, and returns the
  ranked report. CDP-mode snapshots only (needs a `backendDOMNodeId`) —
  DOM-mode snapshots report `available: false` with a clear reason, per
  this repo's "honest stubs, not silent degradation" precedent
  (`DECISIONS.md`). Attribute values and text content are redacted
  (`redactSensitiveText`) before candidate generation, same discipline as
  every other Apty-facing tool.

**Service Worker diagnostics hardening (this session)**:
- `service-worker-diagnostics.ts` now validates every external response
  (Zod schemas for both the messaging and HTTP-endpoint paths) instead of
  blindly trusting an `as` cast — a malformed response is reported as
  `status: "error"` (or empty logs), never allowed to crash the tool or
  silently pass through garbage.
- Logs returned by this provider are now redacted (`redactLogs`) before
  reaching the model — previously only Widget/Client logs were redacted;
  Service Worker logs were not. This was flagged as an open gap in
  `SECURITY_AUDIT.md` finding #4 and is now fixed for this provider.
- A defensive ceiling (`MAX_LOGS_ACCEPTED = 2000`) rejects an oversized
  logs array from a misbehaving/compromised producer, independent of
  whatever bound the producer itself uses.
- The `get_apty_service_worker_diagnostics` tool now tags its result with
  `scope: "shared-global"` and an explicit note that the service worker is
  shared across every tab, so the agent doesn't misattribute a log to
  whichever tab is currently being investigated.
- `docs/apty-integration/apty-widget-service-worker.reference.ts` — a
  complete, adaptable reference implementation of the producer side
  (safe circular-safe argument serialization, a bounded + debounced +
  `chrome.storage.local`-persisted log buffer that survives MV3
  service-worker restarts, and a sender-validated `onMessageExternal`
  handler). This is documentation/hand-off material for the Apty Widget
  team, not part of this extension's build — see
  `docs/apty-integration/README.md`.
- 16 new tests (`service-worker-diagnostics.test.ts`) covering both the
  extension-messaging and HTTP-endpoint paths: success, timeout,
  `chrome.runtime.lastError`, malformed response, oversized response,
  redaction, and endpoint-preference-over-messaging.

## Investigation Session Lifecycle (this session)

Implements the gap matrix's "investigation session lifecycle" row — the
evidence store/correlation from the prior session tracked *what was
observed*; nothing tracked *what the investigation currently believes*
(hypotheses, suspected components, a diagnosis+confidence, verification
outcomes) as first-class, queryable state.

**Added**:
- `packages/browser-runtime/src/apty/investigation-session.ts` —
  `InvestigationSession { id, conversationId, tabId, startedAt, updatedAt,
  status, userProblem, suspectedComponents, hypotheses,
  verificationAttempts, diagnosis?, confidence? }` in a
  `Map<conversationId, InvestigationSession>`, keyed with the exact same
  `"pending"`/unscoped-bucket convention as `evidence-store.ts` (see
  `DECISIONS.md` for why this is a separate store, not bolted onto
  `Session`/`ConversationData`). `status` is one of `starting |
  investigating | collecting_evidence | analyzing | verifying | resolved |
  failed | stopped`. 15 unit tests (`investigation-session.test.ts`)
  covering the full lifecycle, cross-conversation isolation, and the
  `"pending"` bucket convention.
- Five new tools (`packages/browser-runtime/src/tools/investigation.ts`):
  `start_investigation`, `update_investigation` (status transitions,
  `addHypothesis`, `addSuspectedComponent`, `diagnosis`+`confidence`),
  `record_verification_attempt`, `stop_investigation`, and
  `get_investigation_status`. 6 new tests covering the full lifecycle
  end-to-end and no-op behavior when no investigation has been started.
- The system prompt's "THE DEBUGGING LOOP" section
  (`packages/aipex-react/src/components/chatbot/constants.ts`) now
  instructs the model to call these tools at each step (start before
  collecting evidence, update status through collecting/analyzing/
  verifying, record a diagnosis+confidence via `update_investigation`,
  record verification outcomes, close out via `stop_investigation`) — this
  is what makes the new UI's status genuinely reflect application state
  rather than a guess (see next section).

**Not done**: no server-side enforcement that the model actually calls
these tools in order (or at all) — a model that ignores the system prompt
instructions simply leaves the investigation lifecycle at its last state
(or never starts one), same class of limitation as the evidence-first
diagnosis format itself. Automated multi-step verification loops (the
model deciding on its own when to re-verify) — today verification is
triggered by the user (or the UI's "Verify diagnosis" button, which just
sends a chat message) — remain a possible future enhancement, not
attempted this session.

## Side Panel Redesign (this session)

Implements the gap matrix's UI row and the product brief's core ask:
transform the generic AIPex-inherited chat UI into an investigation-first
Apty debugging console. Full component-by-component detail is in
`ARCHITECTURE.md`'s "Side panel UI architecture" section; summary here.

**Added** (`packages/browser-ext/src/lib/investigation/`, new directory):
- `component-health.ts` (+ 9 unit tests) — pure derivation of Client/
  Widget/Studio/Service-Worker health from the most recent `*-status`
  evidence per component; `not_checked` when no evidence exists yet, never
  a fabricated status.
- `use-investigation-data.ts` — polling hook reading
  `getEvidence`/`getInvestigation`/`correlateEvidence` directly from
  `@aipexstudio/browser-runtime` (safe because tool execution and the side
  panel UI share one JS realm — see `DECISIONS.md`).
- `use-current-target.ts` — tracks the bound (or active) tab's title/
  hostname only, never the full URL, via `chrome.tabs`.
- `investigation-context-bar.tsx` — rendered inside `BrowserChatHeader`:
  a quiet context line normally, a "LIVE INVESTIGATION" banner with a real
  Stop action (confirms via dialog, then calls `stopInvestigation()` +
  `interrupt()`) while an investigation is actually in progress.
- `investigation-summary-bar.tsx` — collapsible Timeline/Components/
  Diagnosis tabs above the chat input (`promptExtras` slot); renders
  nothing when there's no investigation and no evidence yet.
- `evidence-timeline.tsx`, `component-health-panel.tsx`, `diagnosis-card.tsx`
  (+ RTL tests for the latter two) — the three views inside the summary
  bar, all rendering real store data with progressive disclosure into raw
  (already-redacted) evidence payloads.
- `debugging-welcome-screen.tsx` — Apty-specific empty-state prompts,
  wired via the `emptyState` slot, replacing the generic "how can I help
  you today" AIPex welcome screen.
- `selector-analysis-display.tsx` + `apty-tool-display.tsx` — a dedicated
  visual for `analyze_element_selectors` (recommended selector, ranked
  candidates, iframe/Shadow-DOM boundary note, copy-selector button),
  dispatched via the `toolDisplay` slot; every other tool still falls back
  to the pre-existing `DefaultToolDisplay`.
- `status-meta.ts` / `tone-classes.ts` — shared label/color mapping so no
  component invents its own status vocabulary.

**Modified**:
- `packages/aipex-react/src/i18n/locales/{en,zh}.json` — friendly,
  emoji-prefixed activity labels for every Apty/investigation/selector
  tool (e.g. `"get_network_diagnostics": "🌐 Checking network requests"`),
  added to the existing `tools.*` translation table rather than a new
  mapping layer (see `DECISIONS.md`).
- `packages/aipex-react/src/components/chatbot/components/slots/tool-display.tsx`
  — `DefaultToolDisplay` now shows the raw tool name (and duration) in its
  expanded technical details when it differs from the friendly label.
- `packages/browser-ext/src/lib/browser-chat-header.tsx` — now actually
  renders the `title` prop (previously accepted but never displayed —
  a real, if minor, pre-existing bug) and hosts `InvestigationContextBar`.
- `packages/browser-ext/src/lib/conversation-tab-binding.ts` — added
  `peekConversationTabBinding()`, a read-only lookup for UI display that
  never mutates or creates a binding (diagnostic tools keep using
  `resolveConversationRunContext`/`resolveDiagnosticTab`, not this).
- `packages/browser-ext/vitest.config.ts` — added the same
  `@aipexstudio/aipex-react/*` → source alias `vite.config.ts` already
  used for the real build; without it, tests couldn't resolve deep
  subpaths (`/lib/utils`, `/components/ui/*`) that aren't in
  `aipex-react`'s `package.json` exports map but do resolve at build time
  via that alias — a latent test/build resolution mismatch, now fixed.

**Not done**: a dedicated multi-field "start investigation" form/component
tab (product brief section 11) — the model infers investigation intent
from natural language per the system prompt's debugging loop, matching the
brief's own "don't force a form before every question" guidance, so this
was a deliberate omission, not an oversight. No RTL/component tests exist
yet for `investigation-context-bar.tsx`/`investigation-summary-bar.tsx`
themselves (they depend on `useChatContext` + live `chrome.tabs`); the
pure logic and leaf presentational components they compose are tested.
Manual verification (loading the built extension and clicking through
investigation start/stop, evidence collection, and diagnosis states
against a real Apty deployment) has not been performed this session — see
`## Known Limitations`.

## Unified Apty Component Model, Investigation Planner & Real Verification Guard (this session)

A new, more demanding specification arrived focused on automating an Apty
SE/SDE's actual manual investigation work, with one architectural
correction that mattered enough to implement first: Apty ships two Chrome
extensions (Studio, and one runtime extension that goes by several names —
Client/Widget/Player — but is architecturally one component), not four.
This session's P0 work (see the new gap matrix above) implements exactly
the master prompt's own P0 list: correct the component model, add a
planner, add structured hypotheses, add a real (not just prompted)
verification guard.

**Unified component model**:
- `AptyComponentKind` (`apty/investigation-session.ts`) is now
  `"apty-client-widget-player" | "apty-studio"` — the concept an
  investigation's `suspectedComponents` and the model's tool calls reason
  about. `EvidenceSource` (`apty/types.ts`) deliberately stays granular
  (`apty-client`/`apty-widget`/`service-worker`/`apty-studio`) — it still
  matters which probe produced a given piece of evidence — the
  unification happens one layer up, at the product-facing "which
  component" concept, not by throwing away probe-level detail.
- `packages/browser-ext/src/lib/investigation/component-health.ts` now
  derives exactly two grouped rows ("Apty Client / Widget / Player" and
  "Apty Studio") instead of four, each with `subComponents` for per-probe
  drill-down, aggregated worst-signal-wins (error > warning > healthy >
  not_detected > not_configured > not_checked).

**Investigation planner** (`apty/investigation-planner.ts`, 8 tests):
`planInvestigation(userProblem)` matches a lowercased problem description
against a small, easily-extended pattern registry — tooltip not showing,
Studio can't select an element, works in Studio but not production,
workflow not triggering, widget not loading — each producing an ordered
`PlanStep[]` (id, description, suggested tools). No match falls back to a
generic host-app → Apty-runtime → Studio → correlate → verify checklist,
so every investigation gets a usable plan. `start_investigation` generates
and stores this plan on the `InvestigationSession`; `get_investigation_plan`
(new tool) surfaces it to the model, and `update_investigation`'s
`completedPlanStepId`/`skippedPlanStepId` track real progress against it.
The plan is explicitly advisory in both the tool descriptions and the
system prompt — the model is told to deviate when evidence points
elsewhere, not to follow it mechanically.

**Structured hypotheses**: `Hypothesis` replaces bare strings —
`{ id, statement, status, confidence, supportingEvidenceIds,
contradictingEvidenceIds, createdAt, updatedAt }`, status one of
`open | testing | supported | rejected | confirmed | inconclusive`.
`update_investigation`'s new `updateHypothesis` field moves one through
that lifecycle and records which evidence ids (from
`get_investigation_timeline`) support or contradict it.

**Real verification loop, not just a prompted one**:
`record_verification_attempt` now accepts an optional `hypothesisId` and
automatically updates that hypothesis's status to match the outcome
(`confirmed`→confirmed, `not_confirmed`→rejected, `inconclusive`→testing).
More importantly, `updateInvestigation()` (the store function, not just
the tool wrapper — so this can't be bypassed) **enforces** the master
prompt's "do not allow the system to turn an unverified hypothesis into a
confirmed RCA" rule: a requested `confidence: "confirmed"` is silently
downgraded to `"likely"` unless a verification attempt with outcome
`"confirmed"` already exists in that investigation. The tool layer
detects this downgrade and returns an explicit `warning` field so the
model (and, transitively, the user) is never left thinking something is
CONFIRMED when the system actually downgraded it. This is deterministic
and unit-tested (`investigation-session.test.ts`,
`tools/investigation.test.ts`), not merely a system-prompt instruction the
model could ignore.

**System prompt**: rewritten debugging-loop section (now 13 steps) walks
through calling `start_investigation` → `get_investigation_plan` →
evidence collection → `get_investigation_timeline` → structured
hypothesis formation/testing via `updateHypothesis` → verification via
`record_verification_attempt` (with `hypothesisId`) → diagnosis, and
explicitly warns the model that an unverified "confirmed" gets downgraded
so it must check the tool's returned confidence before telling the user
something is CONFIRMED. A new "APTY PRODUCT ARCHITECTURE" section states
the two-extension model up front.

**Not done**: no server-side enforcement that the model calls
`start_investigation`/follows the plan/updates hypotheses at all — same
class of limitation as the pre-existing evidence-first diagnosis format
(a model that ignores the system prompt just leaves the lifecycle
un-updated). See the new gap matrix above for what remains (P0.3
orchestration loop, P1 items) and `DECISIONS.md` for why an external
orchestrator wasn't attempted this session.

## Debugger Attach No Longer Mutates the Page (this session)

The master prompt's Phase 17 specifically asked for an audit of
`debugger-manager.ts` for destructive page manipulation. Found one: before
every `chrome.debugger.attach()` call, `safeAttachDebugger()` ran a content
script that recursively searched the entire page — including into every
Shadow DOM subtree — for any `<iframe>` whose `src` started with
`chrome-extension://` (not scoped to this extension's own id — any
extension's iframe matched) and called `.remove()` on each one found, then
waited 200ms before proceeding. This was inherited unchanged from the
original AIPex import, had no comment explaining why, no test, and nothing
in this codebase actually injects such an iframe today — there was no
evidence it was ever required. For a product whose entire premise is "the
webpage's actual state is the evidence," unconditionally deleting elements
from that page as a side effect of enabling diagnostics is exactly the
"diagnostics create the problem being diagnosed" failure mode the master
prompt warns against — most concretely, if Apty's own Widget ever renders
as an overlay iframe, this code could delete it while investigating "why
isn't the widget showing," manufacturing the very symptom under
investigation. Removed entirely; 5 new regression tests
(`debugger-manager.test.ts`) pin down that attach/detach/auto-detach/lock
behavior all still work and that `chrome.scripting.executeScript` is never
called as part of the attach/detach lifecycle. See `SECURITY_AUDIT.md`
finding #8.

## Console/Runtime Event Classification (this session)

The previous session's own gap matrix flagged P1.7 ("Console/runtime
classification") as not done: `get_apty_page_logs` and
`get_runtime_diagnostics` returned raw entries, leaving it to the model to
re-derive "is this a CSP violation, a CORS failure, or an Apty-widget
error" from free text on every investigation. Implemented
`packages/browser-runtime/src/apty/log-classification.ts`:
`classifyLogEntry({ text, level, hint })` returns one of
`csp-violation`/`cors-error`/`unhandled-rejection`/`js-exception`/
`network-resource-error`/`deprecation-warning`/`apty-error`/
`console-error`/`console-warning`/`info`, checking more specific patterns
before falling back to a level-based default (so a `TypeError` that
happens to mention "Apty" still classifies as `js-exception`, not
`apty-error` — precedence matters and is tested explicitly). Both
`get_apty_page_logs` (`tools/apty.ts`) and `get_runtime_diagnostics`
(`tools/devtools.ts`) now attach a `category` to every returned
entry/event and a `categoryCounts` tally to the response;
`get_runtime_diagnostics` also now captures CDP `Log.entryAdded`'s own
`entry.source` field (previously discarded) and passes it through as the
classifier's structured `hint`, which resolves a few otherwise-ambiguous
cases (e.g. a CDP-reported `source: "security"` entry with wording that
doesn't literally contain "Content Security Policy"). This is text/
metadata pattern-matching only — it runs on already-redacted text
(`redactSensitiveText`/`redactLogs` already ran), reads no new data,
calls no new API, and requests no new permission; see `SECURITY_AUDIT.md`
finding #10.

**Why this stayed a fixed, hand-authored regex taxonomy and not a second
LLM call or an ML classifier**: the categories are aimed at a small,
well-understood set of browser/JS failure modes (CSP, CORS, JS exceptions,
network-resource failures, deprecations) that have stable, recognizable
text signatures — the same signatures a human engineer would grep for.
A second model call would add latency and cost to every diagnostic tool
call for a problem regex already solves deterministically and testably.

Tested in `log-classification.test.ts` (12 cases: one per category, plus a
precedence case and an unrecognized-hint fallback case) plus one
integration test each in `apty.test.ts`/`devtools.test.ts` confirming the
new fields appear on real tool output through the existing mock harnesses.

**What's still open**: this is text/metadata pattern-matching, not a
guarantee — an entry that doesn't match any pattern and isn't warn/error
level falls through to `"info"`, which is a reasonable default but not
infallible; a genuinely novel failure mode with unfamiliar wording could
be under-classified until a pattern is added for it. No Apty-side
capability is required or blocked here — this is a pure client-side
convenience over data the tools already had access to.

## Investigation-Aware Network Capture (this session)

The previous session's gap matrix flagged P1.6 ("Investigation-aware
network capture") as not done: `get_network_diagnostics` only opens a
fixed 500ms–15s CDP capture window at call time, so it has to be called
right as the user reproduces the issue — any multi-step reproduction
(navigate, wait for an async workflow step, then click) easily runs
longer than the window and the traffic is simply missed. Implemented the
master prompt's actual described flow ("investigation starts → network
capture starts → investigation performs actions → network events
captured → investigation ends → requests correlated to investigation")
instead of the fixed-window shortcut:

- `packages/browser-runtime/src/apty/network-capture-session.ts` — a new
  per-conversation capture session, mirroring `evidence-store.ts`/
  `investigation-session.ts`'s `Map<conversationId, …>` isolation.
  `startNetworkCapture()` attaches the debugger, enables `Network.*`, and
  registers a `chrome.debugger.onEvent` listener that accumulates
  requests in the background — it returns immediately rather than
  blocking on a timer. `stopNetworkCapture()` (called whenever the model
  decides enough turns have passed) detaches, disables the domain, and
  returns everything captured in between. If an investigation is active
  when the capture starts, its id is stamped onto the session and onto
  any failure evidence recorded at stop time (via `correlationId`), so a
  network failure found this way is traceable back to the investigation
  that triggered the capture — the concrete "requests correlated to
  investigation" step the master prompt asks for.
- **The 30s idle auto-detach problem**: `debugger-manager.ts`'s existing
  `safeDetachDebugger` only *schedules* a 30s auto-detach (it doesn't
  detach immediately) — every existing CDP tool call resets that timer as
  a side effect, which is why chaining several fixed-window tool calls
  within 30s of each other already worked. A capture session can
  legitimately run for minutes while a user reproduces an issue, well
  past that window, so `startNetworkCapture` also starts a 15s heartbeat
  that re-calls `safeAttachDebugger` (a no-op against an already-attached
  tab beyond resetting its idle timer) for as long as the capture is
  running, and clears it on stop. This is the one piece of this feature
  that isn't just "the old fixed-window code without the `setTimeout`" —
  without it, an idle capture running unattended for >30s would silently
  lose its debugger attachment (and therefore all further events) with no
  error surfaced to the model.
- Reused `redactHeaders` for every captured request/response header
  (same redaction already applied by `get_network_diagnostics`) and added
  `resourceType`/`initiatorType` fields (from CDP's `Network.
  requestWillBeSent` `type`/`initiator.type`) that the fixed-window tool
  didn't capture — the master prompt's network-investigation section
  explicitly asks for resource type and initiator.
- Three new tools (`packages/browser-runtime/src/tools/network-capture.ts`):
  `start_network_capture`, `stop_network_capture` (`onlyErrors` filter,
  same semantics as `get_network_diagnostics`), and
  `get_network_capture_status` (check progress without stopping). All
  three registered in `tools/index.ts`; `get_network_diagnostics` is
  intentionally left in place unchanged — it's still the right tool for
  "something is about to happen right now, watch for 3 seconds", while
  the new tools are for "let me reproduce this properly."
  `mcp-bridge/src/tool-schemas.ts` gained these three schemas, plus a
  standalone fix for a pre-existing gap noted (not introduced) by the
  prior session: all 8 `investigation.ts` tools and
  `analyze_element_selectors` were never added to that file — they are
  now.

**What's still open**: this only covers the network layer. A parallel
"investigation-aware" capture for console/runtime events
(`get_runtime_diagnostics`'s own fixed window) was not attempted this
session — the same 30s-heartbeat pattern would generalize to it directly
if picked up next. A capture session is in-memory only, like every other
per-conversation store in this codebase — it does not survive a
service-worker restart; if the extension's service worker is evicted
mid-capture, the capture is silently lost (the debugger detaches, but
nothing currently notifies the model). This mirrors the existing
trade-off `evidence-store.ts`/`investigation-session.ts` already accept,
not a new one introduced here.

Tested in `network-capture-session.test.ts` (12 cases: start/stop
lifecycle, duplicate-start rejection, attach failure, request
accumulation across events, `onlyErrors` filtering plus full-set evidence
recording, investigation-id tagging, stop-with-no-capture error,
per-conversation isolation on a shared tab, status reporting, and the 15s
heartbeat re-attaching on a fake timer) and `tools/network-capture.test.ts`
(3 tool-level integration cases covering the full start→status→stop
round trip, captured-request pass-through, and the two user-facing error
paths).

## Completed

- Evidence model + 4 provider interfaces with honest `not_configured`/
  `unavailable` states (no fabricated Apty data anywhere).
- Redaction utility, unit-tested, applied to all log-bearing tools.
- DevTools CDP tools for network and runtime diagnostics, reusing the
  existing `debuggerManager`/`CdpCommander` infrastructure.
- Config plumbing: `.env.example` → Vite env → `chrome.storage.local` →
  tool-call-time config read.
- System prompt rewritten for the debugging persona, now including the
  investigation-lifecycle tool calls at each step of the debugging loop.
- Deterministic evidence correlation, investigation timeline, and selector
  diagnostics (prior session).
- Investigation session lifecycle (`InvestigationSession` + tools) and a
  full investigation-first side panel redesign (prior session).
- Corrected two-extension Apty component model, a deterministic
  investigation planner, structured hypotheses, and a real server-enforced
  verification guard (prior session).
- Fixed `debugger-manager.ts` deleting extension iframes from the live
  page on every diagnostic attach (prior session).
- Console/runtime event classification for `get_apty_page_logs` and
  `get_runtime_diagnostics` (prior session).
- Investigation-aware network capture (start/reproduce/stop, not a fixed
  window), tagged to the active investigation — see the section above
  (this session). `mcp-bridge/src/tool-schemas.ts`'s pre-existing gap
  (missing all `investigation.ts` tools + `analyze_element_selectors`)
  fixed alongside it (this session).
- All 5 packages build, typecheck, and pass their test suites — see
  `## Tests` below for current numbers.

## Currently Working On

Documentation for this checkpoint (`PROJECT_PROGRESS.md`, `ARCHITECTURE.md`,
`DECISIONS.md`, `SECURITY_AUDIT.md`, `CHANGELOG.md`) and the commit/push
sequence.

## Next Steps

In priority order (see the new gap matrix above for the full P0/P1/P2
picture against the engineering-automation master prompt):
1. **Get real Apty-side integration info**: the Widget/Client global
   contract (or confirm the proposed `window.__APTY_WIDGET__`/
   `__APTY_CLIENT__` shape with those teams), and Studio's actual extension
   ID + willingness to implement `externally_connectable` + a message
   handler. This is genuinely blocked without Apty engineering input — see
   `## NEXT SESSION HANDOFF`.
2. **Investigation-aware network capture** (P1.6): replace/extend the
   fixed 500ms–15s `get_network_diagnostics` window with a "start capture
   → user reproduces → stop → analyze" session scoped to the investigation
   — bounded, cancellable, tab-scoped, redacted.
3. **Console/runtime classification** (P1.7): classify raw log/exception
   entries into apty-error/CSP/CORS/JS-exception/network-related/selector-
   or-DOM/extension-communication/unknown buckets instead of returning
   them as-is.
4. **Cross-layer (Studio-vs-production) comparison tool** (P1.8): a
   dedicated deterministic comparison between Studio's configured
   selector/content state and the live production DOM/Client state — the
   planner's `studio-vs-production` category already has a "compare" step,
   but no tool backs it yet beyond the existing individual diagnostics.
5. **Scope `host-access-config.json`** (`packages/browser-ext/host-access-config.json`,
   currently `"mode": "include-all"`) to Apty's actual target application
   domains once those are known, rather than every site the user visits.
6. **Scope the console-capture content script** (`apty-console-bridge.ts`,
   currently `<all_urls>`) the same way, for the same privacy reason.
7. **Manual/browser verification of the UI** against a real (or locally
   stubbed) Apty deployment — every session so far has validated the UI
   through build/typecheck/unit+component tests only; loading the built
   extension and clicking through a live investigation (start → evidence
   → diagnosis → verify → stop) has not been done. See `## Known
   Limitations`.
8. **An external investigation orchestration loop** (P0.3 in the new gap
   matrix, deliberately not attempted this session) — plan→execute→
   observe→evaluate→decide as logic outside the model's own tool-calling
   loop, not just decision-support data the model may or may not use. See
   `DECISIONS.md` for why this needs its own dedicated session rather than
   being bolted onto this one's P0.1/P0.2/P0.4/P0.5 work.
9. **SE/SDE investigation depth modes** (P2.12): one engine, a
   configurable depth setting (SE: content/workflow/selector-focused; SDE:
   allow deeper CDP/extension-messaging/timing internals) — no depth
   concept exists yet.
10. **Scenario/evaluation suite** (P2.17): the master prompt's 12 named
    SE/SDE scenarios (tooltip target missing, dynamic-id selector, iframe/
    Shadow DOM cases, SPA navigation replacing target, 4xx/5xx content
    requests, Client init failure, host JS error, Studio can't select,
    Studio-vs-production, stale UID, runtime-error-correlated-with-network-
    failure) as an actual repeatable eval harness — not built yet.
11. **Options UI for Apty integration config**: today, `studioExtensionId`
    etc. are only settable via `.env` (build time) or directly writing to
    `chrome.storage.local` (`setAptyIntegrationConfig`). A small settings
    panel would make this actually usable day-to-day.
12. **A dedicated "start investigation" form/component-picker** — still
    deliberately not built (natural-language intent + the debugging-loop
    system prompt cover it); revisit if real usage shows the model isn't
    reliably calling `start_investigation`.
13. Continue trimming internal "AIPex" naming (package names, class names,
    storage-key prefixes) if/when it's worth the churn — deliberately not
    done yet (see `DECISIONS.md`).

## Architecture

See `ARCHITECTURE.md` for the full picture. Summary: AI reasons over tool
results; a deterministic browser-control layer executes actions; MCP is a
transport, not the automation engine; there is no RAG layer.

## Important Files

- `packages/browser-runtime/src/apty/` — evidence model, redaction, all
  four Apty provider interfaces + implementations
- `packages/browser-runtime/src/tools/apty.ts` — Apty-facing agent tools
- `packages/browser-runtime/src/tools/devtools.ts` — CDP network/runtime tools
- `packages/browser-ext/src/apty-console-bridge.ts` — MAIN-world console capture
- `packages/browser-ext/.env.example` — Apty integration config placeholders
- `packages/aipex-react/src/components/chatbot/constants.ts` — system prompt
- `packages/browser-runtime/src/tools/index.ts` — the tool registry

## Apty Studio Integration

Status: **Not implemented — requires Apty-side work.**
Implementation: `packages/browser-runtime/src/apty/studio-diagnostics.ts`
(`ExternalMessageStudioDiagnosticsProvider`) — sends
`{type: "apty-debug-agent:get-studio-status"}` / `get-studio-logs` via
`chrome.runtime.sendMessage(studioExtensionId, ...)`.
Configuration: `VITE_APTY_STUDIO_EXTENSION_ID` in `packages/browser-ext/.env`.
Remaining: Studio needs (1) a real extension ID to configure here, (2) its
own `externally_connectable` allowlisting this extension's ID, and (3) a
message handler that responds to the two message types above. None of that
exists today; the tool will report `status: "not_configured"` (no ID
configured) or `"unavailable"` (ID configured, no response) until it does.

## Apty Widget Integration

Status: **Partially implemented (probe side only) — requires Apty-side work.**
Implementation: `packages/browser-runtime/src/apty/widget-diagnostics.ts`
(`ScriptingWidgetDiagnosticsProvider`) — reads `window.__APTY_WIDGET__` in
the page's MAIN world via `chrome.scripting.executeScript`.
Configuration: none needed on this side (it's a page-context probe, not
cross-extension messaging) — the Widget itself needs to set
`window.__APTY_WIDGET__ = { loaded, initialized, visible, lastError, getLogs }`.
Remaining: the Widget team needs to implement that global. Until then, every
call reports `status: "not_configured"`.

## Apty Client Integration

Status: **Partially implemented (probe side only) — requires Apty-side work.**
Same shape as the Widget: `client-diagnostics.ts` probes
`window.__APTY_CLIENT__ = { loaded, initialized, version, getLogs }`, not
yet implemented by the Client.

## Apty Service Worker Integration

Status: **Consumer side hardened and tested; producer side is a complete,
documented hand-off, not yet built by Apty.**
Implementation: `service-worker-diagnostics.ts`
(`ConfiguredServiceWorkerDiagnosticsProvider`) — supports either
cross-extension messaging (same pattern as Studio) or an HTTP diagnostic
endpoint (`GET <endpoint>/status`, `GET <endpoint>/logs`). Both paths
validate the response with Zod, redact log messages, and cap accepted
array size (2000 entries) before returning anything to the model.
Configuration: `VITE_APTY_SERVICE_WORKER_EXTENSION_ID` or
`VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT` (configure at most one).
Producer reference: `docs/apty-integration/apty-widget-service-worker.reference.ts`
is a complete, adaptable implementation of what needs to live inside the
Apty Widget's own service worker (safe log serialization, a bounded
buffer persisted to `chrome.storage.local` so it survives MV3
service-worker restarts, and a sender-validated external message handler).
Remaining: Chrome fundamentally does not allow one extension to read
another's private service-worker memory — Apty must actually adopt the
reference implementation (or an HTTP-endpoint equivalent) in their own
codebase. Neither exists live today; every call still reports
`status: "not_configured"` against a real deployment until they do.

## Browser Tools

53 tools registered in `packages/browser-runtime/src/tools/index.ts`:
tabs (7), UI operations/element interaction (8), page content (4),
screenshots (3), downloads (2), interventions (4), skills (6), DevTools (2),
Apty integration (5), investigation timeline/lifecycle (8:
`get_investigation_timeline`/`clear_investigation_evidence`,
`start_investigation`/`get_investigation_plan`
/`update_investigation`/`record_verification_attempt`/`stop_investigation`/
`get_investigation_status`), selector diagnostics (1), investigation-aware
network capture (3: `start_network_capture`/`stop_network_capture`/
`get_network_capture_status` — new this session). See that file for the
authoritative, categorized list (its own header comment count is derived
from this same array, not maintained by hand). (`bookmark.ts`,
`history.ts` and `organize-tabs.ts` exist as source files but are not
registered in `allBrowserTools`.) `mcp-bridge/src/tool-schemas.ts` (a
separate, non-workspace package) previously never included any of
`investigation.ts`'s 8 tools or `selector.ts`'s
`analyze_element_selectors` — a pre-existing gap from before the prior
session, not a regression, but left unaddressed until now. Fixed this
session: all 8 investigation tools, `analyze_element_selectors`, and the
3 new network-capture tools were added, so the bridge's tool surface now
matches the real registry (still hand-maintained, not generated — a
future drift is possible if a tool is added to `tools/index.ts` without a
matching update here, same risk as before).

## DevTools

`get_network_diagnostics` and `get_runtime_diagnostics`
(`packages/browser-runtime/src/tools/devtools.ts`) — both reuse the
existing `debuggerManager`/`CdpCommander` attach/detach lifecycle. Bounded
capture windows (500ms–15s, default 3s); cannot see anything before the
window opens — this is a hard CDP limitation, not a shortcut taken here.
`get_runtime_diagnostics` (and `get_apty_page_logs` in `tools/apty.ts`) now
classify every entry into a `category` and return a `categoryCounts` tally
— see "Console/Runtime Event Classification" above. `get_network_diagnostics`
still uses its original fixed window unchanged; the new
`start_network_capture`/`stop_network_capture`/`get_network_capture_status`
tools (`apty/network-capture-session.ts`) are the investigation-aware
alternative for reproductions that don't fit inside a short fixed window
— see "Investigation-Aware Network Capture" above. `get_runtime_diagnostics`
does not yet have an equivalent unbounded-capture counterpart.

## MCP

Unchanged architecture from AIPex: `mcp-bridge/` is a standalone Node
package (own `package.json`, not part of the pnpm workspace) exposing a
WebSocket daemon (`ws://127.0.0.1:9223` by default) that the extension
connects to as a client. Origin-header validation rejects all http/https
page origins (prevents cross-site WebSocket hijacking); Node clients
without an Origin header, and `chrome-extension://`/`moz-extension://`
origins, are allowed. `mcp-bridge/src/tool-schemas.ts` was updated to match
the new/renamed Apty and DevTools tools, and (this session) to finally
include the investigation, selector, and network-capture tools it had
been missing.

## Security Audit

See `SECURITY_AUDIT.md` for the full table. Highlights: the
`externally_connectable` hole (any localhost webpage could force-open the
side panel and inject a prompt) was fixed in the prior session. This
session adds redaction (tested) and an explicit prompt-injection defense in
the system prompt — that's a mitigation at the reasoning layer, since there
is no code-level way to stop an LLM from being influenced by data in its
context; it can only be instructed not to comply. `host-access-config.json`
and the console-bridge's `<all_urls>` scope remain open findings — see
`SECURITY_AUDIT.md` for why they weren't fixed here (no real Apty domain
list to scope to).

## Tests

### Passing
- `packages/core`: 217 tests
- `packages/dom-snapshot`: 132 tests
- `packages/browser-runtime`: 312 tests (297 prior + 12 for
  `network-capture-session.test.ts` + 3 for `tools/network-capture.test.ts`
  — this session)
- `packages/aipex-react`: 114 tests (10 pre-existing skips, unrelated to this work)
- `packages/browser-ext`: 57 tests (54 prior + updated/expanded coverage
  in `component-health.test.ts`/`component-health-panel.test.tsx`/
  `diagnosis-card.test.tsx` for the grouped component model and
  structured hypotheses — prior session)
- **Total: 832 passing** — `npm run preflight` (format, lint:fix,
  typecheck, test across all 5 workspace packages) was run clean
  end-to-end this session. `mcp-bridge` has no `typecheck`/`test` script
  and is excluded from `preflight`'s `pnpm -r` steps, same as before this
  session — its missing `ws`/MCP-SDK ambient types (surfaced by an
  ad-hoc `tsc --noEmit` run outside the workspace scripts) are a
  pre-existing gap, not something this session's `tool-schemas.ts` edit
  introduced or could have caught.

### Failing
None known.

### Not Implemented
No tests exist yet for `widget-diagnostics.ts`, `client-diagnostics.ts`, or
`studio-diagnostics.ts` (`service-worker-diagnostics.ts` has 16,
`devtools.ts` now has 3 — 2 covering `get_network_diagnostics`'s
evidence-recording behavior plus 1 covering `get_runtime_diagnostics`'s
new classification fields — not its full CDP mechanics). The remaining untested provider
files are thinner wrappers around `chrome.scripting.executeScript`
specifically (vs. `service-worker-diagnostics.ts`'s
`chrome.runtime.sendMessage`/`fetch`, which mock cleanly) — extending the
same mocking approach to them is straightforward and a reasonable next
increment, not a blocked task. `tools/selector.ts`'s CDP mechanics (as
opposed to the pure ranking engine it calls, which has 29 tests) and a
full `devtools.ts` CDP-mechanics test suite are both in the same category —
see `smart-locator.test.ts`'s `CdpCommander`/`debugger-manager` mocking
pattern, now also used by `devtools.test.ts`, as the template. No RTL
component tests exist for `investigation-context-bar.tsx`/
`investigation-summary-bar.tsx`/`use-investigation-data.ts`/
`use-current-target.ts` (they depend on `useChatContext` + live
`chrome.tabs`, which would need a heavier test harness than this session
built) — the pure logic and leaf presentational components they compose
(`component-health.ts`, `ComponentHealthPanel`, `DiagnosisCard`) are
tested. `plan-checklist.tsx` (new this session) has no dedicated RTL test
either, for the same reason. Manual/integration testing of the new UI
against a real running extension, and against a real Apty deployment, is
still the real end-to-end validation path — not performed this session.

## Multi-Session Isolation — Implementation Notes (implemented this session)

A previous session's research (recorded below, kept for context) concluded
the fix was `RunContext` threading, not a new "DebugSession" class, because
message-history isolation already existed. This session implemented
exactly that, plus one more concrete bug the research didn't catch.

**What shipped:**

- **`RunContext` threading (core → tools).**
  `packages/core/src/types.ts`'s `ChatOptions` gained an opaque
  `runContext?: unknown` field, forwarded by `AIPex.chat()` /
  `runExecution()` (`packages/core/src/agent/aipex.ts`) to `run()`'s
  `context` option. `core` stays browser-agnostic — it doesn't interpret
  the value, just passes it through to every tool's
  `execute(input, context)` as `context.context` (confirmed against
  `@openai/agents-core`'s `runContext.d.ts`/`tool.d.ts`: `RunContext.context`
  holds exactly what was passed to `run()`, and `FunctionTool.invoke()`
  forwards it to `execute` untouched — no `instanceof` checks, so a plain
  object works).
- **`ConversationRunContext` + `resolveDiagnosticTab()`**
  (`packages/browser-runtime/src/tools/tab-utils.ts`): the concrete shape
  (`{ conversationId, tabId }`) and a `getActiveTab()` replacement that
  prefers `context.context.tabId` (verified still open via
  `chrome.tabs.get`) and only falls back to the old "whichever tab is
  focused" behavior when no binding exists or the bound tab was closed.
  Wired into all 5 `apty.ts` tools and both `devtools.ts` tools — the
  tools that actually gather the "Apty evidence" / "console evidence" /
  "network evidence" the isolation spec cares about. The two genuinely
  tab-agnostic tools (`get_apty_studio_diagnostics`,
  `get_apty_service_worker_diagnostics` — cross-extension messaging, not
  page-scoped) now tag their response with the requesting
  `conversationId` instead of guessing a tab, matching the "shared /
  unattributed evidence" pattern the service-worker tool already used for
  its `scope: "shared-global"` field.
- **Per-conversation tab binding, `Map<sessionId, tabId>`**
  (`packages/browser-ext/src/lib/conversation-tab-binding.ts`, new): binds
  a conversation to whichever tab was active when it first got a real
  session id, and keeps reusing that tab even if the user later switches
  focus elsewhere — the actual isolation guarantee. Deliberately a keyed
  map, not a `currentTabId` global. Wired into the chat hook via a new
  `ChatConfig.getRunContext` callback (`packages/aipex-react`'s
  `useChat`/`ChatConfig`) so `aipex-react` itself stays runtime-agnostic;
  `packages/browser-ext/src/pages/common/app-root.tsx` supplies the
  Chrome-specific resolver. Released on "new chat" and on switching to a
  different stored conversation.
- **Fixed a real cross-conversation contamination bug**, found while
  wiring the above, not previously documented: `ConversationData.id` (the
  UI-level, IndexedDB-persisted conversation the history dropdown switches
  between) and `core.Session.id` (the actual LLM message history /
  `RunContext`-bound conversation) are two different id spaces, and
  nothing reconciled them.
  `packages/browser-ext/src/lib/browser-chat-header.tsx`'s
  `handleConversationSelect` restored the UI's message list from the
  selected `ConversationData` but never rebound `useChat`'s internal
  `sessionId` — so sending a message right after restoring an old
  conversation from history would silently continue whatever `core.Session`
  happened to be active (a different conversation's, or none), i.e. one
  conversation's UI receiving a reply generated from a different
  conversation's actual agent memory. This is precisely the "Chat A → Chat
  B" contamination the isolation requirements forbid. Fixed by persisting
  which `core.Session` a `ConversationData` owns
  (`ConversationData.agentSessionId`, `conversation-storage.ts`) and adding
  a `bindSession()` escape hatch to `useChat` (exposed through
  `ChatContextValue`) that `handleConversationSelect` now calls to rebind
  the live session to match, instead of leaving it dangling.
- **Tests**: `packages/core/src/agent/aipex.test.ts` (`runContext` →
  `run()` passthrough, new + resumed sessions),
  `packages/browser-runtime/src/tools/tab-utils.test.ts` +
  `apty.test.ts` (bound-tab vs active-tab resolution, including a real
  `.invoke()` call through `getAptyPageLogsTool`),
  `packages/browser-runtime/src/conversation/__tests__/conversation-storage.test.ts`
  (`agentSessionId` persistence), `packages/aipex-react/src/hooks/use-chat.test.ts`
  (`getRunContext` resolution + `bindSession`), and
  `packages/browser-ext/src/lib/conversation-tab-binding.test.ts` (the
  per-session map itself, including a "two concurrent sessions must not
  share a tab" case).

**What's still a follow-up, not done this session:**

- **`InterventionManager.currentConversationMode`**
  (`packages/browser-runtime/src/intervention/intervention-manager.ts`) is
  a single field, not keyed by conversation — mislabeled ("conversation
  mode" that's actually extension-wide). Not fixed: today there is exactly
  one active conversation per side panel window (see next point), so this
  field's real semantics ("the currently active one in this window") do
  happen to match its current single-field implementation; it would only
  become a real bug once genuinely concurrent conversations exist within
  one window. Flagging so the next session doesn't have to rediscover it
  if that changes.
- **No concurrent multi-chat UI within one side panel window.** The
  history dropdown (`ConversationHistory`) is a *switcher* — one
  conversation displayed at a time — not multiple simultaneous panes. Two
  browser *windows*, each with their own side panel, already are two
  independent JS execution contexts (this session's binding map is
  module-level per JS realm, so this was already safe); genuinely
  concurrent conversations *within* one window's UI would need a
  multi-pane or tabbed chat surface that doesn't exist yet.
- **First-turn tab binding is best-effort.** A conversation's `sessionId`
  doesn't exist until after `agent.chat()`'s first `session_created` event
  fires, so the very first message of a new conversation resolves against
  "whichever tab is active right now" (same as the pre-existing behavior —
  no regression) rather than a bound tab; the binding is established
  starting the second turn. Making turn 1 precise would need `useChat` to
  surface the tab captured at send-time back to the binding module once
  the session id becomes known — a small enhancement, not attempted here
  to keep this change surgical.

<details>
<summary>Original research notes (superseded by the implementation above, kept for history)</summary>

A prior instruction this session asked for full multi-chat/multi-tab
isolation (concurrent debugging conversations, each bound to a specific
tab, with diagnostic evidence never leaking between them). That work was
interrupted before implementation in favor of the narrower Service Worker
task above. Recording what was found so the next session doesn't have to
re-discover it:

- **Chat/conversation isolation already exists at the message-history
  level.** `packages/core/src/conversation/session.ts`'s `Session` class
  (id, message items, token metrics, a generic `metadata: Record<string,
  unknown>` bag via `setMetadata`/`getMetadata`) plus
  `packages/browser-runtime/src/conversation/conversation-storage.ts`
  already give each conversation its own persisted, isolated message
  history. This is NOT the same thing as diagnostic-evidence isolation
  (see next point) but it means chat state itself isn't the gap.
- **The real gap is tool execution being globally-scoped, not
  session-scoped.** Every diagnostic/browser tool (`getActiveTab()` in
  `tools/tab-utils.ts`, used throughout `apty.ts`/`devtools.ts`/etc.)
  queries `chrome.tabs.query({active: true, currentWindow: true})` — "
  whichever tab is active right now," not "the tab this conversation is
  actually about." If a user switches tabs mid-conversation, or two
  windows each have their own side panel open, tool calls silently operate
  on the wrong tab. This is the concrete mechanism that would cause
  cross-session evidence leakage, and it's a real, verifiable gap today,
  not a hypothetical one.
- **The agent SDK already supports exactly the fix needed, unused today.**
  `@openai/agents` (which `packages/core` wraps) supports a generic
  `RunContext<Context>` threaded through every tool call:
  `execute(input, context?: RunContext<Context>, details?: ToolCallDetails)`.
  `packages/core/src/agent/aipex.ts`'s call to `run(this.agent, input,
  {...})` does not currently pass a `context` option at all. The fix is to
  (1) pass `context: { tabId, sessionId }` (or similar) when invoking
  `run()`, bound at conversation-start time to whichever tab the
  conversation is actually about, and (2) update tool `execute` functions
  to prefer `context.context.tabId` over a fresh `getActiveTab()` query
  when present. This reuses existing SDK plumbing rather than inventing a
  parallel session-manager — no new "DebugSession" class needed for this
  part.
- **The side panel is one instance per window, not per tab.**
  `manifest.json`'s `side_panel.default_path` is the single shared page for
  every tab in a window (`chrome.sidePanel.open({tabId})` just tells Chrome
  which window to attach the panel to, it doesn't create per-tab panel
  instances). Chrome's `chrome.sidePanel.setOptions({tabId, path,
  enabled})` API *does* support true per-tab panels if that's wanted
  instead — not yet used here. Two side-by-side windows, each with their
  own side panel, are already two independent JS execution contexts today
  (no shared global state between them unless something explicitly reads
  `chrome.storage.local`), so window-level concurrency mostly already
  works; tab-level concurrency within one window does not, per the
  previous point.
- **Not investigated yet**: how `background.ts` (a single shared service
  worker for the whole extension) would need to key any of its own
  listener state by session/tab if it starts doing session-aware work —
  today it mostly doesn't hold session-scoped state, which is good, but
  this needs re-checking once tool-context binding is implemented.

**Recommended next step for whoever picks this up**: implement the
`RunContext` threading first (smallest, most surgical change, reuses
existing SDK capability) before building any new "DebugSession" class —
it may turn out to be sufficient on its own for the tab-binding problem,
with the existing `Session`/conversation-storage layer already covering
chat-state isolation.

</details>

## Confluence Documentation

A 12-page engineering documentation package exists in Apty's Confluence,
grounded in this repository at commit `14693a9`. Root page:
["Apty Live Browser Debugging Agent"](https://apty.atlassian.net/wiki/spaces/~712020ef582a34887949aa80daf20d290f4d9e/pages/1467679209)
(page ID `1467679209`), which links to all 12 children:

| # | Page | Page ID |
|---|---|---|
| 01 | Product Overview | `1467679232` |
| 02 | Architecture | `1467679254` |
| 03 | How the Agent Works | `1467679275` |
| 04 | Apty Integration | `1467580699` |
| 05 | Service Worker Diagnostics | `1467580720` |
| 06 | Chat & Debug Session Architecture | `1467646342` |
| 07 | Current Implementation Inventory | `1467679296` |
| 08 | Apty Product & Engineering Requirements | `1467646363` |
| 09 | Open Questions for Apty Engineering | `1467613558` |
| 10 | Security Architecture | `1467580742` |
| 11 | Limitations & Future Architecture | `1467580764` |
| 12 | Engineering Handoff Summary | `1467679319` |

This documentation is a snapshot, not a live view — if it and the code ever
disagree, trust the code (this file, `ARCHITECTURE.md`, `SECURITY_AUDIT.md`,
`CHANGELOG.md` in particular) and update the Confluence pages to match.
Writing it was explicitly a documentation-only task — no code in this
repository was modified to produce it, beyond the doc-file updates in this
commit.

## Known Limitations

- No real Apty Widget/Client/Studio/Service-Worker integration — every
  Apty-specific tool currently reports `not_configured`/`unavailable`
  against a real deployment until Apty-side work happens (Service Worker
  now has a complete producer-side reference implementation ready to hand
  off; Studio/Widget/Client do not yet).
- **Multi-session/multi-tab diagnostic isolation is implemented** — see
  "Multi-Session Isolation — Implementation Notes" above for what shipped
  and the remaining follow-ups (per-window-only concurrency, no multi-pane
  UI, best-effort first-turn tab binding).
- `host-access-config.json` and the console-capture content script are
  scoped to all sites, not just Apty's target applications.
- `debugger` permission + `<all_urls>` host permissions remain broad,
  inherent to what a browser-debugging tool needs — not fixed, flagged.
- No tenant isolation / audit logging / governance layer.
- **Investigation lifecycle correctness depends on the model following the
  system prompt** — nothing server-side forces `start_investigation`/
  `update_investigation`/`stop_investigation` to be called; a model that
  ignores those instructions leaves the UI showing stale/absent
  investigation state (though evidence/component-health still update
  independently, since those come from tool calls the model has to make
  anyway to answer the question).
- **The new side panel UI has not been manually verified in a running
  browser** — it passed build/typecheck/lint and unit/component tests this
  session, but clicking through a live investigation (start → evidence →
  diagnosis → verify → stop, iframe/Shadow-DOM selector cases, concurrent
  tab/conversation scenarios) against the actual extension has not been
  done. See `## Next Steps`.
- **No autonomous orchestration loop** — the investigation planner and
  status/timeline tools give the model decision-support data, but nothing
  external to the model's own tool-selection loop (`packages/core`'s
  agent loop, unchanged) plans/executes/observes/decides on its own. See
  `DECISIONS.md` for why this wasn't attempted this session.
- **Network capture (P1.6) is done for the network layer only** — the new
  `start_network_capture`/`stop_network_capture` session (this session)
  covers `get_network_diagnostics`'s gap; `get_runtime_diagnostics` (CSP/
  exception/log capture) still only has the original fixed window — the
  same 15s-heartbeat pattern would generalize to it if picked up next.
  **Console/runtime classification (P1.7) is done** — see
  `log-classification.ts` and the "Console/runtime event classification"
  writeup in `ARCHITECTURE.md`'s DevTools/CDP section.
- **`mcp-bridge/src/tool-schemas.ts`'s tool-schema gap is fixed this
  session** — all 8 `investigation.ts` tools, `analyze_element_selectors`,
  and the 3 new network-capture tools were added; see `## Browser Tools`.
  It remains hand-maintained (not generated from `tools/index.ts`), so
  the same class of drift can recur if a future tool addition forgets to
  update it.

## Important Technical Decisions

See `DECISIONS.md`.

## Last Commit

This session's commit adds investigation-aware network capture + the
`mcp-bridge/src/tool-schemas.ts` gap fix, code and doc updates folded into
one commit (not split) — run `git log -1` for its hash. Prior checkpoint:
`695360c` (merge of PR #10, "feat: classify console/runtime diagnostic
events into failure categories" + its doc-update commit `1278fe9`, on top
of `e7c98ff` — "docs: gap-audit against the engineering-automation master
prompt, record P0 work").

## Last Push

Pushed to `origin/claude/busy-fermat-xyu2po` (check `git log -1` /
`git status` — this note is updated by hand and can lag the actual push by
one commit within a session).

## NEXT SESSION HANDOFF

Read this file, `ARCHITECTURE.md`, `DECISIONS.md`, `SECURITY_AUDIT.md`, and
`CHANGELOG.md` first. Then `git log --oneline -10` and `git status`. A
12-page Confluence documentation package also exists — see
`## Confluence Documentation` above — and is a useful orientation read,
though this repo's own docs remain the source of truth if the two disagree.

**What's blocked and needs a human/Apty-side answer before continuing:**
- Apty Studio's actual extension ID (or confirmation Studio isn't a
  separate extension at all)
- Confirmation of (or a better alternative to) the proposed
  `window.__APTY_WIDGET__` / `window.__APTY_CLIENT__` contracts — these are
  this session's best-guess design, not confirmed with the Widget/Client
  teams
- Whether Apty will adopt `docs/apty-integration/apty-widget-service-worker.reference.ts`
  (or an HTTP-endpoint equivalent) for Service Worker diagnostics — the
  reference implementation is ready, but nothing on the Apty side has
  adopted it yet
- Apty's actual target application domains, to scope `host-access-config.json`
  and the console-bridge's content-script `matches` away from `<all_urls>`

**What's safe to continue without asking — in recommended order (see the
"Gap Matrix vs. the Engineering Automation Master Prompt" near the top of
this file for the fuller P0/P1/P2 picture):**
1. ~~Multi-session tab-binding~~, ~~deterministic evidence-correlation~~,
   ~~selector diagnostics~~, ~~investigation session lifecycle~~, ~~UI
   redesign~~, ~~unified two-extension component model~~, ~~investigation
   planner~~, ~~structured hypotheses~~, ~~server-enforced verification
   guard~~, ~~debugger-manager destructive-behavior fix~~, ~~console/
   runtime event classification~~, ~~investigation-aware network
   capture~~, ~~mcp-bridge tool-schema gap~~ (all done — see the relevant
   "(this session)"-tagged sections above for whichever session did each).
   Follow-ups if picked up next: precise first-turn tab binding;
   per-conversation `InterventionManager` mode once/if concurrent
   conversations within one window's UI become a thing.
2. **Manually verify the UI in a running browser** — load the built
   extension (`packages/browser-ext/dist`), open the side panel, and walk
   through: empty state → typing a debugging question → the investigation
   banner appearing → the Plan tab's checklist populating → evidence/
   component-health/diagnosis populating as tools run → Verify Diagnosis →
   Stop Investigation's confirm dialog. Also check the functional-bug-audit
   scenarios from the product brief (tab switch mid-conversation, restoring
   an old conversation, iframe/Shadow DOM selector cases, two conversations
   bound to two tabs, and the new start/stop network capture flow). No
   session so far has validated the UI beyond build/typecheck/tests.
3. **Extend the investigation-aware capture pattern to
   `get_runtime_diagnostics`** — the same session/heartbeat mechanics that
   now back network capture (`network-capture-session.ts`) would give
   console/runtime event capture the same start/reproduce/stop UX instead
   of its current fixed window.
4. **A Studio-vs-production comparison tool** (P1.8) — the planner's
   `studio-vs-production` category already has a "compare" step; no tool
   backs it yet beyond calling the existing individual diagnostics
   separately and reasoning about them unassisted.
5. **An external investigation orchestration loop** (P0.3) — this is the
   one item from the master prompt's own P0 list this session did NOT
   attempt; see `DECISIONS.md` for why it needs its own session. Read that
   entry before starting this — it explains what "orchestration" can
   safely mean here without restructuring `packages/core`'s agent loop.
6. Writing tests for `widget-diagnostics.ts`/`client-diagnostics.ts`/
   `studio-diagnostics.ts` using the same `global.chrome` mock pattern
   proven out in `service-worker-diagnostics.test.ts` and
   `devtools.test.ts`; a full CDP-mechanics test suite for `devtools.ts`
   and `tools/selector.ts` (their pure logic — `evidence-correlation.ts`,
   `selector-analysis.ts` — is already thoroughly tested; the CDP plumbing
   around them isn't). RTL/integration tests for
   `investigation-context-bar.tsx`/`investigation-summary-bar.tsx` would
   need a `useChatContext`+`chrome.tabs` test harness no session has built.
7. SE/SDE investigation depth modes (P2.12) and the scenario/evaluation
   suite (P2.17) — both meaningful but lower-priority than the P1 items
   above per the master prompt's own ordering.
8. An Options UI panel for `AptyIntegrationConfig`.
9. A dedicated "start investigation" form/component-picker — only if real
   usage shows natural-language intent detection isn't reliable enough on
   its own.
10. Continuing to remove/rename remaining internal "AIPex" identifiers, if
    a future session judges the churn worth it.
