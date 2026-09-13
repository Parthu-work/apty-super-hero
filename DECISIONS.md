# Technical Decisions

Key architectural decisions and why they were made, so a future session
doesn't re-litigate them without knowing the reasoning. Newest first.

## No RAG layer, ever, in this repo

Apty already has a separate knowledge/RAG system (Phase 1/2, rolling out
separately). This repo's system prompt explicitly tells the model to defer
"how do I configure X" style questions to that system rather than trying to
answer from its own training data or building a second retrieval pipeline.
No embeddings, vector DB, document ingestion, or chunking exists here, and
none should be added. If a future request asks for one, push back and
point to this decision first.

## Apty diagnostics are honest stubs, not fake implementations

`AptyWidgetDiagnosticsProvider`, `AptyClientDiagnosticsProvider`,
`AptyStudioDiagnosticsProvider`, and `AptyServiceWorkerDiagnosticsProvider`
all default to `status: "not_configured"` rather than returning invented
data. The alternative — hardcoding a plausible-looking response — would
actively harm the debugging use case: a diagnosis tool that lies about
Apty's state is worse than no tool at all, because the agent (and the
engineer relying on it) would trust a fabricated signal. Every provider
implementation was built against a *proposed* contract (a `window.__APTY_WIDGET__`
global, a cross-extension message type), not a confirmed one, precisely so
it's obvious where real Apty-side work is still needed.

## Config lives in `chrome.storage.local`, seeded from build-time env, not read directly from `import.meta.env` in browser-runtime

`packages/browser-runtime` is a plain `tsc`-built package with no Vite
dependency; only `packages/browser-ext` has `import.meta.env` access. Rather
than make `browser-runtime` Vite-aware (wrong direction — runtime/browser
logic shouldn't depend on a specific bundler), `browser-ext`'s
`background.ts` reads the Vite env vars once at service-worker startup and
writes them into `chrome.storage.local`; `browser-runtime`'s
`apty/config.ts` reads them back from there. This also means the same
config surface could later be exposed in an Options UI without a rebuild —
a bonus, not the primary reason for the design.

## BYOK only, no proxy fallback (carried over from the prior session)

The extension talks directly to whichever AI provider the user (or
eventually Apty's backend) configures. There is no AIPex-hosted proxy in
the loop. See `CHANGELOG.md` for when this was removed and why (Apty
traffic should never route through a third party's backend).

## Kept AIPex's generic browser/tab/tool infrastructure; did not rename internal identifiers

Per the project brief's own KEEP/MODIFY/REMOVE/FUTURE framing: DOM
snapshot, element UIDs, the MCP bridge, WebSocket transport, the
intervention system, and the tab/screenshot/skill tools are generic
browser-agent infrastructure that AIPex happens to have built well — kept
as-is. Internal package names (`@aipexstudio/*`), the core agent class
name (`AipexAgent`), and `chrome.storage` key prefixes (`aipex-*`) were
*not* renamed. This is a deliberate scope decision, not an oversight: it's
a large, purely-cosmetic refactor with real regression risk (every import
path, every serialized storage key) for zero functional benefit. Revisit
only if there's a concrete reason (e.g. npm-publishing this fork under
Apty's own name) rather than "it still says AIPex somewhere."

## `get_network_diagnostics` / `get_runtime_diagnostics` use a bounded live capture window, not a persistent recorder

CDP only observes network/runtime events from the moment a domain is
enabled — there is no way to retroactively query traffic that happened
before the tool was called (unlike the console bridge, which has been
buffering since page load precisely because it doesn't need debugger
attach). Making these tools "always-on" background recorders was
considered and rejected for this checkpoint: it would mean holding the
debugger attached indefinitely (worse UX — Chrome shows a visible "this
extension is debugging this tab" banner — and conflicts with
`debuggerManager`'s existing 30s-inactivity auto-detach design, built for
one-shot automation actions). A bounded on-demand window is honest about
what it can and can't see; the system prompt tells the model to ask the
user to reproduce an issue while the tool runs. Revisit if real usage shows
this is too limiting.

## Redaction is pattern-based, not a full DLP system

`apty/redact.ts` matches known header names and common
`key: value`/`Bearer ...` patterns. This is a best-effort mitigation, not a
guarantee that no secret ever reaches the model — documented as such in the
code and in `SECURITY_AUDIT.md`. A more exhaustive approach (e.g.
allowlisting only known-safe fields instead of blocklisting known-sensitive
ones) would be more conservative but was judged disproportionate for a
first pass; revisit if a real secret leak is ever observed in practice.
