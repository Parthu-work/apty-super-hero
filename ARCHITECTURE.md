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
              ┌─────────────┼──────────────┐
              ▼              ▼              ▼
         Browser Tools   DevTools Tools   Apty Tools
        (packages/       (CDP, new)      (new — Widget/
         browser-runtime/                 Client/Studio/
         tools/*)                         Service-Worker)
              │              │              │
              ▼              ▼              ▼
        DOM/elements    Network          window.__APTY_WIDGET__
        iframes         Runtime/Log      window.__APTY_CLIENT__
        screenshots     (bounded         cross-extension messaging
                         capture window)  (not yet implemented by Apty)
              │              │              │
              └──────────────┼──────────────┘
                              ▼
                    Model reasons over tool
                    results (no separate
                    "evidence engine" exists;
                    see Evidence Model below)
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
- `DiagnosticEvidence` — `{ source, timestamp, type, data }`, a normalized
  shape any tool's output can be expressed in.
- `EvidenceSource` — `"dom" | "console" | "network" | "runtime" |
  "apty-client" | "apty-widget" | "apty-studio" | "service-worker"`.
- `DiagnosisConfidence` — `"confirmed" | "likely" | "possible" | "unknown"`.

**What this is, honestly**: a shared vocabulary and a set of tools whose
outputs are shaped consistently enough for the model to correlate across
them. **What this is not**: a deterministic correlation engine. No code
today automatically links a network error to a console error to a DOM
change — that correlation happens in the model's reasoning, guided by the
system prompt's required loop and output format (see
`packages/aipex-react/src/components/chatbot/constants.ts`). A
deterministic pre-correlation pass (e.g., flag events within N ms of each
other) is a reasonable future improvement, not yet built — see
`PROJECT_PROGRESS.md`'s Next Steps.

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

## What was deliberately not built

- **RAG / knowledge base of any kind** — explicitly out of scope per the
  project brief; Apty has a separate system for this.
- **Deterministic evidence correlation engine** — see Evidence Model above.
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
- **Multi-session/multi-tab diagnostic isolation** — not deliberate, a real
  gap: every diagnostic tool operates on whichever tab is currently active
  in the window (`getActiveTab()`), not a tab bound to a specific
  conversation. See `PROJECT_PROGRESS.md`'s "Multi-Session Isolation —
  Research Notes" for what was found and the recommended fix
  (`RunContext<Context>` threading through the existing `@openai/agents`
  runner, already supported by the SDK and currently unused).
