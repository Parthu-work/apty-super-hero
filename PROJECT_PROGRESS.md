# Apty Browser Debugging Agent

## Current Status

Early implementation. The repo has been rebranded, stripped of AIPex's
consumer-product features, and given a first layer of Apty-specific
diagnostics (evidence model, provider interfaces, DevTools/CDP tools, a
debugging-focused system prompt). No real Apty Studio/Widget/Client/Service
Worker integration exists yet — that requires coordination with those
codebases, which this session does not have access to.

## Current Phase

Phase 2 of the informal roadmap below:
1. ~~Strip AIPex product features, rebrand~~ (done, prior session)
2. **Build Apty diagnostic infrastructure: evidence model, provider
   interfaces, DevTools tools, debugging persona** (this session)
3. Wire real Apty Studio/Widget/Client integration once extension IDs and
   contracts are available (not started — needs Apty-side input)
4. Evidence correlation quality, recovery/retry behavior, verification loops
   (not started)

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
- 47 existing browser/tab/DOM/screenshot/skill tools in the tool registry

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

Total tool count: 47 (up from AIPex's original ~40; net new: 2 devtools + 3
new apty tools beyond the 2 that existed from the prior session).

- `packages/browser-ext/src/apty-console-bridge.ts` (prior session): a
  MAIN-world content script that buffers console output/errors on every
  page since load — this is what `get_apty_page_logs` reads.

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

Status: **Not implemented — requires Apty-side work.**
Implementation: `service-worker-diagnostics.ts`
(`ConfiguredServiceWorkerDiagnosticsProvider`) — supports either
cross-extension messaging (same pattern as Studio) or an HTTP diagnostic
endpoint (`GET <endpoint>/status`, `GET <endpoint>/logs`).
Configuration: `VITE_APTY_SERVICE_WORKER_EXTENSION_ID` or
`VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT` (configure at most one).
Remaining: Chrome fundamentally does not allow one extension to read
another's private service-worker memory — Apty must expose one of the two
channels above. Neither exists today.

## Browser Tools

47 tools registered in `packages/browser-runtime/src/tools/index.ts`:
tabs (7), UI operations/element interaction (8), page content (4),
screenshots (3), downloads (2), interventions (4), skills (6), DevTools (2,
new), Apty integration (5, 2 carried over + 3 new). See that file for the
authoritative, categorized list.

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
- `packages/browser-runtime`: 151 tests (144 inherited + 7 new for `redact.ts`)
- `packages/aipex-react`: 112 tests (10 pre-existing skips, unrelated to this work)
- `packages/browser-ext`: 30 tests
- **Total: 640 passing**, all packages build and typecheck clean.

### Failing
None known.

### Not Implemented
No tests exist yet for `widget-diagnostics.ts`, `client-diagnostics.ts`,
`studio-diagnostics.ts`, `service-worker-diagnostics.ts`, or `devtools.ts` —
they're thin wrappers around `chrome.scripting.executeScript`/
`chrome.debugger`/`chrome.runtime.sendMessage`, which are hard to unit test
meaningfully without a real browser or a much more elaborate Chrome API
mock than exists in this repo today. Manual/integration testing against a
real Apty deployment is the real validation path once the Apty-side
contracts exist.

## Known Limitations

- No real Apty Widget/Client/Studio/Service-Worker integration — every
  Apty-specific tool currently reports `not_configured`/`unavailable`
  against a real deployment until Apty-side work happens.
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
`CHANGELOG.md` first. Then `git log --oneline -10` and `git status`.

**What's blocked and needs a human/Apty-side answer before continuing:**
- Apty Studio's actual extension ID (or confirmation Studio isn't a
  separate extension at all)
- Confirmation of (or a better alternative to) the proposed
  `window.__APTY_WIDGET__` / `window.__APTY_CLIENT__` contracts — these are
  this session's best-guess design, not confirmed with the Widget/Client
  teams
- Whether Apty has (or is willing to build) a service-worker diagnostic
  endpoint or messaging channel at all
- Apty's actual target application domains, to scope `host-access-config.json`
  and the console-bridge's content-script `matches` away from `<all_urls>`

**What's safe to continue without asking:**
- Adding more DevTools-based diagnostics (e.g. `Page.captureScreenshot`
  correlation with DOM state, performance timing)
- Building the deterministic evidence-correlation pre-pass
- Writing tests for the new `apty/*` provider classes using a Chrome API
  mock (would need one to be built first — none exists in this repo)
- An Options UI panel for `AptyIntegrationConfig`
- Continuing to remove/rename remaining internal "AIPex" identifiers, if a
  future session judges the churn worth it
