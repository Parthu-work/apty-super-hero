# Apty Browser Debugging Agent

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

**Not done this round, flagged explicitly**: a prior instruction in this
session asked for a full multi-session/multi-chat isolation architecture
(concurrent debugging conversations bound to different tabs, with
diagnostic evidence never leaking between them). That work was started
(investigation only — see "Multi-Session Isolation — Research Notes"
below) and then explicitly superseded by a narrower, more urgent
instruction to focus on Service Worker diagnostics instead. The session
architecture work is genuinely not built yet; don't assume it exists.

**This session (documentation-only, no code changes)**: a complete
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
4. Multi-session/multi-chat isolation (investigated, not implemented — see
   below); evidence correlation quality; recovery/retry behavior;
   verification loops (not started)
5. ~~Publish a complete engineering documentation package to Confluence~~
   (done, this session — see `## Confluence Documentation` below;
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

Total tool count: 41, as verified against `allBrowserTools` in
`packages/browser-runtime/src/tools/index.ts` (a prior estimate of 47 in
this file was not checked against the registry and has been corrected).

- `packages/browser-ext/src/apty-console-bridge.ts` (prior session): a
  MAIN-world content script that buffers console output/errors on every
  page since load — this is what `get_apty_page_logs` reads.

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
4. **Add an evidence-correlation self-check**: right now correlation is
   entirely the LLM's responsibility, guided by the system prompt's format
   requirements. A deterministic pre-pass (e.g. flag network errors whose
   timestamp is within N ms of a console error) would make correlation more
   reliable and is a reasonable next increment — marked FUTURE, not done.
5. **Options UI for Apty integration config**: today, `studioExtensionId`
   etc. are only settable via `.env` (build time) or directly writing to
   `chrome.storage.local` (`setAptyIntegrationConfig`). A small settings
   panel would make this actually usable day-to-day.
6. Continue trimming internal "AIPex" naming (package names, class names,
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

41 tools registered in `packages/browser-runtime/src/tools/index.ts`:
tabs (7), UI operations/element interaction (8), page content (4),
screenshots (3), downloads (2), interventions (4), skills (6), DevTools (2,
new), Apty integration (5, 2 carried over + 3 new). See that file for the
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
- `packages/core`: 215 tests
- `packages/dom-snapshot`: 132 tests
- `packages/browser-runtime`: 167 tests (144 original + 7 for `redact.ts` +
  16 new for `service-worker-diagnostics.ts`)
- `packages/aipex-react`: 112 tests (10 pre-existing skips, unrelated to this work)
- `packages/browser-ext`: 30 tests
- **Total: 656 passing**, all packages build and typecheck clean.

### Failing
None known.

### Not Implemented
No tests exist yet for `widget-diagnostics.ts`, `client-diagnostics.ts`,
`studio-diagnostics.ts`, or `devtools.ts` (service-worker-diagnostics.ts
now has 16, added this session, using a `global.chrome = {...}` mock
matching the pattern already used elsewhere in this repo, e.g.
`fake-mouse.test.ts`). The remaining untested files are thinner wrappers
around `chrome.scripting.executeScript`/`chrome.debugger` specifically
(vs. `service-worker-diagnostics.ts`'s `chrome.runtime.sendMessage`/`fetch`,
which mock cleanly) — extending the same mocking approach to them is
straightforward and a reasonable next increment, not a blocked task.
Manual/integration testing against a real Apty deployment is still the
real end-to-end validation path once the Apty-side contracts exist.

## Multi-Session Isolation — Research Notes (investigated, NOT implemented)

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
- **No multi-session/multi-tab diagnostic isolation** — see "Multi-Session
  Isolation — Research Notes" above. All diagnostic tools currently
  operate on "whichever tab is active right now" rather than a
  conversation-bound tab; this is a real gap, not yet fixed.
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

(Filled in at push time — see `git log -1` for the current value.)

## Last Push

(Filled in at push time.)

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
1. **Multi-session tab-binding** (highest priority, real correctness gap
   found this session, not yet fixed): implement `RunContext` threading as
   described in "Multi-Session Isolation — Research Notes" above. Start
   there, not with a new session-manager class — the existing `Session`/
   conversation-storage layer likely already covers chat-state isolation.
2. Writing tests for `widget-diagnostics.ts`/`client-diagnostics.ts`/
   `studio-diagnostics.ts`/`devtools.ts` using the same `global.chrome`
   mock pattern now proven out in `service-worker-diagnostics.test.ts`
3. Building the deterministic evidence-correlation pre-pass
4. An Options UI panel for `AptyIntegrationConfig`
5. Continuing to remove/rename remaining internal "AIPex" identifiers, if a
   future session judges the churn worth it
