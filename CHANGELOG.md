# Changelog

Meaningful changes to this repo, newest first. Not every commit is listed
individually where several form one logical change — see `git log` for the
full commit-level history.

## Unreleased (this session) — Apty Client resource inspection: fixed the transport, verified against real Chrome

**Fixed — critical, verified against a real Chrome build, not just mocks**
- The Apty Client Service Worker network inspection feature below (V1) was
  built and unit-tested entirely against a mocked `chrome.debugger` API that
  always succeeded. Built a real two-extension Chromium test harness this
  session (Puppeteer + the pre-installed Chromium, not part of the repo) and
  found that `chrome.debugger.attach({targetId: <another extension's
  Service Worker>})` unconditionally fails in real Chrome with "Cannot
  access a chrome-extension:// URL of different extension" — a hard
  security boundary with no permission/flag workaround, confirmed by a
  sanity check that the identical API call against a plain tab in the same
  harness succeeds immediately. This means the entire V1 design below could
  never have retrieved a real Apty Client resource in production.
  `resolveServiceWorkerTarget`'s target-type filter had a second, smaller
  real-Chrome-only bug on top of that: `chrome.debugger.getTargets()`
  reports an MV3 service worker as `type: "worker"`, not
  `"service_worker"`, in this Chrome build.
- **Rearchitected the transport to cross-extension messaging**
  (`chrome.runtime.sendMessage(extensionId, ...)`) — the only mechanism
  Chrome actually allows for one extension to ask another for data. This
  requires the Apty Client to cooperate (allowlist this extension under
  `externally_connectable`, implement the `apty-debug-agent:*` message
  contract) — the same honest-stub pattern `service-worker-diagnostics.ts`
  already used for status/logs; extended that provider with
  `listResources()`/`getResourceBody()` (new `apty-debug-agent:list-observed-resources`
  / `apty-debug-agent:get-resource-body` message types) instead of building
  a second messaging mechanism, and rewired
  `extension-network-inspector.ts`'s public API (`connectExtensionClient`,
  `inspectResource`, `listObservedResources`, `listServiceWorkerLogs`) to
  use it, keeping the pure matching/redaction/evidence logic
  (`matchResources`, MIME/redaction handling) unchanged. All chrome.debugger
  session/cleanup-listener code for this feature was removed — there is no
  persistent session with a stateless messaging transport.
- Re-verified the corrected design against the same real two-extension
  Chromium harness: connect → list resources → retrieve the actual
  `segments.json` body (real content, not fabricated) → generic fragment
  match (`"segment"`) also resolves it → honest `not_observed` for a
  resource never requested → real Service Worker logs retrieved. All
  passed.
- Also fixed: Groq's model list included `mixtral-8x7b-32768`, which Groq
  has decommissioned — replaced with the current `openai/gpt-oss-20b` /
  `openai/gpt-oss-120b`, added `get_extension_service_worker_logs` (task
  item: Service Worker log capability), surfaced sanitized real connection-test
  errors instead of a generic "Connection failed" (`describeConnectionTestError`
  in `browser-ext/src/lib/ai-provider.ts`), renamed the manifest's
  `open-aipex` command to `open-apty-agent` and fixed remaining user-visible
  "AIPex" text in the MCP bridge panel.

## Unreleased (earlier session) — Apty Client extension Service Worker network inspection (V1)

**Added**
- Resource-agnostic Apty Client Service Worker Network inspection — the
  first end-to-end proof that the agent can retrieve real Apty Client
  runtime data from the browser
  (`packages/browser-runtime/src/apty/extension-network-inspector.ts`).
  Given an Apty Client Chrome extension ID, resolves its active Service
  Worker debugger target (`chrome.debugger.getTargets()` filtered to
  `type: "service_worker"` under that extension's origin), attaches via
  `chrome.debugger`'s `{ targetId }` debuggee (not `{ tabId }` —
  `cdp-commander.ts`/`debugger-manager.ts` are tab-only, so this module
  talks to `chrome.debugger` directly for the small set of target-scoped
  attach/sendCommand/detach operations it needs), enables `Network`, and
  accumulates requests per-conversation (bounded at
  `MAX_CAPTURED_RESOURCES = 1000`, oldest evicted first) exactly like
  `network-capture-session.ts` does for tabs.
  - No resource name is ever hardcoded. `matchResources()` ranks an exact
    filename match over a path/URL suffix match over a substring
    fragment match, most-recent-first on ties — the model decides *what*
    it's looking for (`segments.json`, `app.json`, `flow.json`, a natural-
    language description it turns into a query), the browser runtime
    deterministically decides *which observed request* matches.
  - `inspectResource()` retrieves the actual body via
    `Network.getResponseBody`, decodes base64/UTF-8 only for textual
    MIME types (binary bodies are reported, never decoded/dumped),
    redacts it with the existing `redactSensitiveText()`, and records it
    as `DiagnosticEvidence` (`source: "service-worker"`, `type:
    "network-response"`, `scope: "shared"`) — the full redacted body
    lives in evidence even when the tool's own response is a preview
    (capped at `MAX_INLINE_BODY_CHARS = 8000`).
  - Every failure mode is explicit, never fabricated: `not_connected`,
    `not_observed` (capture is not retroactive — traffic before
    connecting is invisible), `failed`, `http_error`, `pending`, and
    `body_unavailable` each return a structured, human-readable reason
    instead of inventing a response.
  - Forced cleanup mirrors `network-capture-session.ts`: lazily-registered
    `chrome.debugger.onDetach` / `chrome.management.onUninstalled` /
    `onDisabled` listeners tear down a conversation's session (listener +
    map entry) if the Service Worker detaches or the extension goes away
    outside an explicit `disconnect_apty_client` call.
  - 5 new tools (`packages/browser-runtime/src/tools/extension-network.ts`,
    registered in `tools/index.ts`: 54 → 59) and matching schemas added to
    `mcp-bridge/src/tool-schemas.ts`: `connect_apty_client` (idempotent;
    falls back to the configured `clientExtensionId`, see `apty/config.ts`),
    `disconnect_apty_client`, `get_apty_client_connection_status`,
    `inspect_extension_network` (auto-connects if needed — the primary
    "Get segments.json" chat flow doesn't require a separate connect
    step), and `list_extension_network_resources` (answers "what
    resources did the Apty Client load?").
  - Options UI: a new "Apty Client Extension" panel
    (`packages/browser-ext/src/pages/options/apty-client-panel.tsx`,
    wired into the existing "connection" tab alongside the MCP bridge
    panel) lets the user configure the extension ID once via
    `setAptyIntegrationConfig` — the panel itself only persists the ID and
    validates it resolves to a real, enabled extension via
    `chrome.management.get` (callable from any extension page); the
    actual debugger attach/capture happens lazily in whichever context
    runs the chat tools, per `AptyIntegrationConfig`'s existing
    lazy-read-at-call-time pattern. Addresses
    `PROJECT_PROGRESS.md`'s previously-open "Options UI panel for
    `AptyIntegrationConfig`" item.
- 36 new tests (`extension-network-inspector.test.ts`): extension ID
  validation, Service Worker target resolution (invalid id/extension not
  found/disabled/no matching target), connect/disconnect lifecycle
  (idempotent reconnect, switching extensions, attach failure, forced
  cleanup on external detach/uninstall), resource matching (exact/path/
  fragment, deterministic tie-breaking, no false positives), and
  `inspectResource` across every status (`ok` for two different resource
  names with no code change between them, `not_observed`, `failed`,
  `http_error`, `pending`, `body_unavailable`, redaction, binary bodies
  not decoded).

**Deliberately not done (out of scope for this milestone, per the
resource-agnostic-retrieval product brief)**: no fake
`window.__APTY_CLIENT__`-style contract, no RAG, no new evidence/
investigation architecture (reuses `evidence-store.ts`/`redact.ts`
as-is), no attempt at a mass AIPex→Apty internal-package rename (see
`PROJECT_PROGRESS.md` item 10 — still judged not worth the churn/
regression risk this session; the user-facing product surface already
says "Apty Live Debugging" throughout, per `browser-chat-header.tsx`/
`debugging-welcome-screen.tsx` from earlier sessions).

## Unreleased (previous session) — investigation-aware network capture session

**Added**
- Investigation-aware network capture
  (`packages/browser-runtime/src/apty/network-capture-session.ts`):
  closes the P1.6 gap fresh, directly on `main` — a corrected
  reimplementation of what PR #11 ("Add investigation-aware network
  capture session") attempted, fixing both defects that review found (see
  "Reviewed" below). Per-conversation (`Map<conversationId,
  ActiveCapture>`) session: `startNetworkCapture(conversationId, tabId)`
  attaches the debugger and accumulates requests in the background
  without blocking; `stopNetworkCapture(conversationId, {onlyErrors?})`
  detaches and returns everything captured, recording failed/4xx/5xx
  requests as evidence tagged with the conversation's active
  investigation id as `correlationId`; `getNetworkCaptureStatus(conversationId)`
  checks progress without stopping. A 15s heartbeat re-calls
  `debuggerManager.safeAttachDebugger()` (a no-op beyond resetting its own
  30s idle-auto-detach timer on an already-attached tab) so a capture can
  outlive that window. All headers redacted via the existing
  `redactHeaders()`.
  - **Fix #1 (the leak PR #11 had)**: registers `chrome.tabs.onRemoved`/
    `chrome.debugger.onDetach` listeners once, lazily, at module load
    (mirroring `debugger-manager.ts`'s own one-time `initialize()`
    pattern) that call `forceCleanupForTab()` — clears the heartbeat
    interval, removes the `chrome.debugger.onEvent` listener, deletes the
    conversation's map entry, and records any already-captured
    failed/4xx/5xx requests as evidence before discarding state, all
    without attempting further CDP calls. Exported for tests as
    `__simulateForcedCleanupForTab`.
  - **Fix #2 (the unbounded map PR #11 had)**: added
    `MAX_CAPTURED_REQUESTS = 2000` (exported), oldest-evicted-first when
    exceeded, mirroring `evidence-store.ts`'s 500-per-conversation cap
    pattern. The session/status object now carries a `truncated: boolean`
    field so callers know when the cap was hit and the returned set is
    incomplete.
  - The 3 new tool wrappers (`packages/browser-runtime/src/tools/network-capture.ts`:
    `start_network_capture`, `stop_network_capture` with an `onlyErrors`
    param, `get_network_capture_status`) call `recordToolCall()`
    (`investigation-orchestrator.ts`) so network-capture calls count
    toward the orchestrator's tool-call budget/loop-detection ledger — PR
    #11 predated the orchestrator and didn't have this.
  - Registered in `tools/index.ts` (tool registry: 51 → 54 tools);
    schemas added to `mcp-bridge/src/tool-schemas.ts` (also now 54,
    matching browser-runtime).
- 17 new tests: `network-capture-session.test.ts` (13 — including firing a
  simulated `chrome.tabs.onRemoved` mid-capture and asserting the
  heartbeat stops and the conversation can start a new capture
  afterward; firing a simulated `chrome.debugger.onDetach` and asserting
  already-captured failures are still recorded as evidence; and a
  cap-eviction test firing 2001 synthetic requests and asserting the
  oldest is evicted and `truncated` becomes `true`), plus
  `tools/network-capture.test.ts` (4).

**Note**
- This supersedes PR #11 (branch `claude/busy-fermat-xyu2po`), which
  remains open/unmerged and should not be merged — `main` now has a
  corrected implementation. See `DECISIONS.md` for why this was
  implemented fresh on `main` rather than by pushing fixes onto that
  branch.

Verified: `npm run preflight` (format, lint, typecheck, test) and
`npm run build` pass clean across the workspace; `mcp-bridge` builds and
typechecks clean separately. Test totals: `browser-runtime` 331 (was
314), workspace total 851 (was 834).

## Unreleased (this session) — autonomous investigation orchestrator, MCP bridge tool-registry fix

**Added**
- P0 autonomous investigation orchestrator
  (`packages/browser-runtime/src/apty/investigation-orchestrator.ts`):
  closes the gap the previous session's own gap matrix flagged as
  NOT_IMPLEMENTED (P0.3) — `investigation-planner.ts` only produced a
  static advisory checklist the model was free to ignore, with nothing
  tracking which diagnostic tools had actually run or enforcing any
  budget/loop limit. `recordToolCall(conversationId, tool, args)` is a
  per-conversation tool-call ledger (200-entry cap), called as a side
  effect from every diagnostic tool, mirroring the existing
  `recordEvidence` pattern. `getBudgetStatus()` computes a 25-tool-call /
  15-minute-wall-clock budget plus duplicate-call (loop) detection (same
  tool+an order-independent argument signature called ≥3 times).
  `decideNextAction(session, evidence)` deterministically returns exactly
  one of `call_tool` (next unattempted plan-step tool), `verify` (a
  `"supported"` hypothesis awaiting verification), `analyze` (evidence/
  open hypotheses need reasoning, not more tools), or `stop` (reason:
  `confirmed` / `loop_detected` / `budget_exceeded` / `blocked` /
  `evidence_exhausted`) — guardrails always take precedence over plan
  progression. Exposed to the model via a new
  `get_next_investigation_action` tool (`tools/investigation.ts`;
  investigation tools now number 9, up from 8). Instrumented all 8
  existing diagnostic tools to call `recordToolCall`: `get_apty_page_logs`,
  `get_apty_widget_diagnostics`, `get_apty_client_diagnostics`,
  `get_apty_studio_diagnostics`, `get_apty_service_worker_diagnostics`
  (`tools/apty.ts`), `get_network_diagnostics`, `get_runtime_diagnostics`
  (`tools/devtools.ts`), and `analyze_element_selectors`
  (`tools/selector.ts`, which also gained a `context` parameter on its
  `execute` it previously lacked). This is a "recommend + guardrail"
  layer the model consults each turn, not a standalone execution engine —
  see `DECISIONS.md` for why, given this codebase's actual LLM-driven
  one-call-at-a-time tool execution via `@openai/agents`.
- 18 new/expanded tests: `investigation-orchestrator.test.ts` (16, new,
  covering ledger capping, order-independent loop signatures, every
  `decideNextAction` branch, and guardrail precedence), plus 2 new tests
  in `tools/investigation.test.ts` for `get_next_investigation_action`.

**Fixed**
- `mcp-bridge/src/tool-schemas.ts` (the MCP bridge's static JSON-schema
  mirror, with zero dependency on the extension runtime) was missing 9
  tools that were already registered in
  `packages/browser-runtime/src/tools/index.ts`: all 8
  investigation-lifecycle tools (`start_investigation`,
  `get_investigation_plan`, `update_investigation`,
  `record_verification_attempt`, `stop_investigation`,
  `get_investigation_status`, `get_investigation_timeline`,
  `clear_investigation_evidence`) and `analyze_element_selectors` — MCP
  clients connecting through the bridge (Cursor, Claude Code, etc.) could
  not reach the investigation or selector-diagnostics layer at all. Added
  all 9 missing schemas plus `get_next_investigation_action` (10 total).
- A stale doc comment in `tools/index.ts` claiming "Total: 34 tools" when
  the actual registered count was 50 (51 with the new tool) — replaced
  with an itemized per-category breakdown and a note to recompute rather
  than trust the comment, since it had already gone stale once.

**Reviewed**
- PR #11 ("Add investigation-aware network capture session", the P1.6
  item from the master-prompt gap matrix): implementation is solid
  (correct per-conversation isolation, proper header redaction,
  substantive tests), but two real defects CI didn't catch — no
  `chrome.tabs.onRemoved`/`chrome.debugger.onDetach` cleanup, so a closed
  or detached tab mid-capture leaks a running heartbeat interval and
  permanently blocks that conversation from starting a new capture; and
  the in-memory captured-request map has no size cap, unlike the evidence
  store's 500-item ceiling. Posted a review requesting both fixes before
  merge — **not merged**; investigation-aware network capture remains
  unmerged/TODO on `main`, which still only has the old fixed-window
  `get_network_diagnostics`.

## Unreleased (this session) — console/runtime event classification

**Added**
- Console/runtime event classification
  (`packages/browser-runtime/src/apty/log-classification.ts`):
  `classifyLogEntry()` buckets every entry `get_apty_page_logs`
  (`tools/apty.ts`) and `get_runtime_diagnostics` (`tools/devtools.ts`)
  return into `csp-violation` / `cors-error` / `unhandled-rejection` /
  `js-exception` / `network-resource-error` / `deprecation-warning` /
  `apty-error` / `console-error` / `console-warning` / `info`, using
  already-redacted text plus a structured hint where one exists (CDP
  `Log.entryAdded`'s own `entry.source` is now captured and passed
  through for `get_runtime_diagnostics`). Both tools now return a
  `categoryCounts` tally alongside the entry/event list.
  `summarizeLogCategories()` is the shared tally helper. Closes the
  "Console/runtime event classification" gap (P1.7) from the previous
  session's gap matrix.
- 14 new/expanded tests: `log-classification.test.ts` (12 cases, new,
  covering every category plus precedence rules — e.g. a `TypeError`
  message that happens to mention "Apty" still classifies as
  `js-exception`, not `apty-error`), plus one integration test each in
  `apty.test.ts` and `devtools.test.ts` confirming the new fields appear
  on real tool output.

**Reviewed**
- `SECURITY_AUDIT.md` finding #10: classification is pure pattern-matching
  over already-redacted text/metadata — no new permission, no new data
  read, no redaction-ordering risk.

## Unreleased (this session) — unified Apty component model, investigation planner, structured hypotheses, verification guard, debugger-manager fix

**Added**
- Corrected the Apty product model the investigation engine reasons about:
  `AptyComponentKind` (`packages/browser-runtime/src/apty/investigation-session.ts`)
  is now `"apty-client-widget-player" | "apty-studio"` — Apty ships two
  extensions, not four separate "Client"/"Widget"/"Studio"/"Service
  Worker" components. `component-health.ts` (browser-ext) now renders
  exactly two grouped rows with per-probe drill-down instead of four.
- Deterministic investigation planner (`apty/investigation-planner.ts`):
  `planInvestigation(userProblem)` matches known problem patterns
  (tooltip not showing, Studio can't select an element, works in Studio
  but not production, workflow not triggering, widget not loading) to an
  ordered checklist with suggested tools per step, falling back to a
  generic plan otherwise. `start_investigation` generates and stores it;
  new `get_investigation_plan` tool surfaces it;
  `update_investigation`'s `completedPlanStepId`/`skippedPlanStepId`
  track progress. New `PlanChecklist` UI component renders it as a
  fourth tab in the investigation summary bar.
- Structured hypotheses: `Hypothesis { id, statement, status, confidence,
  supportingEvidenceIds, contradictingEvidenceIds, createdAt, updatedAt }`
  replaces bare strings. `update_investigation`'s new `updateHypothesis`
  field moves one through open→testing→supported/rejected/confirmed/
  inconclusive, citing evidence ids. `DiagnosisCard` renders each with a
  status badge.
- Real verification loop: `record_verification_attempt` accepts an
  optional `hypothesisId` and auto-updates that hypothesis's status.
  `updateInvestigation()` now **enforces** — server-side, not just via
  prompt instruction — that `confidence: "confirmed"` is downgraded to
  `"likely"` unless a confirmed verification attempt already exists;
  `update_investigation` surfaces the downgrade as a `warning`.
- System prompt rewritten: a new "APTY PRODUCT ARCHITECTURE" section
  states the two-extension model up front; the debugging loop now walks
  through planning, structured hypothesis tracking, and
  verification-before-confirming explicitly (13 steps, up from 12).
- 34 new/expanded tests across `investigation-planner.test.ts` (8, new),
  `investigation-session.test.ts` (expanded for the new model/guard),
  `tools/investigation.test.ts` (expanded), `component-health.test.ts`/
  `component-health-panel.test.tsx`/`diagnosis-card.test.tsx` (expanded
  for the grouped model and structured hypotheses).

**Fixed**
- `debugger-manager.ts`'s `safeAttachDebugger()` used to delete any
  `<iframe src="chrome-extension://...">` (any extension's, not scoped to
  this one, including inside Shadow DOM) from the live page before every
  CDP attach — inherited unchanged from the original AIPex import,
  undocumented, untested, and with no evidence it was ever required.
  Removed entirely; 5 new regression tests
  (`automation/debugger-manager.test.ts`) confirm attach/detach never
  touch the page. See `SECURITY_AUDIT.md` finding #8.

## Unreleased (this session) — investigation session lifecycle + investigation-first side panel redesign

**Added**
- `InvestigationSession` lifecycle (`packages/browser-runtime/src/apty/investigation-session.ts`):
  `{ id, conversationId, tabId, startedAt, updatedAt, status, userProblem,
  suspectedComponents, hypotheses, verificationAttempts, diagnosis?,
  confidence? }`, keyed per-conversation like the existing evidence store.
  Five new tools (`packages/browser-runtime/src/tools/investigation.ts`):
  `start_investigation`, `update_investigation`,
  `record_verification_attempt`, `stop_investigation`,
  `get_investigation_status`. The system prompt's debugging loop now
  instructs the model to call these at each step.
- A full side-panel UI redesign (`packages/browser-ext/src/lib/investigation/`,
  new directory) turning the generic AIPex chat UI into an
  investigation-first Apty debugging console: a live-investigation banner
  + browser context bar in the header (real Stop action with a confirm
  dialog), a collapsible Timeline/Components/Diagnosis summary bar above
  the input, an Apty-specific empty state, and a dedicated selector-
  analysis visual (recommended selector, ranked candidates, iframe/Shadow-
  DOM boundary note, copy-selector button) replacing the raw JSON dump for
  `analyze_element_selectors`. All of it reads real evidence/investigation
  state directly from `@aipexstudio/browser-runtime` (same JS realm as
  tool execution — see `DECISIONS.md`); nothing is fabricated.
- Friendly, emoji-prefixed activity labels for every Apty/investigation/
  selector tool, added to the existing i18n `tools.*` translation table
  (`en.json`/`zh.json`) rather than a new mapping layer. The default tool
  display now also shows the raw tool name in its expanded technical
  details.
- 30 new tests: `investigation-session.test.ts` (15), new lifecycle-tool
  coverage in `tools/investigation.test.ts` (6), `component-health.test.ts`
  (9), `peekConversationTabBinding` coverage in
  `conversation-tab-binding.test.ts` (4), plus RTL tests for
  `ComponentHealthPanel` and `DiagnosisCard`.

**Fixed**
- `BrowserChatHeader` accepted a `title` prop but never rendered it — the
  header showed no product name at all. Now renders it (default: "Apty
  Live Debugging").
- `packages/browser-ext/vitest.config.ts` was missing the
  `@aipexstudio/aipex-react/*` → source alias that `vite.config.ts` (the
  real build) already had, so tests couldn't resolve deep subpaths like
  `/lib/utils` or `/components/ui/*` that aren't in `aipex-react`'s
  `package.json` exports map but do resolve at build time via that alias.

## Unreleased (this session) — evidence correlation, investigation timeline, selector diagnostics

**Added**
- Deterministic evidence correlation: `DiagnosticEvidence` (`packages/browser-runtime/src/apty/types.ts`)
  extended with `evidenceId`/`conversationId`/`tabId`/`frameId`/`url`/
  `requestId`/`correlationId`/`scope` and, for the first time, actually
  constructed — a new bounded per-conversation `evidence-store.ts` records
  warn/error-level findings as a side effect of every existing diagnostic
  tool call (`apty.ts`'s 5 tools, `devtools.ts`'s 2 tools). A new
  `evidence-correlation.ts` groups evidence into clusters (exact match on
  request/correlation id, or same-tab/shared-scope within a time window)
  and flags clusters spanning a network failure + a console/runtime error
  as `likelySameIncident`. Two new tools
  (`packages/browser-runtime/src/tools/investigation.ts`):
  `get_investigation_timeline` and `clear_investigation_evidence`.
- Selector diagnostics: `packages/browser-runtime/src/automation/selector-analysis.ts`
  (pure, unit-tested ranking engine — `looksDynamic()`,
  `generateSelectorCandidates()`, `rankSelectorCandidates()`,
  `formatSelectorReport()`) and a new `analyze_element_selectors` tool
  (`packages/browser-runtime/src/tools/selector.ts`) that resolves a
  snapshot element live via CDP, generates ranked candidate selectors
  (data-apty-* attributes, stable id, aria, semantic attributes, stable
  classes, text, structural path), and live-tests every candidate's actual
  match count against the page.
- A gap matrix in `PROJECT_PROGRESS.md` auditing the repo against the full
  product specification (evidence correlation, investigation sessions,
  selector diagnostics, UI redesign, security hardening, tool cleanup),
  identifying what's done, partial, or not started with priorities.
- 58 new tests: `evidence-correlation.test.ts` (17), `evidence-store.test.ts`
  (8), `selector-analysis.test.ts` (29), `investigation.test.ts` (3),
  plus evidence-recording coverage added to `apty.test.ts` (1) and a new
  `devtools.test.ts` (2).

**Fixed**
- `SECURITY_AUDIT.md` finding 1b (no multi-session/multi-tab diagnostic
  isolation) updated from Open to Fixed, reflecting the prior session's
  isolation work — the finding's own status had not been updated when
  that work shipped.

**Not done this session** (see `PROJECT_PROGRESS.md`'s gap matrix and Next
Steps): an explicit `InvestigationSession` lifecycle object (hypotheses,
verification attempts, final diagnosis+confidence) on top of the new
evidence store; the dedicated debugging-console UI (investigation state
banner, evidence panel, timeline, diagnosis card) — the side panel is
still a generic chat UI; network diagnostics start/stop capture session
UX; console/runtime event classification; self-healing/stale-UID
recovery; friendly tool-call-name UX; `host-access-config.json`/
console-bridge domain scoping (blocked on Apty's target domain list).

## Previous session — multi-session/multi-chat isolation

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
