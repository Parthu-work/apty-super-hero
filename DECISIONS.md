# Technical Decisions

Key architectural decisions and why they were made, so a future session
doesn't re-litigate them without knowing the reasoning. Newest first.

## Apty DOM Health uses two snapshots and a fixed weighted rule engine, not a persistent recorder or an LLM-scored heuristic

The DOM Readiness Score automates the manual "run a DOM analysis script,
run it again, diff the JSON" workflow SEs already do by hand. It takes
exactly two DOM snapshots (`@apty/dom-snapshot`'s
`collectDomHealthSnapshot`, a separate collector from the existing
accessibility-tree `collectDomSnapshot` used for element search) roughly
800ms apart and scores them with fixed weights
(`apty/dom-health-scoring.ts`) — never a third "just in case" snapshot,
never a background/continuous recorder. Three reasons: (1) determinism —
the product spec requires "same input → same score," which a persistent
recorder sampling at arbitrary intervals can't guarantee; (2) the LLM must
never calculate the score itself, so the scoring logic has to be pure,
testable code, not something an agent infers from raw snapshots; (3) perf
— an on-demand two-snapshot audit is bounded and cheap, while a persistent
recorder would mean holding content-script listeners/timers alive
indefinitely for a side panel feature nobody may ever open. Selector-value
dynamism reuses `automation/selector-analysis.ts`'s `looksDynamic()` — the
same function `analyze_element_selectors` already uses — so "does this
id/class look machine-generated" has one definition, not two that could
quietly drift apart. Cross-origin iframes and closed Shadow DOM are
reported as accessibility boundaries (partial credit / capped penalty),
never scored as defects, matching the existing "Apty diagnostics are
honest stubs" precedent below. Revisit the two-snapshot choice (spec
explicitly allows an optional third) if real usage shows single-window
sampling misses debounced re-renders on a specific class of pages.

## `run_console_command` executes scoped JS via the existing CDP debugger session, not a new execution architecture

Asked to "open DevTools and run a console command," the honest answer is
that an extension has no API to toggle the visible DevTools panel open —
but it can achieve the same debugging outcome via `Runtime.evaluate` over
the same `chrome.debugger` connection `get_network_diagnostics`/
`get_runtime_diagnostics`/`analyze_element_selectors` already use
(`automation/debugger-manager.ts`'s `debuggerManager` singleton +
`automation/cdp-commander.ts`'s `CdpCommander` — see `devtools.ts`). No new
attach/detach lifecycle, no new permission (`debugger` was already
declared), and the tool description says plainly that it can't open the
visible panel rather than implying it did. The expression is length-capped
and the result is redacted/truncated the same way `get_runtime_diagnostics`
already redacts log text, so this doesn't introduce a new class of data
exposure. Deliberately NOT a generic "run any JS anywhere" tool — it only
targets the current/bound tab's page, same as every other diagnostic tool
here.

## Apty Client resource inspection uses cross-extension messaging, not `chrome.debugger` — verified, not assumed

The original V1 design (see the older entry below and `CHANGELOG.md`)
attached `chrome.debugger` directly to the Apty Client extension's Service
Worker target, mirroring how `network-capture-session.ts` captures a
*tab's* network traffic. That design was carried through multiple sessions
and 36 passing unit tests without ever running against a real browser —
every test mocked `chrome.debugger.attach()` to unconditionally succeed.

This session built a real two-extension test harness (Puppeteer driving
the pre-installed Chromium, not part of the repo — a throwaway
verification tool) and found `chrome.debugger.attach({targetId: <another
extension's target>})` unconditionally fails with "Cannot access a
chrome-extension:// URL of different extension." This is confirmed to be
a hard Chrome security invariant, not a config issue: the identical API
call against a plain tab, in the same harness extension, with the same
`debugger` permission, succeeds immediately. There is no manifest
permission, flag, or unpacked/dev-mode state that lifts it — Chrome does
not let one extension debug another's internals, full stop. This means
the V1 design could never have retrieved a real Apty Client resource in
production; it only ever "worked" against its own mocks.

The only mechanism Chrome allows for this is `chrome.runtime.sendMessage`
cross-extension messaging, which requires the target extension to
cooperate (`externally_connectable` + implementing a message contract).
`service-worker-diagnostics.ts` already used exactly this pattern for
status/logs (an intentional honest stub, per the entry below), so rather
than inventing a second mechanism, that provider was extended with
`listResources()`/`getResourceBody()` and
`extension-network-inspector.ts`'s connect/inspect/list functions were
rewired to call it — same public API, same pure matching/redaction/
evidence logic, different (and now the *only actually possible*)
transport. Re-verified against the same real two-extension harness:
connect, list, and retrieve an actual resource body all passed against a
cooperating fake Apty Client.

The practical consequence: this tool now only works once Apty ships the
`apty-debug-agent:*` message contract in the real Apty Client extension
(allowlisting the Apty Agent extension's id under
`externally_connectable`). Until then, `connect_apty_client` reports a
clear, honest "did not respond to the resource-inspection message
contract" failure — never a fabricated success. This is a real product
dependency on Apty-side work, not a shortcut this codebase can code around.

## Investigation-aware network capture was reimplemented fresh on `main`, not merged from PR #11

PR #11 ("Add investigation-aware network capture session", branch
`claude/busy-fermat-xyu2po`) was reviewed in an earlier session (see
`PROJECT_PROGRESS.md`'s "MCP Bridge Tool-Registry Fix & PR #11 Review" and
`CHANGELOG.md`'s "Reviewed" entry from that session) and judged sound in
its core design: per-conversation isolation, a heartbeat re-attach
approach to outlive CDP's normal capture window, and header redaction all
matched this codebase's existing patterns. That review also found two
concrete, well-understood defects: no `chrome.tabs.onRemoved`/
`chrome.debugger.onDetach` cleanup (a tab closing or the debugger
detaching mid-capture leaked a running heartbeat `setInterval` forever and
permanently blocked that conversation from starting a new capture), and no
cap on the in-memory captured-request map (unlike `evidence-store.ts`'s
500-item ceiling), so a long or noisy capture could grow memory without
limit. A review comment requesting both fixes was posted, and the PR was
left open and unmerged.

Rather than pushing fixes onto someone else's open PR/branch, this session
implemented the corrected version directly as new work on `main` —
`network-capture-session.ts` plus 3 tool wrappers — carrying over the
reviewed-as-sound design (per-conversation isolation, heartbeat re-attach,
redaction) and fixing both defects from the start (forced-cleanup
listeners; a `MAX_CAPTURED_REQUESTS = 2000` cap with a `truncated` flag).
This is this project's normal workflow for new work: build it on `main`,
not by taking over another branch mid-review. It also let the new code
integrate with `investigation-orchestrator.ts` (added after PR #11 was
opened, so that PR never called `recordToolCall()`) without needing a
rebase across two independent lines of work.

PR #11 itself remains open, unmerged, on its own branch — now additionally
superseded/obsolete by this implementation. It should not be merged: `main`
already has a corrected version of what it attempted.

## The autonomous orchestrator is a recommend+guardrail layer the model consults, not a second execution engine

The previous session's "Why no external investigation orchestration loop"
entry below concluded that a full external control loop overriding the
model's own tool-selection would mean either forking `packages/core`'s
`run()` loop, or adding another tool the model can choose to call — and
that the second option "is not meaningfully different from what
`get_investigation_plan`/`get_investigation_status`/
`get_investigation_timeline` already provide." This session's
`investigation-orchestrator.ts` is deliberately the second option, but
made meaningfully different in one respect: it doesn't just hand back
inert plan/status data, it enforces two things server-side rather than
relying on prompt discipline — a hard 25-tool-call/15-minute budget and
duplicate-call (loop) detection, both computed in `getBudgetStatus()` and
checked first, ahead of plan/hypothesis progression, inside
`decideNextAction()`. This is still not a standalone process that calls
tools on the model's behalf — this codebase's actual execution loop
remains exactly what it was: the model calls one tool at a time via
`@openai/agents`' `run()`, unchanged. Building a parallel engine that
calls `FunctionTool.execute` itself, outside that loop, would fight the
existing architecture (two things deciding what runs next) rather than
fit it, for no clear benefit over a tool the model is already instructed
to call after every round of evidence collection and whose guidance it is
told to follow (including its `stop` verdicts). If real usage shows the
model ignores `get_next_investigation_action`'s `stop` recommendation and
keeps calling tools anyway, the next escalation is enforcing the budget
inside the diagnostic tools themselves (refuse to execute once
`overBudget` is true), not building a separate orchestration process —
still an additive check, not a parallel execution engine.

**Why tool-call tracking is explicit `recordToolCall()` calls, not a
generic wrapper around every `FunctionTool.execute`**: a wrapper that
intercepts `browserFunctionTools` at registration time (e.g. replacing
each tool's `execute` with a version that calls `recordToolCall` then
delegates) would have been less repetitive than adding one line to each
of the 8 diagnostic tools individually. It was rejected for this session
because `@openai/agents`' exact `FunctionTool` shape wasn't verified
against real type definitions in this environment (no installed
`node_modules` types were available to confirm wrapping `execute`
wouldn't break argument validation, context threading, or whatever else
the library does around that function before/after calling it) — wrapping
blind risked a subtle regression across every tool in the registry, not
just the diagnostic ones. Explicit insertions mirror the
already-established, already-proven `recordEvidence` pattern used
throughout `apty.ts`/`devtools.ts`, are easy to review one tool at a time,
and only touch the 8 diagnostic tools that actually need budget/loop
tracking (not the other 43 browser/tab/UI tools, which don't participate
in investigation budgets). Revisit a generic wrapper once
`@openai/agents`'s `FunctionTool` contract can actually be checked against
its real types.

## Unify the Apty component model at the investigation layer, not the evidence layer

Apty ships two extensions — Studio, and one runtime extension that just
goes by several names (Client/Widget/Player) — not four. The fix could
have gone in at either of two layers: `EvidenceSource`
(`apty/types.ts`, used by every diagnostic tool when recording a finding)
or `AptyComponentKind` (`apty/investigation-session.ts`, used when the
model states which component it suspects). This session unified at the
investigation layer only, leaving `EvidenceSource` as
`"apty-client" | "apty-widget" | "service-worker" | "apty-studio" | ...`
unchanged. Reasoning: `EvidenceSource` answers "which probe produced this
evidence" — a `client-status` entry and a `widget-status` entry really did
come from two different `chrome.scripting.executeScript` calls against two
different globals, and collapsing that distinction would make evidence
harder to debug and would touch `evidence-store.ts`, `evidence-correlation.ts`,
every tool in `apty.ts`, and every existing test for all of them — a much
larger and riskier change for no real benefit, since nothing about
correlation or evidence storage cares which *product* component an
evidence source belongs to. `AptyComponentKind` answers "which Apty
product component does the investigation concern" — a product-facing
question where the four-way split was actually wrong and worth fixing.
The UI (`component-health.ts`) then re-derives the two-group presentation
from the still-granular evidence at render time (aggregation, not data
loss) — see `ARCHITECTURE.md`'s "Apty integration layer".

## Removed `debugger-manager.ts`'s extension-iframe deletion outright, no replacement mechanism

Phase 17 of the engineering-automation master prompt asked to audit
`debugger-manager.ts` for destructive page manipulation and, if found,
"determine whether it is actually required... replace with safer
mechanisms where possible." The audit found `ensureNoExtensionFrame()`
(removed this session) with no comment explaining its purpose, no test, no
scoping to this extension's own id, and — checked directly — nothing in
this codebase injects a `chrome-extension://` iframe into a page today, so
there was no way to even reconstruct what bug it might have been working
around. Given no evidence it was required, the decision was to remove it
outright rather than build a "safer" replacement for an unverified need
(e.g. scoping the removal to this extension's own id would still be
deleting page content on every attach, just less broadly wrong). If a real
CDP attach failure is ever observed that correlates with an extension
iframe being present, the correct fix is to reproduce it, understand the
actual Chrome-level cause, and handle that specific failure explicitly
(e.g. retry, or a clear error message) — not to preemptively mutate the
customer's page as a blanket precaution.

## Why no external investigation orchestration loop this session

**Superseded in part by the entry above** — a later session did build the
recommend+guardrail layer this entry's own last paragraph anticipated
("a tool that explicitly says 'you have not called X yet, consider it'...
just extended"). The reasoning below for why a *full* external
control-flow loop (overriding the model's own tool-selection from outside
`packages/core`) remains out of scope still holds and is kept for
context.

The engineering-automation master prompt's own P0 list includes an
"investigation orchestration loop" (plan → execute → observe → evaluate →
decide, external to the model). This session implemented every other P0
item (component model, planner, structured hypotheses, verification
guard) but deliberately did not attempt this one. Reasoning: this
codebase's actual execution loop — which tool to call next, when to stop —
lives inside `packages/core`'s wrapper around `@openai/agents`' `run()`;
the model itself is the orchestrator today. Building a *second*,
deterministic orchestration layer that decides what the model should do
next would mean either (a) constraining or overriding the model's own
tool-selection loop from outside `packages/core` — a real architectural
change to the agent's control flow, not an additive tool — or (b) another
tool the model can *choose* to call for a suggestion, which is not
meaningfully different from what `get_investigation_plan`/
`get_investigation_status`/`get_investigation_timeline` already provide
(decision-support data, not control flow). Doing (a) safely requires
understanding `packages/core`'s `run()` loop deeply enough to know where
to intercept it without breaking existing tool-calling behavior across
every other tool in the registry — a large, separate investigation in its
own right, and not something to bolt on alongside the same session's
component-model/planner/hypothesis/verification-guard work without a much
higher risk of a subtle regression. Recommendation for whoever picks this
up: start by reading `packages/core/src/agent/aipex.ts`'s `run()` call and
`@openai/agents`' loop-control hooks (if any) before writing any
orchestration code — the answer may be "there's no clean interception
point without a fork," in which case the honest scope for "orchestration"
in this codebase is exactly the decision-support-tools approach already
taken, just extended (e.g. a tool that explicitly says "you have not
called X yet, consider it" based on the plan vs. what's been called).

## Investigation planner is a deterministic pattern registry, not a second LLM call

`investigation-planner.ts`'s `planInvestigation()` matches the problem
description against a small `PLAN_TEMPLATES` array with plain string
matching (`.includes()`), not a second model call asking "what should the
plan be?". This keeps planning instant, free, deterministic, and testable
(8 unit tests covering every category plus the fallback) — appropriate
for what the plan actually needs to be: a starting checklist the model can
consult and deviate from, not a load-bearing decision. An LLM-generated
plan would add latency, cost, and non-determinism for a component that
explicitly does not need to be authoritative (the model is told the plan
is advisory). If real usage shows the five hardcoded categories are too
coarse, the fix is adding more entries to `PLAN_TEMPLATES` — a small,
localized change — not switching the mechanism.

## The "no unverified confirmed diagnosis" guard lives in the store, not the tool

`updateInvestigation()` (`apty/investigation-session.ts`) itself downgrades
an unverified `confidence: "confirmed"` to `"likely"` — not
`tools/investigation.ts`'s `updateInvestigationTool` wrapper. Any future
caller of `updateInvestigation()` (another tool, a test, a future UI
action that writes to the investigation directly) gets the same guarantee
automatically, rather than needing to remember to re-implement the check.
The tool layer only adds a `warning` field when it detects the downgrade
happened (by comparing what was requested to what was returned) — it
doesn't own the rule, just reports on it.

## `InvestigationSession` is a new, separate store — not bolted onto `Session`/`ConversationData`

`core.Session` (LLM message history) and `ConversationData` (IndexedDB-persisted
UI conversation) already exist and serve a different purpose: they track
*what was said*, not *what the investigation currently believes*. Rather
than overload either with hypotheses/diagnosis/confidence fields, this
session added `packages/browser-runtime/src/apty/investigation-session.ts`
as its own `Map<conversationId, InvestigationSession>`, keyed exactly like
`evidence-store.ts` (including the same `"pending"`/unscoped-bucket
convention) so the two stay trivially joinable by conversation id without
coupling their lifecycles. An investigation can be cleared/restarted
independently of the chat history, and vice versa — conflating them would
have made "start a fresh investigation in the same chat" awkward to model.

## The side panel UI reads evidence/investigation stores directly, not through a message bus

`packages/browser-ext/src/lib/investigation/use-investigation-data.ts`
imports `getEvidence`/`getInvestigation`/`correlateEvidence` from
`@apty/browser-runtime` and calls them directly from a polling
React hook, rather than having the UI wait for the model to report state
back through a chat message, or introducing a new `chrome.runtime` event
bus. This works *only* because tool `execute()` functions already run in
the same JS realm as the side panel's React tree — verified against
`browser-agent-config.ts`'s `useBrowserTools()`, which passes tools
straight into `useAgent()` inside the side panel page itself, no
background-service-worker round trip. If tool execution is ever moved to
the background service worker (it currently is not), this hook would need
to switch to `chrome.runtime` messaging instead — flagging so a future
session doesn't assume the module-level `Map`s are always safely
shareable. Polling (not a bespoke event emitter) was chosen because the
data volume is small (bounded per-conversation stores) and it avoids
adding a new pub/sub mechanism for what is fundamentally "re-read some
in-memory state after a tool call likely changed it".

## Investigation lifecycle changes go through explicit tools, not implicit inference

`start_investigation`/`update_investigation`/`record_verification_attempt`/
`stop_investigation`/`get_investigation_status`
(`packages/browser-runtime/src/tools/investigation.ts`) require the model
to explicitly call them — the system prompt instructs it to do so at each
step of the debugging loop, but nothing infers "an investigation must have
started" from message content alone. This matches the project brief's "the
state must come from actual application state, not fake progress"
requirement: a UI status of "Analyzing" only ever reflects a real
`update_investigation` call the model actually made, never a guess based on
message length or keyword matching.

## Friendly tool-call names reuse the existing i18n `tools.*` translation layer

`packages/aipex-react/src/i18n/tool-names.ts`'s `translatedToolName()`
already existed (tool name → `tools.<name>` lookup, falling back to
Title Case) and is already wired into every tool-display variant. Rather
than build a second, parallel "activity description" mapping layer, this
session added Apty/investigation/selector tool names directly to
`i18n/locales/en.json`/`zh.json`'s existing `tools` object (with an emoji
prefix, e.g. `"get_network_diagnostics": "🌐 Checking network requests"`).
The raw tool name remains visible in expanded technical details (see
`DefaultToolDisplay`'s "Tool: `<raw_name>`" line, added this session) for
engineers who want it.

## No new UI framework/design system

The existing shadcn/radix-based primitives in `packages/aipex-react/src/components/ui/`
(Badge, Card, Collapsible, Dialog, Tabs, Tooltip) and `ai-elements/`
(Tool, CodeBlock, Suggestion) already covered every visual need for the
investigation-first redesign (component health list, evidence timeline,
diagnosis card, selector analysis). All new browser-ext UI
(`packages/browser-ext/src/lib/investigation/`) composes these rather than
introducing new dependencies, consistent with the project brief's "avoid
introducing a new UI framework unless necessary."

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

## Console/runtime event classification is a fixed regex taxonomy, applied after redaction, not a second LLM call or an ML model

`log-classification.ts`'s `classifyLogEntry()` is plain pattern matching
against a small, fixed set of categories (CSP, CORS, unhandled rejection,
JS exception, network-resource error, deprecation, Apty-specific, generic
console error/warning, info) — the same reasoning applied to the
investigation planner (see above): these categories have stable,
recognizable text signatures, so a second model call would add latency
and cost for a problem regex already solves deterministically and
testably. Classification always runs on the *output* of
`redactSensitiveText()`/`redactLogs()`, never before it — the classifier
only ever adds a label next to already-safe text, so it can never
reintroduce a secret redaction would otherwise have caught, and its
correctness doesn't depend on redaction's own correctness either way. The
CDP `Log.entryAdded` `entry.source` field is threaded through as an
optional `hint` rather than being the sole signal, because `source` is
CDP's own coarse bucket (`"javascript"`, `"security"`, `"network"`, etc.)
and doesn't by itself distinguish CSP from a generic security warning, or
a CORS failure from an unrelated network log line — text patterns remain
the primary signal, with the hint only resolving genuine ambiguity (e.g.
a CSP-adjacent message that doesn't literally contain "Content Security
Policy" wording). If real usage surfaces failure modes with unfamiliar
wording that consistently fall through to `"info"`/`"console-error"`, the
fix is adding another pattern to the fixed list — not switching the
mechanism, following the same precedent as the investigation planner's
`PLAN_TEMPLATES`.
