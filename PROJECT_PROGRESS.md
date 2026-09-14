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
| Investigation session lifecycle (start/collect/pause/stop/hypotheses/diagnosis) | Only the tab-binding map from the isolation work; no session object tracking hypotheses/evidence/diagnosis | No | Nothing tracks "this conversation's investigation state" as a first-class object | P1 | Not done this session — see Next Steps |
| Apty Widget/Client/Studio/Service-Worker providers | Honest `not_configured` stubs, Service Worker hardened+tested | Partial | Blocked on real Apty-side contracts | — | Blocked, not actionable from this repo alone |
| Network diagnostics (CDP) | Fixed 500ms–15s capture window | Partial | No "start capture → reproduce → stop → analyze" session UX; window is fixed at call time | P1 | Not done this session |
| Console/runtime event classification | Raw entries returned as-is (level, message, timestamp) | Partial | No classification into apty-error/CSP/CORS/JS-exception buckets | P2 | Not done this session |
| Selector/DOM iframe+Shadow DOM handling | `iframeManager`, DOM/CDP snapshot already handle frames; Shadow DOM traversal exists in the collector | Partial | New selector tool reports iframe/shadow-root context but doesn't yet special-case cross-origin iframe limits beyond what already existed | P2 | Partially covered by new selector tool; deeper work not done |
| Self-healing / stale-UID recovery | None — a stale UID throws and asks the model to re-snapshot | No | Manual recovery only (model calls `search_elements` again) | P2 | Not done this session |
| Tool surface cleanup | `bookmark.ts`/`history.ts`/`organize-tabs.ts`/clipboard tools exist as source but are already excluded from `allBrowserTools` (verified) | Mostly done | `mcp-bridge/src/tool-schemas.ts` has a naive tool-name count mismatch against the real registry that wasn't fully root-caused this session (some of it is nested-directory tools like `download_*`/`upload_file_to_input` that a quick glob missed, not necessarily real bugs) | P2 | Needs a careful, dedicated audit pass — flagged, not done this session to avoid a rushed/wrong fix |
| UI: investigation state banner, evidence panel, timeline, diagnosis card | None — the side panel is still a generic chat UI (message list + input), no dedicated debugging-console UI | No | Large, multi-component UI effort | P1 | Not done this session — see Next Steps |
| Agent activity UX (friendly tool-call descriptions vs raw tool names) | Raw tool names/params shown via `tool_call_start`/`tool_call_complete` events, rendered as-is in the default message UI | No | No mapping layer from tool name → friendly description | P2 | Not done this session |
| AIPex branding/UI debt removal | System prompt and agent name already rebranded (prior sessions); internal package names/storage keys deliberately kept (see `DECISIONS.md`) | Partial (by design) | Deliberate scope decision, not an oversight | P3 | No action — see `DECISIONS.md` |
| Security: `host-access-config.json` / console-bridge domain scoping | Still `include-all` / `<all_urls>` | No | Needs Apty's actual target domain list | P1 | Blocked on Apty-side input, not actionable from this repo alone |
| Security: multi-session diagnostic isolation | Implemented (prior work this session cycle) | Yes | — | — | Done — `SECURITY_AUDIT.md` finding 1b updated to Fixed |
| Target domain configuration mechanism | None — no dev/staging/prod/customer-domain config surface | No | Would need Apty's domain list to be useful; building the mechanism without real domains is guessing | P2 | Not done — needs Apty input first |

Priorities: P0 = blocks core product, P1 = required for useful product, P2 =
important improvement, P3 = cleanup/future.

## Current Status

Early implementation. The repo has been rebranded, stripped of AIPex's
consumer-product features, and given a first layer of Apty-specific
diagnostics (evidence model, provider interfaces, DevTools/CDP tools, a
debugging-focused system prompt). The Apty Service Worker diagnostics path
now has a hardened, tested consumer implementation plus a complete
producer-side reference implementation for the Apty Widget team
(`docs/apty-integration/`). No real Apty Studio/Widget/Client/Service
Worker integration is *live* yet — that requires the Apty-side halves
(a real extension ID, a real global, a real message handler), which this
session cannot build since it doesn't have access to those codebases.

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

Phase 2 of the informal roadmap below:
1. ~~Strip AIPex product features, rebrand~~ (done, prior session)
2. **Build Apty diagnostic infrastructure: evidence model, provider
   interfaces, DevTools tools, debugging persona** (done, prior session in
   this phase) **+ harden the Service Worker diagnostics path specifically
   (validation, redaction, tests, producer reference impl)** (this session)
3. Wire real Apty Studio/Widget/Client integration once extension IDs and
   contracts are available (not started — needs Apty-side input)
4. ~~Multi-session/multi-chat isolation~~ (implemented) ~~+ deterministic
   evidence correlation~~ (implemented) ~~+ selector diagnostics~~
   (implemented, all this session — see "Multi-Session Isolation",
   "Evidence Correlation & Investigation Timeline", and "Selector
   Diagnostics" below); recovery/retry behavior; verification loops;
   investigation-session lifecycle object (not started)
5. ~~Publish a complete engineering documentation package to Confluence~~
   (done, prior session — see `## Confluence Documentation` below;
   explicitly a documentation-only task, no code changes)

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

## Completed

- Evidence model + 4 provider interfaces with honest `not_configured`/
  `unavailable` states (no fabricated Apty data anywhere).
- Redaction utility, unit-tested, applied to all log-bearing tools.
- DevTools CDP tools for network and runtime diagnostics, reusing the
  existing `debuggerManager`/`CdpCommander` infrastructure.
- Config plumbing: `.env.example` → Vite env → `chrome.storage.local` →
  tool-call-time config read.
- System prompt rewritten for the debugging persona.
- All 5 packages build, typecheck, and pass their test suites (623 tests
  as of the prior session's checkpoint; see `## Tests` below for this
  session's numbers).

## Currently Working On

Documentation for this checkpoint (`PROJECT_PROGRESS.md`, `ARCHITECTURE.md`,
`SECURITY_AUDIT.md`, `CHANGELOG.md`, `DECISIONS.md`) and the commit/push
sequence.

## Next Steps

In priority order:
1. **Get real Apty-side integration info**: the Widget/Client global
   contract (or confirm the proposed `window.__APTY_WIDGET__`/
   `__APTY_CLIENT__` shape with those teams), and Studio's actual extension
   ID + willingness to implement `externally_connectable` + a message
   handler. This is genuinely blocked without Apty engineering input — see
   `## NEXT SESSION HANDOFF`.
2. **Scope `host-access-config.json`** (`packages/browser-ext/host-access-config.json`,
   currently `"mode": "include-all"`) to Apty's actual target application
   domains once those are known, rather than every site the user visits.
3. **Scope the console-capture content script** (`apty-console-bridge.ts`,
   currently `<all_urls>`) the same way, for the same privacy reason.
4. ~~Add an evidence-correlation self-check~~ — done this session, see
   "Evidence Correlation & Investigation Timeline" above
   (`get_investigation_timeline`/`evidence-correlation.ts`).
5. **Investigation session lifecycle object**: an explicit
   `InvestigationSession` tracking hypotheses, verification attempts, and
   a final diagnosis+confidence as first-class state — the evidence store
   this session added is the data layer it would sit on top of, but the
   session object itself (start/pause/stop/verify lifecycle) doesn't
   exist yet.
6. **UI: investigation state banner, evidence panel, timeline, diagnosis
   card** — the side panel is still a generic chat UI; none of the
   product spec's dedicated debugging-console UI exists yet. The data it
   would render (correlated evidence, verdicts) now exists via
   `get_investigation_timeline` and `analyze_element_selectors` — the UI
   layer to surface it doesn't.
7. **Options UI for Apty integration config**: today, `studioExtensionId`
   etc. are only settable via `.env` (build time) or directly writing to
   `chrome.storage.local` (`setAptyIntegrationConfig`). A small settings
   panel would make this actually usable day-to-day.
8. **Network diagnostics: start/stop capture session UX** — currently a
   fixed 500ms–15s window chosen per call; a "start capture → user
   reproduces → stop → analyze" flow (per the product spec) would be more
   usable but requires new session-lifecycle state, not just a tool tweak.
9. Continue trimming internal "AIPex" naming (package names, class names,
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

44 tools registered in `packages/browser-runtime/src/tools/index.ts`:
tabs (7), UI operations/element interaction (8), page content (4),
screenshots (3), downloads (2), interventions (4), skills (6), DevTools (2),
Apty integration (5), investigation timeline (2, new this session),
selector diagnostics (1, new this session). See that file for the
authoritative, categorized list. (`bookmark.ts`, `history.ts` and
`organize-tabs.ts` exist as source files but are not registered in
`allBrowserTools`.)

## DevTools

`get_network_diagnostics` and `get_runtime_diagnostics`
(`packages/browser-runtime/src/tools/devtools.ts`) — both reuse the
existing `debuggerManager`/`CdpCommander` attach/detach lifecycle. Bounded
capture windows (500ms–15s, default 3s); cannot see anything before the
window opens — this is a hard CDP limitation, not a shortcut taken here.

## MCP

Unchanged architecture from AIPex: `mcp-bridge/` is a standalone Node
package (own `package.json`, not part of the pnpm workspace) exposing a
WebSocket daemon (`ws://127.0.0.1:9223` by default) that the extension
connects to as a client. Origin-header validation rejects all http/https
page origins (prevents cross-site WebSocket hijacking); Node clients
without an Origin header, and `chrome-extension://`/`moz-extension://`
origins, are allowed. `mcp-bridge/src/tool-schemas.ts` was updated to match
the new/renamed Apty and DevTools tools.

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
- `packages/browser-runtime`: 232 tests (179 prior + 17 for
  `evidence-correlation.ts` + 8 for `evidence-store.ts` + 29 for
  `selector-analysis.ts` + 3 for `investigation.ts`'s tools + 1 more for
  `apty.ts`'s evidence recording + 2 for `devtools.ts`'s evidence recording — this session)
- `packages/aipex-react`: 114 tests (10 pre-existing skips, unrelated to this work)
- `packages/browser-ext`: 36 tests
- **Total: 731 passing**, all packages build and typecheck clean
  (`pnpm build` also verified end-to-end this session).

### Failing
None known.

### Not Implemented
No tests exist yet for `widget-diagnostics.ts`, `client-diagnostics.ts`, or
`studio-diagnostics.ts` (`service-worker-diagnostics.ts` has 16,
`devtools.ts` now has 2 covering its new evidence-recording behavior
specifically, not its full CDP mechanics). The remaining untested provider
files are thinner wrappers around `chrome.scripting.executeScript`
specifically (vs. `service-worker-diagnostics.ts`'s
`chrome.runtime.sendMessage`/`fetch`, which mock cleanly) — extending the
same mocking approach to them is straightforward and a reasonable next
increment, not a blocked task. `tools/selector.ts`'s CDP mechanics (as
opposed to the pure ranking engine it calls, which has 29 tests) and a
full `devtools.ts` CDP-mechanics test suite are both in the same category —
see `smart-locator.test.ts`'s `CdpCommander`/`debugger-manager` mocking
pattern, now also used by `devtools.test.ts`, as the template. Manual/
integration testing against a real Apty deployment is still the real
end-to-end validation path once the Apty-side contracts exist.

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
- Evidence correlation is entirely LLM-driven (via system-prompt
  instructions), not a deterministic pre-pass.
- `host-access-config.json` and the console-capture content script are
  scoped to all sites, not just Apty's target applications.
- `debugger` permission + `<all_urls>` host permissions remain broad,
  inherent to what a browser-debugging tool needs — not fixed, flagged.
- No tenant isolation / audit logging / governance layer.

## Important Technical Decisions

See `DECISIONS.md`.

## Last Commit

`a9764f2b9458874fee9504fa6a42d290bbc6e8c4` — "feat: deterministic evidence
correlation, investigation timeline, and selector diagnostics" (a
documentation-update commit follows this one). Prior commits:
`d332683` — "Implement multi-session/multi-chat diagnostic isolation";
`e4a4a4f` — "docs: publish Confluence engineering documentation package;
fix stale tool count".

## Last Push

Will be pushed to `origin/main` at the head of this session's commits
(check `git log -1` / `git status` — this note is updated by hand and can
lag the actual push by one commit within a session).

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

**What's safe to continue without asking — in recommended order:**
1. ~~Multi-session tab-binding~~, ~~deterministic evidence-correlation~~,
   ~~selector diagnostics~~ (all done — see "Multi-Session Isolation",
   "Evidence Correlation & Investigation Timeline", and "Selector
   Diagnostics" above). Follow-ups if picked up next: precise first-turn
   tab binding; per-conversation `InterventionManager` mode once/if
   concurrent conversations within one window's UI become a thing.
2. **Investigation session lifecycle**: wrap the evidence store
   (`apty/evidence-store.ts`) in an explicit session object tracking
   hypotheses, verification attempts, and a final diagnosis+confidence —
   the gap matrix's remaining P1 item in this cluster.
3. **UI**: a dedicated debugging-console side panel (investigation state,
   evidence panel, correlated timeline, diagnosis card) instead of the
   current generic chat UI — the underlying data now exists
   (`get_investigation_timeline`, `analyze_element_selectors`), the UI to
   render it doesn't.
4. Writing tests for `widget-diagnostics.ts`/`client-diagnostics.ts`/
   `studio-diagnostics.ts` using the same `global.chrome` mock pattern
   proven out in `service-worker-diagnostics.test.ts` and
   `devtools.test.ts`; a full CDP-mechanics test suite for `devtools.ts`
   and `tools/selector.ts` (their pure logic — `evidence-correlation.ts`,
   `selector-analysis.ts` — is already thoroughly tested; the CDP plumbing
   around them isn't).
5. An Options UI panel for `AptyIntegrationConfig`
6. Network diagnostics start/stop capture session UX (see gap matrix)
7. Continuing to remove/rename remaining internal "AIPex" identifiers, if a
   future session judges the churn worth it
