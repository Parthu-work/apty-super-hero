# Architecture

This documents what is actually implemented, not the aspirational end
state. Where something described in the original brief isn't built yet,
this file says so explicitly rather than describing it as done.

A more detailed, diagram-heavy version of this document — plus product
overview, Apty integration contracts, security architecture, and an
engineering handoff summary — lives in Apty's Confluence as a 12-page
documentation package rooted at
["Apty Live Browser Debugging Agent"](https://apty.atlassian.net/wiki/spaces/~712020ef582a34887949aa80daf20d290f4d9e/pages/1467679209),
grounded in this repository at commit `14693a9`. See
`PROJECT_PROGRESS.md`'s "Confluence Documentation" section for the full
page index. This file remains the fastest-to-update, code-adjacent source
of truth; treat Confluence as a snapshot.

## High-level shape

```
                     USER (Apty engineer)
                            │
                            ▼
                 Apty Debugging Chat (side panel)
                            │
                            ▼
                        AI Agent
              (packages/core — model-agnostic loop)
                            │
      ┌───────────────┬───────────────┬───────────────┬───────────────┐
      ▼               ▼               ▼               ▼               ▼
 Browser Tools   DevTools Tools    Apty Tools     Selector Tool   Investigation Tools
(packages/       (CDP)            (Widget/       (analyze_        (get_investigation_
 browser-runtime/                  Client/Studio/  element_        timeline,
 tools/*)                          Service-Worker)  selectors)     clear_investigation_
      │               │               │               │            evidence)
      ▼               ▼               ▼               ▼               │
 DOM/elements    Network          window.__APTY_WIDGET__  Ranked      │
 iframes         Runtime/Log      window.__APTY_CLIENT__  ✅/⚠️/❌     │
 screenshots     (bounded         cross-extension          candidate  │
                 capture window)  messaging (not yet       selectors  │
                                  implemented by Apty)                │
      │               │               │                              │
      └───────────────┴───────┬───────┴──────────────────────────────┘
                               ▼
              Diagnostic tools record warn/error findings as
              DiagnosticEvidence (apty/evidence-store.ts, per-
              conversation, bounded) — deterministically
              correlated into clusters by evidence-correlation.ts,
              exposed via get_investigation_timeline
                               ▼
                    Model reasons over the correlated
                    timeline (not raw disconnected tool
                    outputs) to form and verify a hypothesis
                               ▼
                     Diagnosis (Confirmed/
                     Likely/Possible/Unknown),
                     per the system prompt's
                     required format
```

There is **no RAG layer** anywhere in this architecture — no document
ingestion, embeddings, vector store, or retrieval pipeline. Apty's existing
knowledge base handles product/how-to questions; this extension only
reasons over live browser state.

## Package layout

| Package | Role |
|---|---|
| `packages/core` | Model-agnostic agent loop (tool-calling, conversation state), Vercel AI SDK based. No browser-specific code. |
| `packages/dom-snapshot` | DOM → normalized element list with stable UIDs. Avoids sending raw DOM to the model. |
| `packages/browser-runtime` | Everything that talks to Chrome APIs: automation (CDP, DOM locators, iframe/shadow handling), tools, the intervention system, the skill sandbox, the Apty diagnostics module, the MCP WebSocket bridge. |
| `packages/aipex-react` | Shared React UI (chat, settings, system prompt constants). |
| `packages/browser-ext` | The actual Manifest V3 extension: manifest, background service worker, content scripts, side panel/options pages. Wires the above packages together. |
| `mcp-bridge/` | Standalone Node package (own `package.json`, outside the pnpm workspace) — a WebSocket daemon external AI clients (Claude Code, Cursor) connect to, which relays to the extension. |

## AI reasoning vs. deterministic execution

The model never executes a browser action directly. It selects a tool by
name with structured parameters (validated by Zod schemas); a plain
TypeScript function executes the actual Chrome API call and returns a
structured result; the model only ever sees that result. This is enforced
by construction — tools are the only thing exposed to the model
(`packages/core`'s `tool()` factory + `allBrowserTools` registry), there is
no code path where model output is `eval`'d or otherwise turned directly
into a DOM/browser operation.

## Evidence model

`packages/browser-runtime/src/apty/types.ts` defines:
- `DiagnosticEvidence` — `{ evidenceId, conversationId?, source, timestamp,
  type, tabId?, frameId?, url?, requestId?, correlationId?, scope, data }`,
  a normalized shape any tool's output can be expressed in.
- `EvidenceSource` — `"dom" | "console" | "network" | "runtime" |
  "apty-client" | "apty-widget" | "apty-studio" | "service-worker"`.
- `DiagnosisConfidence` — `"confirmed" | "likely" | "possible" | "unknown"`.

**What this is now**: not just a shared vocabulary — every diagnostic tool
actually constructs `DiagnosticEvidence` records (warn/error-level
findings only) into a bounded per-conversation store, and
`get_investigation_timeline` returns them deterministically correlated
into clusters (same request/correlation id, or time-window + tab/shared
proximity), with cross-source failure clusters flagged
`likelySameIncident`. See "Evidence correlation and the investigation
timeline" further down for the full mechanism. **What this still is not**:
a diagnosis engine — clustering narrows the model's search space, but the
actual root-cause reasoning, hypothesis verification, and confidence
rating remain the model's responsibility, guided by the system prompt's
required loop and output format (see
`packages/aipex-react/src/components/chatbot/constants.ts`).

### Conversation/tab binding — evidence isolation

Evidence is only useful if it's about the tab the conversation is actually
debugging. Every evidence-gathering tool (`apty.ts`'s 5 tools,
`devtools.ts`'s 2 tools) resolves its target tab via
`resolveDiagnosticTab()` (`packages/browser-runtime/src/tools/tab-utils.ts`)
instead of unconditionally querying "whichever tab is focused right now":

1. `AIPex.chat()` accepts an opaque `runContext` (`ChatOptions.runContext`,
   `packages/core/src/types.ts`) forwarded verbatim to `@openai/agents`'
   `run()` as its `context` option, and from there to every tool's
   `execute(input, context)` as `context.context` — no new plumbing, just
   using SDK capability that already existed.
2. `packages/browser-ext/src/lib/conversation-tab-binding.ts` supplies the
   concrete value: a `Map<sessionId, tabId>` that binds a conversation to
   whichever tab was active the first time it had a real session id, and
   keeps returning that tab even if the user's focus moves elsewhere. This
   map is deliberately keyed by conversation, not a single `currentTabId`.
3. `resolveDiagnosticTab()` prefers the bound tab (re-verified via
   `chrome.tabs.get` in case it was closed) and only falls back to the old
   "active tab" behavior when no binding exists yet or it's stale.

Two tools are genuinely tab-agnostic (`get_apty_studio_diagnostics`,
`get_apty_service_worker_diagnostics` — cross-extension messaging, not
page-scoped) and instead tag their response with the requesting
`conversationId`, following the same honest "shared, not
attributed-to-a-tab" pattern the service-worker tool already used via its
`scope: "shared-global"` field.

Chat-message-history isolation (which `Session`/`ConversationData` a
conversation's messages live in) was already correct before this; the gap
this closed was *tool execution* silently ignoring which conversation it
was running for. Concurrency across separate side panel *windows* already
worked (independent JS realms); a single window still shows one
conversation at a time (the history dropdown is a switcher, not multiple
panes) — see `PROJECT_PROGRESS.md`'s "Multi-Session Isolation —
Implementation Notes" for the full writeup and remaining follow-ups.

### Evidence correlation and the investigation timeline

The evidence model above was, until this session, defined but never
constructed — every tool returned its own ad-hoc shape and correlation was
entirely up to the model's reasoning. Two pieces close that gap:

- **`packages/browser-runtime/src/apty/evidence-store.ts`** — a bounded
  `Map<conversationId, DiagnosticEvidence[]>` (500 entries per
  conversation, oldest dropped first). Every diagnostic tool
  (`apty.ts`'s 5, `devtools.ts`'s 2) records warn/error-level findings
  here as a side effect of its normal return value — routine log/info
  entries and successful requests are deliberately not recorded, so this
  stays a bounded evidence log, not a full trace dump.
- **`packages/browser-runtime/src/apty/evidence-correlation.ts`** — pure,
  deterministic `correlateEvidence()`: groups evidence via exact-match on
  `requestId`/`correlationId` (regardless of time gap — a slow request is
  still one incident) plus a bounded time-window fallback scoped to the
  same tab, or either side being `scope: "shared"` (so a service-worker
  log can still plausibly relate to tab-scoped activity nearby in time).
  Clusters spanning a network failure and a console/runtime error are
  flagged `likelySameIncident: true`.

Two tools expose this to the model
(`packages/browser-runtime/src/tools/investigation.ts`):
`get_investigation_timeline` (the correlated view of everything collected
so far in the calling conversation — scoped by `conversationId` the same
way tab binding is) and `clear_investigation_evidence` (discard evidence
when starting a fresh investigation within the same chat). This is a
pre-pass that narrows the model's search space, not a diagnosis engine —
the model still does the actual root-cause reasoning and confidence
rating, per the system prompt's CONFIRMED/LIKELY/POSSIBLE/UNKNOWN
discipline.

### Selector diagnostics

`packages/browser-runtime/src/automation/selector-analysis.ts` is a pure,
deterministic ranking engine (no browser access) answering Apty's most
common recurring question — "why can't Studio/a Workflow select this
element":

1. `looksDynamic()` flags framework-generated values: purely numeric ids,
   UUIDs, a numeric/hex suffix (`input-928731`), known CSS-in-JS/framework
   prefixes (`css-`, `sc-`, `jss`, `ember`, `mui-`).
2. `generateSelectorCandidates()` produces candidates in priority order —
   `data-apty-*` attributes first (Apty's own semantic markers), then
   stable id, aria attributes, semantic attributes
   (name/type/placeholder/role/href), stable classes (dynamic-looking ones
   excluded), a text-based XPath candidate, and a structural nth-child
   path as a last resort — tagging iframe/Shadow-DOM context on every
   candidate when relevant.
3. `rankSelectorCandidates()` combines that static risk with live match
   data (0 matches → broken, matches something else → broken, >1 match →
   risky/ambiguous, unique + low-risk → recommended) into a ✅/⚠️/❌
   verdict per candidate.

`packages/browser-runtime/src/tools/selector.ts`'s `analyze_element_selectors`
tool wires this to a live page: given a snapshot `uid` (the same one
`click`/`fill` already use), it resolves the element via CDP
(`DOM.resolveNode` → `Runtime.callFunctionOn`, the same pattern
`SmartLocator` uses for interaction), extracts its
tag/id/classes/attributes/text/ancestor-chain/iframe/shadow-root context
in one call, generates candidates, and live-tests every candidate's match
count in a second call. CDP-mode snapshots only — DOM-mode snapshots
report `available: false` with a clear reason rather than silently
degrading, per this repo's "honest stubs" precedent (see `DECISIONS.md`).
Attribute values and text content are redacted before candidate
generation, same discipline as every other Apty-facing tool.

## Apty integration layer

Four provider interfaces, one per Apty component
(`packages/browser-runtime/src/apty/*.ts`):

| Provider | Mechanism | Status |
|---|---|---|
| `AptyWidgetDiagnosticsProvider` | `chrome.scripting.executeScript` (MAIN world) reads `window.__APTY_WIDGET__` | Probe implemented; Widget doesn't expose this global yet |
| `AptyClientDiagnosticsProvider` | Same, reads `window.__APTY_CLIENT__` | Probe implemented; Client doesn't expose this global yet |
| `AptyStudioDiagnosticsProvider` | `chrome.runtime.sendMessage(extensionId, ...)` | Implemented; requires Studio's real extension ID + Studio-side message handler, neither of which exist yet |
| `AptyServiceWorkerDiagnosticsProvider` | Cross-extension messaging OR HTTP diagnostic endpoint (whichever is configured) | Consumer hardened + tested (Zod-validated responses, redacted logs, bounded acceptance); producer has a complete reference implementation (`docs/apty-integration/apty-widget-service-worker.reference.ts`) not yet adopted by Apty |

Every provider has a `NotConfigured*` fallback that returns
`status: "not_configured"` — this is intentional and expected until Apty
engineering wires up the corresponding side, not a bug to silently work
around. **No provider fabricates data.**

### Service Worker diagnostics — evidence scope

Apty's service worker (if/when Option A above is adopted) is a single
process shared across every tab and window, not scoped to whichever tab a
debugging conversation happens to be about. `get_apty_service_worker_diagnostics`
tags its result with `scope: "shared-global"` and an explicit note in its
tool description so the model never falsely attributes a service-worker
log to "the current tab" without other corroborating evidence (a matching
timestamp, a message that names the page/origin, etc.) — this follows the
project brief's instruction to mark unattributable evidence as
shared/unattributed rather than inventing attribution.

Configuration flows: `packages/browser-ext/.env.example` (build-time Vite
env vars) → seeded into `chrome.storage.local` on service-worker startup
(`background.ts`) → read at tool-call time via
`packages/browser-runtime/src/apty/config.ts`. This indirection means
config could later be exposed in an Options UI without a rebuild, though
no such UI exists yet.

## DevTools / CDP layer

`packages/browser-runtime/src/tools/devtools.ts` adds two tools that reuse
the existing `debuggerManager` (attach/detach lifecycle, auto-detach
safety) and `CdpCommander` (typed `sendCommand` wrapper) from
`packages/browser-runtime/src/automation/`:

- `get_network_diagnostics` — enables the CDP `Network` domain, listens for
  `requestWillBeSent`/`responseReceived`/`loadingFailed`, correlates them by
  `requestId`, redacts headers, returns the list.
- `get_runtime_diagnostics` — enables `Log`/`Runtime`, captures
  `Log.entryAdded` and `Runtime.exceptionThrown` (with stack traces).

**Hard limitation, stated explicitly in both tool descriptions and the
system prompt**: CDP only observes events from the moment a domain is
enabled — it cannot retroactively return network requests or log entries
from before the tool was called. Each tool opens a bounded capture window
(500ms–15s, default 3s) and returns only what happened during it.

This is distinct from `get_apty_page_logs`
(`packages/browser-runtime/src/tools/apty.ts`), which reads a buffer
continuously filled by `packages/browser-ext/src/apty-console-bridge.ts` — a
MAIN-world content script that has been capturing `console.*` calls and
`window.onerror`/`unhandledrejection` since page load, with no debugger
attach/detach cost. The two are complementary: the console bridge has
history but only sees `console.*`-routed output; CDP sees real network
data and browser-internal events but only forward from attach time.

## Iframes and Shadow DOM

Inherited from AIPex's DOM-snapshot/locator system
(`packages/browser-runtime/src/automation/iframe-manager.ts`,
`dom-locator.ts`), which already represents frame boundaries. The Apty
Studio debugging guidance in the system prompt explicitly instructs the
model to report frame/shadow boundaries when they're relevant to a
diagnosis, and to say plainly when something is uninspectable (cross-origin
iframe, closed Shadow DOM) rather than guessing. No new code was added here
this session; this is flagged as an area to verify/extend once real Studio
debugging scenarios are tested against it.

## Security boundary: the webpage is untrusted

Enforced at two layers:
1. **Data layer**: `packages/browser-runtime/src/apty/redact.ts` strips
   sensitive headers/tokens/passwords from any log or header data before it
   is returned to the model — the model literally cannot see a raw
   `Authorization` header value.
2. **Reasoning layer**: the system prompt explicitly instructs the model to
   treat all page-derived content (console output, DOM, network payloads)
   as data, never as instructions, and to not comply with injected text
   that looks like a command. This is a prompt-level mitigation — there is
   no code-level way to guarantee an LLM ignores adversarial content in its
   context window; instructing it not to comply is the standard mitigation
   for this class of risk, not a complete guarantee.

## Investigation session lifecycle

`packages/browser-runtime/src/apty/investigation-session.ts` adds the
first-class lifecycle object the evidence store didn't have: an
`InvestigationSession { id, conversationId, tabId, startedAt, updatedAt,
status, userProblem, suspectedComponents, hypotheses,
verificationAttempts, diagnosis?, confidence? }`, in a
`Map<conversationId, InvestigationSession>` keyed exactly like
`evidence-store.ts` (same `"pending"`/unscoped-bucket convention — see
`DECISIONS.md`). `status` is one of `starting | investigating |
collecting_evidence | analyzing | verifying | resolved | failed |
stopped`, always set explicitly by a tool call, never inferred.

Five tools (`packages/browser-runtime/src/tools/investigation.ts`, added
alongside the pre-existing `get_investigation_timeline`/
`clear_investigation_evidence`) let the model drive this lifecycle:
`start_investigation`, `update_investigation` (status transitions,
hypotheses, suspected components, diagnosis+confidence),
`record_verification_attempt`, `stop_investigation`, and
`get_investigation_status`. The system prompt
(`packages/aipex-react/src/components/chatbot/constants.ts`'s "THE
DEBUGGING LOOP" section) instructs the model to call these at each step of
the debugging loop, so a UI status is only ever real application state,
never a fabricated "Analyzing..." placeholder.

## Side panel UI architecture

The side panel was a generic chat UI (message list + input) with no
debugging-specific chrome; it is now an investigation-first debugging
console, built entirely as browser-ext-local components
(`packages/browser-ext/src/lib/investigation/`) that compose
`aipex-react`'s existing slot/component-override system
(`ChatbotSlots`/`ChatbotComponents` — Header, MessageList, InputArea,
`toolDisplay`, `emptyState`, `promptExtras` were already swappable) rather
than requiring `aipex-react` to know anything about Apty or browser-runtime
(preserving the `@aipex-react` must-not-depend-on-`@browser-runtime` rule).

Key pieces:
- **`use-investigation-data.ts`** — a polling hook that reads
  `getEvidence`/`getInvestigation`/`correlateEvidence` from
  `@aipexstudio/browser-runtime` directly (see `DECISIONS.md` for why this
  is safe: tool `execute()` and the side panel's React tree share one JS
  realm). Backs off from a 1.2s to a 5s poll interval when the chat isn't
  actively streaming/running tools.
- **`component-health.ts`** — pure function deriving Client/Widget/Studio/
  Service-Worker health from the most recent `*-status` evidence entry per
  component (recorded unconditionally by every `get_apty_*_diagnostics`
  tool call, unlike log evidence which is warn/error-only) — `not_checked`
  when no such evidence exists yet, never a guessed status.
- **`investigation-context-bar.tsx`** — rendered inside `BrowserChatHeader`,
  below the title row: a quiet "debugging `<hostname>`" line normally, or a
  prominent "LIVE INVESTIGATION" banner with a real Stop action (calls
  `stopInvestigation()` directly, plus `interrupt()`) while a session is
  actually in progress.
- **`investigation-summary-bar.tsx`** — a collapsed-by-default bar in the
  `promptExtras` slot (just above the input) that expands into three tabs:
  Timeline (`evidence-timeline.tsx`, rendering `CorrelationCluster[]`
  exactly as computed — the "likely related incident" badge only ever
  reflects `cluster.likelySameIncident`), Components
  (`component-health-panel.tsx`), and Diagnosis (`diagnosis-card.tsx`,
  confidence badge styled to match CONFIRMED/LIKELY/POSSIBLE/UNKNOWN
  without ever visually upgrading a lower confidence).
- **`debugging-welcome-screen.tsx`** — replaces the generic "how can I help
  you" empty state (`toolDisplay`/`emptyState` slots) with Apty-specific
  example prompts.
- **`apty-tool-display.tsx` / `selector-analysis-display.tsx`** — gives
  `analyze_element_selectors` a dedicated visual (recommended selector,
  ranked candidates, iframe/Shadow-DOM boundary note, copy-selector button)
  instead of a raw JSON dump; every other tool still renders through the
  pre-existing `DefaultToolDisplay`, which now also shows the raw tool name
  in its expanded technical details.
- Friendly tool-call activity descriptions (e.g. "🌐 Checking network
  requests") are `tools.*` i18n translations, not a new mapping layer — see
  `DECISIONS.md`.

Not yet built: a dedicated "start investigation" form/component tab
(section 11 of the product brief) — the model infers investigation intent
from natural language and the debugging-loop system prompt, per the
brief's own "don't force a form before every question" guidance, so no
separate lifecycle form UI exists yet. No automated component tests cover
the header/summary-bar components directly (they depend on `useChatContext`
and `chrome.tabs`); the pure logic they call
(`component-health.ts`, `investigation-session.ts`,
`evidence-correlation.ts`) is fully unit-tested, and the presentational
leaf components (`ComponentHealthPanel`, `DiagnosisCard`) have React
Testing Library coverage.

## What was deliberately not built

- **RAG / knowledge base of any kind** — explicitly out of scope per the
  project brief; Apty has a separate system for this.
- **Generic browser automation / productivity features** — bookmark/history
  tool source files (`bookmark.ts`, `history.ts`) still exist from the
  AIPex baseline but are not registered in `allBrowserTools` (verified
  against `packages/browser-runtime/src/tools/index.ts`); tab-management
  tools (list/switch/create/close tabs) are registered and used for
  browser-debugging purposes, and the system prompt does not present any
  of this as the agent's purpose.
- **Any actual Apty Studio/Widget/Client/Service-Worker communication** —
  only the client-side halves of these integrations exist; the Apty-side
  halves (a real extension ID, a real global, a real message handler) do
  not.
- **A multi-pane/concurrent chat UI within a single side panel window** —
  the history dropdown switches between conversations one at a time. Not
  needed for evidence isolation itself (see "Conversation/tab binding"
  above) but would be needed for a user to watch two conversations bound
  to two different tabs side by side in the *same* window.
