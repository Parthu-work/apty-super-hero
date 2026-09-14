# Changelog

Meaningful changes to this repo, newest first. Not every commit is listed
individually where several form one logical change — see `git log` for the
full commit-level history.

## Unreleased (this session) — multi-session/multi-chat isolation

**Added**
- Per-conversation browser-tab binding: `ChatOptions.runContext`
  (`packages/core`) is forwarded by `AIPex.chat()` to `@openai/agents`'
  `run()` as its `context` option, reaching every tool's
  `execute(input, context)` as `context.context`. Diagnostic tools
  (`apty.ts`'s 5 tools, `devtools.ts`'s 2 tools) resolve their target tab
  via a new `resolveDiagnosticTab()` (`packages/browser-runtime/src/tools/tab-utils.ts`)
  that prefers this bound tab over the previous unconditional
  `getActiveTab()` call, so evidence stays scoped to the tab a
  conversation is actually about even if the user's focus moves
  elsewhere. The binding itself is a `Map<sessionId, tabId>`
  (`packages/browser-ext/src/lib/conversation-tab-binding.ts`), wired into
  the chat hook via a new `ChatConfig.getRunContext` callback so
  `aipex-react` stays runtime-agnostic.
- `ConversationData.agentSessionId` (`packages/browser-runtime`'s
  conversation storage) reconciles the two previously-unlinked
  conversation id spaces (the UI-level `ConversationData.id` and the
  `core.Session.id` that holds the actual LLM message history), and a new
  `useChat().bindSession()` / `ChatContextValue.bindSession` lets restoring
  a past conversation from history rebind the live agent session to match.
- Tests: `aipex.test.ts` (`runContext` → `run()` passthrough),
  `tab-utils.test.ts` + `apty.test.ts` (bound-tab resolution, including an
  end-to-end `.invoke()` call), `conversation-storage.test.ts`
  (`agentSessionId` persistence), `use-chat.test.ts` (`getRunContext` +
  `bindSession`), `conversation-tab-binding.test.ts` (the binding map,
  including a two-concurrent-sessions case).

**Fixed**
- A real cross-conversation contamination bug: restoring a past
  conversation from the history dropdown
  (`packages/browser-ext/src/lib/browser-chat-header.tsx`'s
  `handleConversationSelect`) updated the UI's message list but never
  rebound the active agent session, so the next message sent after
  restoring an old conversation could silently continue a *different*
  conversation's actual agent memory. Now rebinds via `bindSession()`
  using the newly-persisted `agentSessionId`.

See `PROJECT_PROGRESS.md`'s "Multi-Session Isolation — Implementation
Notes" and `ARCHITECTURE.md`'s "Conversation/tab binding" section for the
full writeup, including what's still a follow-up (best-effort first-turn
binding, no concurrent multi-pane UI within one window,
`InterventionManager`'s conversation mode not yet per-conversation).

## Previous session — engineering documentation package

**Added**
- A 12-page engineering documentation package published to Apty's
  Confluence space, rooted at
  ["Apty Live Browser Debugging Agent"](https://apty.atlassian.net/wiki/spaces/~712020ef582a34887949aa80daf20d290f4d9e/pages/1467679209)
  (page ID `1467679209`), grounded in this repository at commit `14693a9`.
  Covers product overview, architecture, the agent's debugging loop and
  evidence model, all four Apty integration points, Service Worker
  diagnostics (Option A vs B), chat/session architecture and its known
  gap, a full implementation inventory, a consolidated Apty engineering
  requirements ask, open questions for Apty engineering, security
  architecture, limitations with recommended sequencing, and an
  engineering handoff summary. Full page index in `PROJECT_PROGRESS.md`'s
  "Confluence Documentation" section. This was a documentation-only task —
  no application code was changed to produce it.

**Fixed**
- Corrected a pre-existing inaccuracy in `PROJECT_PROGRESS.md` and
  `ARCHITECTURE.md`: the tool-registry count was documented as 47 but is
  actually 41, verified directly against `allBrowserTools` in
  `packages/browser-runtime/src/tools/index.ts`. Also corrected a claim
  that bookmark/history tools are registered — their source files exist
  from the AIPex baseline but are not included in `allBrowserTools`.

## Previous session — Apty Service-Worker diagnostics hardening

**Added**
- `docs/apty-integration/apty-widget-service-worker.reference.ts` — a
  complete, adaptable reference implementation for the Apty Widget team's
  service-worker side of the Service Worker diagnostics integration: safe
  circular-safe log serialization, a bounded (1000-entry) buffer
  debounce-persisted to `chrome.storage.local` (survives MV3
  service-worker restarts), and a sender-validated `onMessageExternal`
  handler. Not part of this extension's build — hand-off documentation
  only, see `docs/apty-integration/README.md`.
- 16 new tests for `service-worker-diagnostics.ts` covering both the
  extension-messaging and HTTP-endpoint paths: success, timeout,
  `chrome.runtime.lastError`, malformed response, oversized response,
  redaction, and endpoint-preference-over-messaging.

**Fixed**
- `service-worker-diagnostics.ts` now validates every external response
  against a Zod schema before use (previously an unchecked `as` cast) and
  redacts log messages before returning them (previously not redacted at
  all, unlike the Widget/Client providers) — see `SECURITY_AUDIT.md`
  finding #4a.
- `get_apty_service_worker_diagnostics` now tags its result
  `scope: "shared-global"` with an explanatory note, so the agent doesn't
  falsely attribute a service-worker log (shared across every tab) to
  whichever tab is currently being investigated.

**Investigated, not implemented** (explicitly redirected mid-investigation
to the narrower Service Worker task above): full multi-session/multi-tab
diagnostic isolation. See `PROJECT_PROGRESS.md`'s "Multi-Session Isolation
— Research Notes" and `SECURITY_AUDIT.md` finding #1b for what was found —
in short, every diagnostic tool operates on whichever tab is currently
active rather than a conversation-bound tab, and the fix is to thread a
`context` object through `@openai/agents`' existing (currently unused)
`RunContext<Context>` mechanism.

**Tests**: 656 passing (was 640; +16 for `service-worker-diagnostics.ts`).

## Previous session — Apty diagnostics infrastructure

**Added**
- Evidence model and four Apty diagnostic provider interfaces
  (`packages/browser-runtime/src/apty/`): `AptyWidgetDiagnosticsProvider`,
  `AptyClientDiagnosticsProvider`, `AptyStudioDiagnosticsProvider`,
  `AptyServiceWorkerDiagnosticsProvider`, each with a `NotConfigured*`
  fallback — no fabricated Apty data.
- Sensitive-data redaction utility (`apty/redact.ts`, unit-tested) — strips
  `Authorization`/`Cookie`/`X-Api-Key` headers and inline
  `token=`/`password=`/`Bearer ...` patterns before data reaches the model.
- Two DevTools/CDP tools (`packages/browser-runtime/src/tools/devtools.ts`):
  `get_network_diagnostics` (correlated request/response/failure data) and
  `get_runtime_diagnostics` (browser-level log entries and uncaught
  exceptions) — both reuse the existing `debuggerManager`/`CdpCommander`.
- Three new Apty tools (`tools/apty.ts`): `get_apty_widget_diagnostics`,
  `get_apty_client_diagnostics`, `get_apty_studio_diagnostics`,
  `get_apty_service_worker_diagnostics` (4, plus the pre-existing
  `get_apty_page_logs`, renamed from `get_apty_debug_logs`).
- `packages/browser-ext/.env.example` with Apty integration config
  placeholders (Studio/Widget/Client/Service-Worker extension IDs,
  service-worker diagnostic endpoint) — wired through `background.ts` →
  `chrome.storage.local` → `apty/config.ts`.
- `PROJECT_PROGRESS.md`, `ARCHITECTURE.md`, `DECISIONS.md` (new),
  `SECURITY_AUDIT.md` and this `CHANGELOG.md` rewritten/updated to reflect
  actual implemented state.

**Changed**
- System prompt (`packages/aipex-react/src/components/chatbot/constants.ts`)
  rewritten from a generic "AIPex browser assistant" persona (tab/bookmark/
  history/shopping-style examples) to the Apty Live Browser Debugging Agent
  persona: the debugging loop, evidence-first CONFIRMED/LIKELY/POSSIBLE/
  UNKNOWN diagnosis format, explicit tool-boundary honesty, and an explicit
  prompt-injection defense instruction. Also fixed a latent type bug (was
  `string[]` assigned to a `string`-typed field; now a real joined string).
- Agent name: `"AIPex Browser Assistant"` → `"Apty Live Browser Debugging
  Agent"` (`browser-agent-config.ts`).
- `get_apty_debug_logs` renamed to `get_apty_page_logs`; now redacts log
  entries before returning them (previously did not).
- `mcp-bridge/src/tool-schemas.ts` updated to match the renamed/new tools.

**Tests**: 640 passing across all 5 packages (was 623; +7 for `redact.ts`,
+10 net from the tool-count increase not requiring new tests of their own
since they're thin Chrome-API wrappers — see `PROJECT_PROGRESS.md`'s "Not
Implemented" test section for why).

## Prior session

**Removed** (AIPex product features with no Apty relevance):
- Proxy/login auth mode routing through `claudechrome.com`
- Conversation sharing, user-manual replay-from-website, recording/
  screenshot upload to AIPex's backend, version checking against AIPex's
  release feed
- Voice input (ElevenLabs STT + VAD) and its `three.js` particle
  visualization — shrank the sidepanel bundle 724KB → 190KB
- AIPex's marketing/community UI (Discord/Twitter/WeChat links, buy-token
  prompts), non-English READMEs, AIPex's own release automation
  (`bump`/`release` GitHub workflows)

**Changed**:
- Rebranded manifest name/description, page titles, chat header default
  title, README as "Apty Agent"
- `externally_connectable` locked from `{"matches":
  ["http://localhost:*/*"]}` to `{"ids": []}` — see `SECURITY_AUDIT.md`
  finding #1

**Added**:
- `packages/browser-ext/src/apty-console-bridge.ts` — MAIN-world content
  script buffering console output/errors since page load
- Initial `get_apty_debug_logs` and `get_apty_widget_snapshot` tools (the
  latter later replaced by `get_apty_widget_diagnostics`, see Unreleased above)

## Initial import

- Cloned from [AIPexStudio/AIPex](https://github.com/AIPexStudio/AIPex)
  (MIT licensed) as the starting point.
