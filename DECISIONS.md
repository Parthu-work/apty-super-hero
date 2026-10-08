# Technical Decisions

Key architectural decisions and why they were made, so a future session
doesn't re-litigate them without knowing the reasoning. Newest first.

## v5 mega-prompt: styling root cause and the first UI/product-shell slice (this round)

The v5 prompt supersedes v1-v4, adds WP16-WP21 (styling foundation,
navigation, Settings rebuild, first-run onboarding, chat polish, full
audit sweep) on top of carrying forward WP1-WP15, and introduces a hard
rule not present in earlier rounds: **never push to `main` or any remote,
commit locally only** — the owner applies the result manually (see
`DELIVERY.md` for this round's artifacts and commands). This round
followed the prompt's explicit work order (WP16 first, since nothing
visual could be judged before it) and completed WP16 plus the highest-
value slice of WP17-WP19; see the Phase 0 table in
`docs/development/PROJECT_PROGRESS.md` and `docs/audit/UI_AUDIT.md` for
the full accounting of what was and wasn't done, including several
findings only a real-browser check could catch (the font-file 404s, the
first-run console.error, the dead `mode-indicator.tsx` CSS, the inert
`not-prose` classes, and a first-run provider-seeding edge case) — see
those two files for detail rather than duplicating it here.

**Why a screenshot harness using the sandbox's pre-installed Chromium,
rather than deferring all real-browser verification to WP8**: the v5
prompt's own diagnosis of the WP16 bug was reached by a human manually
inspecting real Chrome, because the previous round had no way to verify
visual claims itself (jsdom has no real CSS layout engine). This
environment happens to have Chromium pre-installed with Playwright
already configured to find it, so building a lightweight (non-extension-
loaded) screenshot harness was low-cost and turned up two real bugs a
build-only check would have missed. It intentionally does not attempt
real MV3 extension loading (`chrome-extension://` origin, service worker,
`chrome.management`, cross-extension messaging) — that's WP8's job, and
substantially more involved (fixture extensions, a hostile-peer fixture, a
local test app with same-origin/cross-site iframes, exactness tests across
a service-worker restart). Building this lighter harness now and
reusing/extending it for WP8's real-Chrome scenarios later seemed better
than deferring all real-browser verification to a single large future
effort, per the prompt's own "prove it in real Chrome... mocked chrome.*
tests are necessary, not sufficient" rule.

**Why the BYOK gate toggle was removed rather than kept and just
restyled**: `use-agent.ts`'s own gating logic already treats "non-BYOK" as
a dead code path ("For non-BYOK (proxy) mode, always proceed" — but no
proxy exists in this product; `checkAuth()` in `app-root.tsx` already
states outright "there is no external login/proxy fallback"). A toggle
that gates the *only* mode the product actually has is pure friction, not
a real setting — removing it (while keeping `byokEnabled` as an internal
field, forced true, since `use-agent.ts`'s gating still reads it) was a
smaller, safer change than threading a "byokEnabled is now always true"
refactor through `packages/agent-core`'s `AppSettings` type and every
consumer of it, for a session already carrying a large diff.

**Why `onNeedsAuth` replaces pushing messages into chat state, rather than
just de-duplicating the two messages into one**: the v5 prompt's WP19
item 1 explicitly says "do not save the blocked message to history" — a
message that was never actually sent to a provider isn't a real turn in
the conversation, so writing a plausible-looking single message is still
the wrong shape. A dedicated handler that hands the draft text back to the
host app (rather than mutating shared chat state) keeps `@apty/ui`
agnostic to how the host chooses to show "you need to configure a
provider first", which matters since `@apty/ui` is meant to be reusable
beyond this one extension.

## v4 mega-prompt: what shipped, by work package (this round)

The v4 prompt (15 work packages, real-athenahealth/real-Chrome verified
behaviour, an explicit accuracy contract) supersedes the earlier v1-v3
prompts referenced in the entry below. Commits are on
`claude/confident-hawking-1b8l61`. Given the scope, this round targeted
the P0/security items and the most concretely-scoped, safely-verifiable
slice of each remaining work package, in roughly the session order the
prompt itself specified (WP1-4, then WP12, then WP5/6/13, ...).

- **WP1 (partial)**: JSON-aware, key-path redaction (`json-redact.ts`) —
  balanced-brace-aware so an object-valued sensitive key (`"cookie": {...}`)
  is redacted as a whole valid unit instead of the old regex partially
  consuming it and corrupting the JSON; `strict`/`standard`/`off` modes;
  `user_id` pseudonymized (stable, salted, non-reversible-in-practice) so
  repeated entries for the same user stay correlatable without exposing
  the real id; `page_title`/`page_search`/`page_path` handling. **Not
  done**: the Options "Data handling" UI (mode selector, body opt-in,
  deny-list, output preview).
- **WP2 (partial)**: `get-resource-body` promoted to a first-class v1
  verb with its own schema; `networkEntrySchema` updated to the v4 shape;
  added `contract.test.ts` (none existed).
- **WP3 (partial)**: stable manifest `key` (`generate-extension-key.mjs`)
  so this extension's own id is stable across reloads/checkouts —
  prerequisite for any future allow-list. The reload-loses-connection bug
  itself was already fixed in the prior round's WP3 work (config seeding
  never overwrites a user value). **Not done**: `peers:{client?,studio?}`
  shape, `AptyPeersPanel`, `VITE_APTY_ALLOWED_PEER_IDS`.
- **WP6**: `apty-error` classification now requires level error/warn, not
  just the Apty pattern — an info-level line mentioning "apty" no longer
  gets mislabeled as an error.
- **WP9 (partial)**: `minimum_chrome_version: "116"`, deduplicated
  `host_permissions` (`<all_urls>` alone already covered the other two
  entries), `web_accessible_resources.assets/*` now sets
  `use_dynamic_url:true` (the code already resolves these via
  `chrome.runtime.getURL()`, so no source changes needed) — note CRXJS's
  own auto-generated `web_accessible_resources` entry for its
  content-script loader chunks stays `use_dynamic_url:false`, which is
  the build tool's own required behaviour, not something this fix
  touches. **Not done**: the rest of the permissions audit / `PERMISSIONS.md`,
  AIPex dead-code removal, mcp-bridge `daemon.ts` auth (still the
  documented, unfixed gap from the prior round).
- **WP12 (partial, the biggest piece this round)**: `useChat`'s
  sendMessage/continueConversation/regenerate now wrap their pre-steps
  (`getRunContext`/`selectTools`/`rollbackLastAssistantTurn`) in
  try/catch/finally — previously a rejection there left the status stuck
  on "submitted" forever with no recovery. `AIPex.normalizeError()` now
  actually classifies errors (`classifyLlmError`, by HTTP status or
  message heuristic) into the error-code enum's existing but previously
  unused `LLM_RATE_LIMIT`/`LLM_AUTH_ERROR`/`LLM_TIMEOUT` values instead of
  always returning `LLM_API_ERROR`/non-recoverable. `ChatAdapter`'s
  "error" case now appends a plain-language line to the transcript
  (`formatAgentErrorForDisplay`) instead of only flipping `status` — a
  failure was previously invisible except for the submit button's icon
  turning into an X. A message sent while a turn is in flight is now
  queued (FIFO) instead of starting a second concurrent `agent.chat()`
  call on the same session; the already-built-but-unwired `queueCount`
  input-area UI is now actually driven. Stop now works during
  "submitted", not just "streaming". **Not done**: retry/backoff with
  jitter, time-to-first-token/stream-inactivity/total-run watchdogs,
  lowering `maxTurns` from 2000 (deliberately skipped — risky without the
  paired "step limit reached — Continue" UX, and this codebase's own
  multi-tool investigations can legitimately need far more than 30 turns),
  client-side rate/token throttling, per-call LLM diagnostics, the
  fake-LLM-server test harness.
- **WP13 (partial)**: DOM Health card's header no longer squeezes its own
  title — split into a title row and a separate `flex flex-wrap` actions
  row (couldn't verify pixel-level behaviour without real Chrome). Copy
  is now robust (`copyText`: awaits the Clipboard API, falls back to
  `execCommand`, never throws) with visible checkmark feedback where
  there was previously none at all; a Download action now exists on
  chat messages (`downloadText`, Blob+anchor with a `chrome.downloads`
  fallback) — previously Download existed nowhere except Skills.
  `clipboardWrite` permission added. **Not done**: Copy/Download on
  tool-result cards/evidence/the whole conversation, CSV export, the
  320/360/420px axe + screenshot regression suite.
- **WP14**: `chrome.storage.local`/`session` now restricted to
  `TRUSTED_CONTEXTS` at background startup — the isolated-world content
  script (registered on `<all_urls>`) could previously read LLM API keys
  and peer approvals out of `storage.local`. Verified (not assumed)
  Streamdown's untrusted-markdown rendering: raw `<script>`/event-handler
  attributes never render, and `linkSafety` (enabled by default) gates
  every link behind a confirmation dialog rather than a direct `<a
  href>` — added `response.test.tsx` since no test existed. **Not
  done**: the rest of the security-review checklist (item 3's broader
  policy layer for untrusted-content-triggered actions, `pnpm audit`,
  the hostile-page e2e).
- **WP4/WP5/WP7/WP8/WP10/WP11/WP15**: not attempted this round beyond
  what the prior round already did for WP5. Each is a substantial
  standalone effort; WP8/WP15 in particular need real Chrome + a real
  Apty Client + a real LLM provider, none of which this sandboxed session
  has.

Full monorepo suite: 1281 tests passing (was 1207 at the end of the prior
round), typecheck/lint/build/validate:extension/all audits green
throughout.

## Apty debug bridge: what actually shipped in this pass, and what's still open

Follow-up to the WP0 findings entry directly below, after implementing
WP1/WP2/WP5 in full and WP3/WP4/WP9 partially. Recorded here so a future
session picks up exactly where this one stopped instead of re-scoping the
whole WP0-WP10 brief from zero. Commit hashes are on `feat/apty-debug-bridge`.

- **Shipped, in priority order**: WP1 (redactor rewrite, `d0dceff`), WP2
  (`@apty/debug-contract` package, `d0dceff`), WP5 (console bridge rebuild —
  safe serialization, all-frames read, tamper-resistant buffer, `27f81e0`),
  WP4 security fix only (no tool accepts an `extensionId` from the model
  any more, `db6fd85`), WP9 quick wins (`ungroup_tabs` dedup + `audit:tools`
  gated in CI, `e29dc20`), WP3 practical fix (config seeding no longer
  clobbers user values; service-worker/client config split-brain fixed via
  fallback, `8c75077`).
- **WP4's remaining scope — `ExtensionPeerClient` consolidation, a
  build-time `VITE_APTY_ALLOWED_PEER_IDS` allowlist, required-identity-field
  ping validation, and the full
  not_installed/disabled/not_allowlisted_or_no_listener/timeout/
  contract_mismatch error-code taxonomy — was not attempted.** The
  security-critical half (the model can no longer supply an extension ID)
  is done; the remaining half is a larger refactor of three existing
  `sendExternalMessage`-shaped call sites and deserves its own dedicated
  pass with its own tests, not a rushed version bolted onto this one.
- **WP3's `peers: { client?, studio? }` shape unification, `configVersion`,
  and legacy-key migration was deliberately not done.** The two concrete
  bugs the task described (seeding clobbers user config; service-worker
  diagnostics reads a field the UI never writes) are both fixed
  (`updateAptyIntegrationConfig` / `seedAptyIntegrationConfigDefaults` in
  `config.ts`, and a `clientExtensionId` fallback in
  `get_apty_service_worker_diagnostics`). The bigger rename touches the
  Options UI, every diagnostics provider, and needs a migration test suite
  of its own — decided that shipping the two real bug fixes now was better
  than leaving both unfixed while a bigger rename was in flight.
- **`apps/mcp-bridge/src/daemon.ts`'s auth gap (High severity, found during
  WP0, NOT fixed): deliberately left alone this pass.** `isOriginAllowed()`
  accepts any `chrome-extension://*` origin and requests with no `Origin`
  header at all (not just this extension's), and `setExtensionSocket()`
  silently replaces an already-connected extension socket with whatever
  connects next — so any other locally installed Chrome extension that
  discovers the fixed `ws://127.0.0.1:9223` port can pose as the Apty
  Agent's own MCP bridge connection, hijacking an existing session or
  establishing its own. The fix design is straightforward (per-install
  secret token in a `0600` file, `crypto.timingSafeEqual` comparison,
  reject rather than replace a live `/extension` connection, pin the
  allowed origin to a specific configured extension ID once WP7's stable
  ID exists) but was NOT implemented: `apps/mcp-bridge` is a standalone
  project with no test suite, no way to exercise the real WebSocket
  upgrade handshake in this environment, and no real Chrome to verify a
  fixed extension-side connect flow against — per this task's own ground
  rule ("prove it in a real browser," WP8), shipping an unverified change
  to this specific security boundary was judged riskier than leaving the
  known gap documented here for a session that can actually test it
  end-to-end.
- **WP6 (tool renaming/consolidation), WP7 (Options UI rebuild, stable
  extension ID, producer hand-off docs), WP8 (real-Chrome e2e fixtures and
  tests), and the rest of WP9 (manifest hardening, AIPex dead-code removal,
  remaining doc rot) were not attempted this pass.** Each is a substantial
  standalone effort; see the final report delivered alongside this commit
  for the full accounting.

## Apty debug bridge (service-worker logs + connected-app console logs): WP0 findings and the ADRs they justify

Investigation performed before any code changed, per the mega-prompt's own
"determine, don't assume" instruction. Findings, each independently
confirmed against the actual source (not re-derived from the prompt):

- **Tool `execute()` runs in TWO separate JS realms**, each with its own
  independent copy of every module-level singleton in
  `packages/browser-runtime`: (a) the side panel's own React tree for
  normal chat (`apps/browser-extension/src/hooks/browser-agent-config.ts`
  imports `allBrowserTools` directly — no message hop to the background
  page), and (b) the background service worker, for the MCP-bridge path
  (`ws-mcp-server.ts`'s `executeTool()` calls `browserTool.invoke()`
  directly from inside the SW). Content scripts never execute tools.
- **Consequence for state persistence**: `evidence-store.ts`'s
  `evidenceByConversation` and `extension-network-inspector.ts`'s
  `activeExtensionByConversation` are both plain module-level `Map`s, no
  `chrome.storage` involved. The **side-panel-realm copy is not torn down
  by MV3 service-worker idle-restart** — it isn't in the service worker at
  all, and lives as long as the side panel stays open. The
  **background-SW-realm copy (used only by the MCP-bridge path) is** torn
  down by Chrome's SW idle-shutdown and respawns empty. This means the
  urgency of `chrome.storage.session` persistence is lower for the primary
  chat-driven flow than the prompt assumed, and higher specifically for
  MCP-bridge-driven tool calls. Decision: persist the peer-client's per-peer
  `seq` cursor and connection-approval state in `chrome.storage.session`
  regardless of realm anyway (cheap, and it's also good hygiene across many
  tool calls within one long-lived side panel session), bounded and with a
  TTL — but do not treat this as "fixing" MCP-bridge-path evidence loss on
  SW restart, which is a real, separate, larger gap the MCP-bridge
  architecture would need its own persistence design for (out of scope
  here; noted for a future pass).
- **Config split-brain, confirmed exactly**: `AptyIntegrationConfig` has
  five keys (`studioExtensionId`, `widgetExtensionId`, `clientExtensionId`,
  `serviceWorkerExtensionId`, `serviceWorkerDiagnosticEndpoint`) in one
  `chrome.storage.local` blob. The Options UI (`apty-client-panel.tsx`)
  only ever reads/writes `clientExtensionId`. `get_apty_service_worker_diagnostics`
  reads `serviceWorkerExtensionId` — a key with no UI at all, reachable
  only via a build-time env var. Setting the Client ID in Options has zero
  effect on that tool. Fixed by unifying to one `peers: {client?, studio?}`
  shape with a migration (see the config-merge change in this same pass).
- **Config-clobbering, confirmed exactly**: `seedAptyIntegrationConfig()`
  calls `setAptyIntegrationConfig()` — a full-blob `chrome.storage.local.set`,
  never a merge — unconditionally at background module top level, i.e. on
  every install/update/idle-restart. With an empty `.env` this silently
  wipes whatever the user saved in Options back to `undefined` on every
  service-worker wake. Fixed with `updateAptyIntegrationConfig(patch)`
  (merge semantics, mutex-serialized) and seeding that only fills unset
  keys.
- **`ping`/handshake must require identity fields.** Confirmed the
  previous status schema made every field optional, so an unrelated
  extension replying `{}` was reported "connected." Decision: `product`,
  `extensionId`, and `contractVersion` are REQUIRED in `pingDataSchema`
  (`@apty/debug-contract`) — an incomplete or wrong-shaped `ping` response
  is `invalid_response`/`contract_mismatch`, never treated as success.
- **The model must never supply an extension ID.** A prompt-injected page
  could otherwise steer a tool call at an attacker's extension. Decision:
  every tool that previously accepted an `extensionId` argument from the
  LLM now only ever addresses IDs the user approved in Options (or a
  build-time allowlist); the parameter is removed from the tool's schema
  entirely, not just validated away, so the model has no way to even
  attempt supplying one.
- **Pull, not push.** The agent always initiates (`chrome.runtime.sendMessage`
  with a `apty-debug-agent:<verb>` envelope); a producer never calls the
  agent unsolicited. This keeps a producer's obligation to exactly one
  thing: a synchronously-registered `onMessageExternal` listener that
  checks `sender.id` against its own allow-list and answers known verbs —
  it never needs to discover or trust the agent's identity beyond that one
  check, and the agent never has to expose any listener of its own to a
  peer extension.
- **All page and peer text is untrusted, always.** Console/log content
  originates from a web page (which may be actively prompt-injecting) or a
  peer extension (which could be compromised or hostile, per the WP8
  `hostile-peer` fixture). Every tool result carrying such text is tagged
  `trust: "untrusted"`, and the system prompt explicitly instructs the
  model never to follow instructions found inside it.
- **`chrome.storage.session`, never `chrome.storage.local`, for anything
  this bridge buffers.** Log/network buffers can contain redacted-but-still
  page-derived content; `session` storage is memory-only and cleared on
  browser restart, so nothing from this feature is ever written to disk.
- **CDP is not used to reach another extension's service worker.**
  `chrome.debugger` can only attach to a target the extension has a debuggee
  handle for, and Chrome does not expose a supported way to attach the
  debugger to an arbitrary OTHER extension's service worker from outside
  it — there is no CDP path here at all, which is exactly why a producer-side
  contract (this bridge) is the only way to get these logs, not an
  agent-side capture trick.
- **`ungroup_tabs` is genuinely double-registered** (`tools/tab.ts:273` and
  `tools/tools/tab-groups/index.ts:144`, the latter with its own comment
  acknowledging the name collision) — confirmed, fixed by deleting the
  `tab-groups` copy and keeping `tab.ts`'s (the original, referenced
  elsewhere), then gating `audit:tools` in CI so this can't silently
  recur.
- **The mcp-bridge README's install command names a different, unrelated
  npm package than the one this repo publishes.** `apps/mcp-bridge/package.json`'s
  `"name"` is `apty-mcp-bridge`; both READMEs' `claude mcp add` command runs
  `npx -y aipex-mcp-bridge` — not a `bin` alias of this package, a
  completely different package name. `npx` resolves by package name, so
  this command fetches whatever (if anything) is published under
  `aipex-mcp-bridge`, never this repo's own code. Fixed by correcting both
  READMEs to `apty-mcp-bridge`.
- **`daemon.ts`'s `isOriginAllowed` and single extension-socket slot,
  confirmed exactly as suspected**: any `chrome-extension://*` origin
  passes, any connection with no `Origin` header at all passes, and a new
  `/extension` connection unconditionally replaces the previous one with no
  identity check. This is a real local-hijack surface — any other
  installed extension, or any local process willing to omit an `Origin`
  header, can steal or squat the channel.

## Apty DOM Health frame-addressing uses `chrome.webNavigation`, not `chrome.debugger`/CDP — and click-based state discovery is opt-in, off by default

A forensic audit found the previous DOM Health implementation sent every
content-script message via an un-addressed `chrome.tabs.sendMessage(tabId,
message)` while the content script is registered `all_frames: true` — on a
multi-frame page, every frame answered the same message and the caller got
back whichever response arrived first, and the collector separately only
ever recursed into `<iframe>` via `iframe.contentDocument` (blocked by the
browser for cross-origin frames, and never applicable to a legacy `<frame>`
either way). Combined with a scoring bug where zero analyzed elements
defaulted to a ~90+ "healthy" composite score, an enterprise application
shaped like Infor LN (a menu frame separate from the content frame,
same-URL menu-driven navigation) could be silently, misleadingly reported
as healthy while never actually being seen.

The fix (`apty/frame-tree.ts`, `apty/frame-audit.ts`) enumerates the tab's
real frame tree via `chrome.webNavigation.getAllFrames` and addresses every
message at an explicit `frameId` — never a broadcast. This was chosen over
reusing the existing CDP/`chrome.debugger` frame-tree code
(`automation/iframe-manager.ts`) that this codebase already has for a
different feature: attaching the debugger shows a visible "this page is
being debugged" banner and carries a heavier attach/detach lifecycle, which
would be a real, unrequested UX change for a feature designed to run
silently from the side panel. `chrome.webNavigation` needs no attach step
and is sufficient because this design never needs to map a specific DOM
`<iframe>`/`<frame>` element back to a `frameId` — each frame is audited
independently, addressed directly, never reached into from a sibling
frame's script.

Zero-evidence scoring is fixed by making `score: number | null` and adding
an `EvidenceState` (`HEALTHY_EVIDENCE`/`PARTIAL_EVIDENCE`/`NO_EVIDENCE`/
`INACCESSIBLE`/`FAILED`/`NOT_ASSESSED`) orthogonal to the score — `null`
score/`NOT_ASSESSED` grade exactly when there is no real evidence to
support a number, never a fabricated default.

Same-URL application states (a menu-driven transition that never changes
the URL) are detected via a structural state fingerprint
(`apty/state-fingerprint.ts`, built from `@apty/dom-snapshot`'s
`health-state-signature.ts`: heading sample, active nav item, container
counts) rather than assuming every transition is a `tabs.onUpdated`
navigation event.

Broadened discovery (`collectSafeNavigationCandidates` — menu/tab/tree
items with no real `<a href>`) is detected read-only by default and never
clicked automatically. `runApplicationDomHealthAudit`'s
`allowClickDiscovery` option (default `false`, no caller enables it today)
is the only thing that can turn a detected candidate into a real click, and
even then only after the content script re-verifies it's still inside the
safe container allowlist and non-destructive immediately before clicking.
This is deliberately conservative: the risk of an automated agent clicking
unknown controls on a live production enterprise application outweighs the
completeness gained by exploring menu-driven navigation without a human
opting in. See `docs/development/dom-health-architecture.md` for the full
model.

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
`docs/development/PROJECT_PROGRESS.md`'s "MCP Bridge Tool-Registry Fix & PR #11 Review" and
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
model's own tool-selection would mean either forking `packages/agent-core`'s
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
`packages/agent-core`) remains out of scope still holds and is kept for
context.

The engineering-automation master prompt's own P0 list includes an
"investigation orchestration loop" (plan → execute → observe → evaluate →
decide, external to the model). This session implemented every other P0
item (component model, planner, structured hypotheses, verification
guard) but deliberately did not attempt this one. Reasoning: this
codebase's actual execution loop — which tool to call next, when to stop —
lives inside `packages/agent-core`'s wrapper around `@openai/agents`' `run()`;
the model itself is the orchestrator today. Building a *second*,
deterministic orchestration layer that decides what the model should do
next would mean either (a) constraining or overriding the model's own
tool-selection loop from outside `packages/agent-core` — a real architectural
change to the agent's control flow, not an additive tool — or (b) another
tool the model can *choose* to call for a suggestion, which is not
meaningfully different from what `get_investigation_plan`/
`get_investigation_status`/`get_investigation_timeline` already provide
(decision-support data, not control flow). Doing (a) safely requires
understanding `packages/agent-core`'s `run()` loop deeply enough to know where
to intercept it without breaking existing tool-calling behavior across
every other tool in the registry — a large, separate investigation in its
own right, and not something to bolt on alongside the same session's
component-model/planner/hypothesis/verification-guard work without a much
higher risk of a subtle regression. Recommendation for whoever picks this
up: start by reading `packages/agent-core/src/agent/aipex.ts`'s `run()` call and
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

`apps/browser-extension/src/components/investigation/use-investigation-data.ts`
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

`packages/ui/src/i18n/tool-names.ts`'s `translatedToolName()`
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

The existing shadcn/radix-based primitives in `packages/ui/src/components/ui/`
(Badge, Card, Collapsible, Dialog, Tabs, Tooltip) and `ai-elements/`
(Tool, CodeBlock, Suggestion) already covered every visual need for the
investigation-first redesign (component health list, evidence timeline,
diagnosis card, selector analysis). All new browser-ext UI
(`apps/browser-extension/src/components/investigation/`) composes these rather than
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
dependency; only `apps/browser-extension` has `import.meta.env` access. Rather
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
name (`AIPex`), and `chrome.storage` key prefixes (`aipex-*`) were
*not* renamed. This is a deliberate scope decision, not an oversight: it's
a large, purely-cosmetic refactor with real regression risk (every import
path, every serialized storage key) for zero functional benefit. Revisit
only if there's a concrete reason (e.g. npm-publishing this fork under
Apty's own name) rather than "it still says AIPex somewhere."

**Update (repository restructure)**: the concrete reason arrived — this repo
was restructured into an `apps/`+`packages/` layout under Apty's own naming.
Package names were renamed (`@aipexstudio/*` -> `@apty/*`) and directories
moved to match (`packages/core` -> `packages/agent-core`,
`packages/aipex-react` -> `packages/ui`, `packages/browser-ext` ->
`apps/browser-extension`), since renaming a package name/directory doesn't
touch any serialized data. The other half of this decision still holds and
was deliberately *not* revisited: the `AIPex` class name and every
`chrome.storage`/IndexedDB key (`aipex-*`, `aipex_*`) are unchanged, because
those are real persisted-data contracts for existing installs, not cosmetic
branding — renaming them remains the large-regression-risk-for-zero-benefit
move described above.

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
code and in `docs/security/SECURITY_AUDIT.md`. A more exhaustive approach (e.g.
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

## WP1.7 (always-on `<all_urls>` MAIN-world console-bridge content script): owner decision — keep all-sites for now

The v6 mega-prompt's WP1.7 asks for `chrome.scripting.registerContentScripts`
against "an allow-list of hosts" in place of the static `<all_urls>`
MAIN-world console-bridge declared in `manifest.json`. Investigated this
round and the finding was escalated to the owner rather than resolved
unilaterally, because the two options trade off a core product property
against the permission's blast radius:

`docs/security/PERMISSIONS.md`'s own justification for `host_permissions:
<all_urls>` states the premise directly — "this product's whole purpose is
debugging *some other* web application the user has open, so it cannot be
scoped to a fixed domain list." The console bridge
(`entrypoints/content/console-bridge.ts`) is a passive buffer that starts
recording at `document_start`, before the extension has any way to know
which tab a future conversation will bind to, or whether the user opened
the side panel on this page at all — `get_apty_page_logs` reads it back
later, potentially minutes into a session, relying on it having been
buffering the whole time.

**Options presented:**
1. **All sites (current behavior)** — the bridge buffers on every page from
   `document_start`, so console/error history from before the side panel
   was ever opened on that tab is still available once a conversation
   binds to it. Cost: the broadest possible permission footprint — the
   bridge runs on every page the user's browser visits, debugging session
   or not.
2. **Only-chosen-sites toggle** — register the bridge dynamically (per-tab,
   or against a user-maintained allow-list), trading that pre-bind history
   away for a narrower, opt-in footprint. This is a genuine behavior change
   (console history before a conversation binds would no longer exist) and
   a MAIN-world injection-timing change (a dynamically registered script
   attaches later than a static manifest declaration would, risking a race
   against early page-load console output) that needs real-browser e2e
   coverage (the WP16 harness) to validate — a slow-loading page, a page
   that never binds a conversation, and a mid-session re-bind to a second
   tab — not something to ship from vitest + `validate-manifest` alone.

**Owner decision: keep option 1 (all sites) for now.** No code change this
round. Revisit in WP12 (security review / release readiness), where the
full picture (whatever else changed in host permissions by then, and
whether real-browser coverage for option 2 exists yet) will be clearer than
deciding it in isolation during WP1.

## v7 WP1 round: scoped to concrete correctness fixes, not the full peer-client rewrite

The v7 prompt's WP1 item 2 asks for a full `ExtensionPeerClient` rewrite of
the cross-extension transport (v1 envelope, `ping` identity handshake,
retry/timeout, cursor persistence, peer config migration). A prior
session's attempt at exactly this (reviewed before this round started, see
`docs/development/STATUS_HISTORY.md`'s "Audit of a WP1 draft") shipped that rewrite with 38
failing tests, zero tests on the new module, and the spec's own acceptance
fixture never built — i.e., attempting the structural rewrite and the
correctness fixes in the same pass produced neither reliably.

**Decision:** this round built the concrete, user-visible correctness
fixes (tolerant matching, bodies for every HTTP status, the PII
over-redaction bug, the model/user payload split, log output bounding, the
routing revert) directly on top of the EXISTING, proven legacy transport
(`sendExternalMessage` / `ConfiguredServiceWorkerDiagnosticsProvider`) —
the same transport the owner personally verified working live, end-to-end,
against the real Apty Client this session. The full peer-client/contract-v1
migration is deferred to a dedicated round, so it can be built and tested
properly rather than rushed alongside unrelated fixes. `@apty/debug-contract`
already has the full v1 schema ready and tested for whenever that round
happens — it was simply never wired up by any session yet.

**Trade-off accepted:** the deferred items (cursor persistence across
service-worker restarts, the full `PeerErrorCode` taxonomy's identity/
contract-mismatch cases, peer config migration) remain real gaps. None of
them block the actual demo path (pull Client logs / segments.json data),
which this round's acceptance fixture directly verifies end-to-end against
the real tool code.

## v7 WP4 H2: pnpm.overrides for dependency vulnerabilities

`pnpm audit --prod` at the start of this item found 76 advisories against
the root workspace (1 critical, 24 high, 43 moderate, 8 low), almost all
transitive — pulled in through `@modelcontextprotocol/sdk`'s own bundled
HTTP stack (`express`, `hono`, `ws`, `ip-address`, `fast-uri`, `qs`,
`body-parser`, ...) and a few unrelated leaves (`lodash`, `js-cookie`,
`tmp`, `nanoid`, `browserslist`, `minimatch`, `path-to-regexp`,
`@babel/core`). `apps/mcp-bridge` is excluded from the root pnpm workspace
(its own `pnpm-lock.yaml`, see the package architecture note at the top of
this repo's `CLAUDE.md`) and carried an overlapping but separate set of 55
advisories (1 critical, 11 high, 40 moderate, 3 low) against its own lockfile.

**Fixes applied:**
- Bumped `@modelcontextprotocol/sdk` to `^1.32.1` in both
  `apps/browser-extension` and `apps/mcp-bridge` (was `^1.26.0` /
  `^1.28.0`) — this alone resolved most of the `hono`/`ip-address`/
  `fast-uri` chain, since those are the SDK's own transitive deps and the
  newer SDK release line already carries patched versions.
- Bumped `ws` to `^8.21.0` directly in `apps/mcp-bridge` (was `^8.18.0`).
- Added `pnpm.overrides` to the root `package.json` (covering the
  workspace: `packages/*` + `apps/browser-extension`) and a **separate**
  `pnpm.overrides` block to `apps/mcp-bridge/package.json` (its own,
  independent lockfile needs its own override set — the root's overrides
  do not reach it) for the remaining narrowly-patchable leaf packages:
  `proxy-addr`, `minimatch`, `path-to-regexp`, `lodash`, `js-cookie`,
  `tmp`, `ws`, `hono`, `@hono/node-server`, `fast-uri`, `ip-address`,
  `nanoid`, `browserslist`, `baseline-browser-mapping`, `qs`,
  `body-parser`, `fflate`, `@babel/core`.
- One override (`@ai-sdk/provider-utils`) needed a second pass: the first
  attempt used an open-ended `>=4.0.33` floor, which pnpm satisfied by
  jumping all the way to the latest `5.0.56` — a different major line
  whose API had actually changed (`createProviderToolFactory` no longer
  exported the same way), which broke `apps/browser-extension`'s test
  suite at import time. Re-scoped to `^4.0.33` (same `4.x` line, just the
  patched minor) fixed it — a reminder that an override's *target* range
  needs the same major-version discipline as the dependency's own semver
  range, not just "anything higher."

**Result:** root workspace audit: 76 → 1 (down to a single high). mcp-bridge
audit: 55 → 0. Full `verify-quiet.sh typecheck lint test build audit` gate
green on both after the change, including `apps/mcp-bridge`'s own
`typecheck`/`test`/`build` run separately (it is not part of the root
`pnpm -r` fan-out).

**Accepted risk (documented exception):** `braces@3.0.3`'s stack-exhaustion
DoS advisory (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687) has **no patched
version published upstream yet** (`patched_versions: "<0.0.0"` — pnpm's own
way of saying "none exists"). It resolves only through `knip`
(`micromatch` → `fast-glob` → `knip`), a **devDependency** used solely for
the `lint:dependencies` script; it never ships in the built extension or
the `apps/mcp-bridge` CLI/daemon bundles. No override is possible until
upstream ships a fix. Recorded explicitly as `pnpm.auditConfig.ignoreCves:
["CVE-2026-93687"]` in the root `package.json` (which `pnpm audit --prod
--ignore-unfixable` writes automatically) rather than silenced via a CLI
flag in CI — so it's version-controlled, visible in a diff if anyone
touches it, and scoped to this one CVE ID only (a *new* braces advisory
would still fail `pnpm audit`). Re-check `pnpm audit` periodically and
drop the entry once a patched `braces` (or a `micromatch`/`fast-glob`/
`knip` bump that stops pulling it in) exists.

## v7 WP4 B5: CI workflow fixes

`.github/workflows/ci.yml` had several gaps found during this audit pass:

- **Missing `apps/mcp-bridge` install step — a real, currently-broken CI
  gap, not a hypothetical one.** `apps/mcp-bridge` is excluded from the
  root pnpm workspace (own `pnpm-lock.yaml`, see CLAUDE.md's package
  architecture note), but the root `typecheck`/`test`/`build` npm scripts
  all shell out into it (`typecheck:mcp-bridge`, `test:mcp-bridge`,
  `build:mcp-bridge`). Without its own install step, `pnpm install` at the
  workspace root never touches `apps/mcp-bridge/node_modules`, so every one
  of those three CI steps would fail trying to run `vitest`/`tsc`/`tsup`
  that were never installed. Added a dedicated
  `pnpm install --ignore-workspace` step scoped to `apps/mcp-bridge`
  (`--ignore-workspace` is required — without it pnpm walks up and tries to
  fold the install back into the excluded root workspace, as happened when
  testing this change locally).
- **No `pnpm audit` step.** Added one for the root workspace and a separate
  one for `apps/mcp-bridge` (its own lockfile, own exposure), both
  `pnpm audit --prod`. Both are safe to let gate the build now that H2
  brought both down to zero *unaccepted* findings (the root's one
  remaining `braces` finding is explicitly ignored via
  `pnpm.auditConfig.ignoreCves`, see the H2 entry above) — a newly
  introduced or newly disclosed vulnerability will fail the build as
  intended.
- **`knip --strict` (the `lint:dependencies` script) wired in as
  informational, not blocking.** It currently reports on the order of a
  hundred pre-existing unused-export findings (mostly `packages/ui`'s
  re-exported component prop types — a library package's public surface
  legitimately exports types its own internal code never references).
  Fixing those is a real but separate cleanup effort; gating the build on
  it now would block every PR on unrelated, pre-existing debt. Added with
  `continue-on-error: true` so the finding count stays visible on every
  build without blocking anything, and it can be tightened to blocking
  once that debt is paid down.
- **Added `packageManager: "pnpm@10.33.0"` and `engines.node` (matching
  Vite 7's own `engines.node: "^20.19.0 || >=22.12.0"` requirement)** to
  the root `package.json` — neither existed before, so nothing enforced
  that a contributor's local pnpm/Node version actually matched what CI
  runs.
- **Pinned the three GitHub Actions used (`actions/checkout`,
  `pnpm/action-setup`, `actions/setup-node`) to the exact commit SHA each
  moving tag (`v7`, `v5`, `v6`) currently resolves to**, with the human-
  readable version kept as a trailing comment. A tag can be
  force-moved by the action's publisher (or, in a supply-chain
  compromise, by an attacker who gains write access to that repo) to point
  at different code without the workflow file itself changing; a pinned
  SHA can't be silently repointed. Resolved via `git ls-remote --tags`
  against each action's repo rather than guessed, to avoid pinning a wrong
  or fabricated SHA.
- **Removed the unused `pull-requests: write` permission.** No step in
  this workflow posts PR comments, reviews, or labels — grepped the rest
  of `.github/workflows/` to confirm no other job relied on it being
  granted at this scope either. Left at the now-sufficient `contents:
  read`.

## v7 WP4 B3: skill sandbox — opt-in gate instead of a full rewrite

The skills feature lets a skill script run in a QuickJS VM that can
`import` CDN packages (fetched from `esm.sh` at runtime, executed
immediately) and make outbound `fetch` calls through a host-side bridge.
The audit found three concrete issues:

1. **No integrity pinning on CDN imports** (`quickjs-manager.ts`'s
   `loadFromCDN`): a skill's `import _ from "lodash"` resolves to whatever
   `esm.sh` currently serves as that package's latest version — if the
   registry or that package's publish pipeline is compromised, or a new
   "latest" is simply buggier/malicious, the same skill silently executes
   different code on its next run, with no record anywhere of what changed.
2. **The fetch bridge's SSRF guard has a documented residual DNS-rebinding
   risk** (`url-guard.ts`'s own module comment, unchanged by this round):
   `assertSkillFetchUrlAllowed` checks the hostname's resolved meaning at
   validation time, but the actual `fetch()` call resolves DNS again
   independently — an attacker controlling DNS for the target hostname
   could serve a public IP for the check and a private one for the real
   connection. Closing this fully would need a network layer that
   resolves DNS once and connects to the pinned IP directly, which isn't
   available through the browser `fetch()` API this bridge is built on.
3. **Zero test coverage existed for any of this** — `packages/browser-
   runtime/src/vm/` had no `url-guard.test.ts` and no `quickjs-manager.
   test.ts` at all before this round, despite being the two files this
   feature's entire security posture rests on.

**What this round actually did**, in order of confidence:

- **Added `url-guard.test.ts`** (22 tests) covering `isIPv4`/
  `isPrivateIPv4`/`isPrivateIPv6`/`assertSkillFetchUrlAllowed` directly —
  every range comment in that file now has a corresponding assertion,
  including the IP-literal-obfuscation case (confirming, same as M2, that
  the WHATWG URL parser normalizes those before this code ever sees them).
- **`requirePinnedVersion()` in `quickjs-manager.ts`**: `loadFromCDN` now
  rejects any CDN import specifier without an explicit version (`lodash`
  → rejected, `lodash@4.17.21` → accepted; same rule for scoped packages).
  This doesn't add cryptographic integrity (no subresource-integrity hash
  pinning — `esm.sh` doesn't publish per-file hashes to check against), but
  it does close the specific "same import silently resolves to different
  code tomorrow" failure mode: a pinned version resolves to the same
  published artifact every time. Added `quickjs-manager.test.ts` (7 tests)
  for the new function.
- **Left the DNS-rebinding risk as-is**, documented rather than attempted —
  a real fix needs a different network primitive this extension doesn't
  have access to from a content/background script context. Revisit if/when
  this feature needs that level of hardening (e.g. via a native messaging
  host that can resolve+pin the IP itself).
- **Gated the entire feature behind a new, off-by-default settings
  toggle** (`AppSettings.skillExecutionEnabled`, `packages/agent-core/src/
  config/settings.ts`) rather than attempting to fully close item 1/2 under
  this round's time constraints — exactly the escape hatch the original
  spec suggested. Enforced at the one real choke point
  (`execute_skill_script`'s tool handler in `packages/browser-runtime/src/
  tools/skill.ts`, checked via `ChromeStorageAdapter`/`STORAGE_KEYS.
  SETTINGS` — same idiom as the WP4 B1/B2 approval gate) and, as cheap
  defense-in-depth, at the sidepanel's QuickJS/ZenFS pre-warm (`apps/
  browser-extension/src/entrypoints/sidepanel/index.tsx` — now skips
  initializing the VM at all when the flag is off, rather than merely
  refusing to run scripts later). The other skill tools (`load_skill`,
  `read_skill_reference`, `get_skill_asset`, `list_skills`,
  `get_skill_info`) are **not** gated — they only read bundled
  SKILL.md/reference/asset files or list metadata, never execute code or
  make network requests, so gating them would only block legitimate
  "what does this skill do" inspection for no security benefit. Exposed in
  Settings UI (`packages/ui/src/components/settings/index.tsx`, general
  tab) as an explicit toggle with a destructive-styled warning describing
  exactly what enabling it allows. Added `skill.test.ts` (4 tests)
  confirming the gate blocks by default, blocks when explicitly false,
  runs when true, and does NOT block the read-only tools.

**Trade-off accepted:** this is deliberately not "skills are now fully
SSRF-proof and supply-chain-safe" — it's "skills are off by default, and
a user who turns them on sees an explicit warning naming the actual risk."
Full hardening (DNS pinning via a native host, SRI-style hashing if/when
`esm.sh` or an alternative CDN supports it) is deferred, consistent with
this round's standing discipline of honest partial fixes over rushed,
unverifiable completeness claims.

## v7 WP5: automatic LLM retry/backoff, scoped narrower than "everything recoverable"

`classifyLlmError` (`packages/agent-core/src/utils/errors.ts`) already
classified a thrown/rejected LLM error into a rate-limit/auth/timeout/API-
error shape and extracted `retryAfterMs` from a `retry-after` header — but
nothing ever acted on it. `AIPex.normalizeError` and `useChat`'s
`toAgentError` both just re-classify and yield an `error` event;
`retryAfterMs` was read back out in exactly one place
(`chat-adapter.ts`'s `formatAgentErrorForDisplay`) purely to build a
cosmetic "Retry in about Xs." string. `LLMError`/`LLMStreamError`'s
`retryDelay` field was dead code too — never constructed outside their own
test file.

**Fix:** wrapped the single real provider-call site —
`packages/agent-core/src/agent/aipex.ts`'s `await run(runAgent, input,
{...})` inside `runExecution` — in a retry loop (`LLM_CALL_MAX_ATTEMPTS =
3`), backing off per `computeLlmRetryDelayMs` (honors the provider's own
`retryAfterMs` when present; otherwise exponential from 500ms, capped at
8s, with ±20% jitter). This is the one chokepoint shared by new-session,
continue-conversation, and regenerate paths — all three route through
`AIPex.chat()` → `runExecution()` → this one `run()` call — so one change
here covers all three without touching the UI/hook layer, which stays a
thin event consumer.

**Scoped to call-establishment failures only, never mid-stream.** The
retry loop wraps only the `await run(...)` call itself, not the
`for await (const streamEvent of result)` loop that follows it. A 429/5xx
from the provider is where this actually surfaces (the SDK throws before
yielding the async iterator on a non-2xx response); once token deltas have
started streaming to the UI, a retry would duplicate or garble output
the user has already seen, so that path is deliberately left to the
existing single `catch` as before — unchanged behavior there.

**Deliberately narrower retry trigger than "everything `classifyLlmError`
marks recoverable."** Only `LLM_RATE_LIMIT`, `LLM_TIMEOUT`, and an
`LLM_API_ERROR` with a *confirmed* `statusCode >= 500` are retried
automatically. `classifyLlmError`'s own fallback case — no HTTP status at
all, "assume transient" — is excluded from auto-retry. Two reasons: (1)
that fallback also catches bugs in our own code that happen to throw a
plain `Error`, and silently retrying those 3x would mask them behind a
multi-second delay instead of surfacing them immediately; (2) confirmed by
testing — the pre-existing test `"should emit error event when run
fails"` uses a bare `new Error("LLM failed")` with no status code, and an
initial broader implementation (retrying anything `recoverable`) made that
one test alone take ~1.6s of real wall-clock backoff before correctly
giving up — a real behavior regression on top of being the wrong default,
not just a test-speed annoyance.

Added 3 tests to `aipex.test.ts` using `vi.useFakeTimers()` +
`vi.advanceTimersByTimeAsync()`: a 429 that honors `retry-after` and
succeeds on the 2nd attempt with no `error` event; a 503 that exhausts all
3 attempts and surfaces the `error` event; and a 401 that is never
retried (1 call, immediate `error` event). See `docs/tasks/wp5-chat-
resilience.md` for what's still deferred from the original WP5 scope
(watchdogs/timeouts — `ToolTimeoutError`/`CancellationToken` remain dead
code, no `AbortSignal` is threaded from the Stop button to an in-flight
request or tool call — token budgeting, a fake-LLM test suite, and
network-level transport-error handling).

## v7 WP6: scoped to the 3 items verifiable without live-provider or live-browser testing

WP6 ("AI configuration and model management") has 8 items in its original
scope. A research pass mapped the current state of each against the
codebase first (not assumed) — several things the spec implies don't
exist already partly do: `customModels` already supports an arbitrary
OpenAI-compatible endpoint via "Add Model" (just not labeled as a distinct
"custom model" action), and `resolveActiveModel` already picks one active
model from potentially-multiple `enabled: true` entries. Ranked the 8
items by whether they could be validated with the tools actually available
in this session (unit/RTL tests, `tsc`, `biome`) versus needing a real
provider API or a real loaded Chrome extension, and implemented only the
former group:

1. **Free-text combobox for the model field** — replaced a conditional
   Select-or-plain-Input split with one `<Input>` + native `<datalist>`:
   preset models still suggest, but any provider now accepts an arbitrary
   model id (a new release not yet in the hardcoded preset list, a
   fine-tune, etc.) without switching providers to "custom" first. Chose
   native `<input list>`/`<datalist>` over building a new Radix
   Popover+Command-based combobox component — the repo has no Popover
   primitive yet, and native datalist gives the same "suggestions +
   free text" behavior with zero new dependencies, no JS-side filtering
   logic to get wrong, and no new accessibility surface to test.
2. **Local/private endpoint handling** — a UI-level info banner (not a
   confirmation gate the spec's wording suggested) under the API Host
   field, shown when the host resolves to loopback (Ollama/LM Studio).
   Judged a reassuring banner was the better UX for a case that's working
   exactly as designed (M2 already allows it at the enforcement layer),
   not a risk serious enough to require a click-through.
3. **Import/export of model configs** — reused the existing
   `downloadText`/`timestampedFilename` utilities
   (`packages/ui/src/lib/download.ts`, already tested, already handling
   the Chrome-API download fallback) rather than writing new Blob/anchor
   logic. API keys are stripped by default, included only via an explicit
   opt-in switch (default off) — "opt-in to leak credentials, not
   opt-out," matching the spec's exact wording. Imported models always get
   fresh ids and always start disabled, so an import can never silently
   become the active provider.

**Explicitly not attempted this round**: live model lists per provider,
auditing all 15 presets for OpenAI-compatible-adapter compatibility, Test
Connection improvements (specific-cause messages beyond the existing
numeric status prefix, latency, rate-limit headers, a tool-calling probe),
and true concurrent multi-model operation. Each needs either real calls
against multiple live provider APIs or touches the single-active-model
assumption through the chat/runtime layer, not just this settings page —
judged too large/unverifiable to attempt alongside the smaller, directly
testable items above. See `docs/tasks/wp6-ai-config.md` for the full
reasoning per item.

**Verification limitation, stated plainly, not glossed over:** this was
validated via the existing RTL test suite (renders the real `SettingsPage`
component against mocked `chrome.storage`) plus `tsc`/`biome`/build — not
against a real, loaded Chrome extension in a live browser. Attempting a
live check: a plain static-file or bare-HTTP serve of the built `dist/`
options page throws immediately on `chrome.tabs.onActivated` before any
render happens, outside a real extension context — getting a faithful
live render would need a Playwright `launchPersistentContext` with
`--load-extension`, judged out of scope for this specific change rather
than skipped silently.

## v7 WP4 follow-up: extending the approval gate to fill_*/computer/downloads

B1/B2 (this round, earlier commit `acab65d`) gated `run_console_command`
and `upload_file_to_input`. The original audit's own scope also named
"computer, fill_*, downloads, cross-origin tab creation, any extension-ID
contact" as needing the same treatment but deferred all of them. This
pass picked up the ones with a clear, narrow fit and explicitly left the
other two investigated-but-not-fixed, rather than force an ill-considered
gate onto either:

- **`fill_element_by_uid`/`fill_form`** (`packages/browser-runtime/src/
  tools/element.ts`) — gated in full via `gateRiskyAction`, same pattern
  as upload_file_to_input. These still take a model-supplied `tabId`
  directly (unchanged in this pass — narrowing that trust model to
  `resolveDiagnosticTab`, as `upload_file_to_input` was previously
  narrowed, is a separate, larger change touching `click`/
  `hover_element_by_uid`/`get_editor_value` too, not attempted here).
- **`computer`** (`tools/computer.ts`) — gated **only** the `type` and
  `key` actions (arbitrary text/keystroke injection), not `left_click`/
  `right_click`/`double_click`/`triple_click`/`scroll`/`scroll_to`/
  `hover`/`left_click_drag`. Gating the whole tool would have made basic
  pointer interaction — used constantly in any visual-automation task —
  prompt for approval on every new page origin, a severe usability
  regression for comparatively low-risk actions. This mirrors the
  existing, already-shipped distinction in `element.ts` itself: `click`/
  `hover_element_by_uid` are NOT gated while `fill_element_by_uid`/
  `fill_form` ARE — data-injection risk is what's gated, pointer
  interaction isn't, consistently across both the UID-based and
  coordinate-based tool surfaces.
- **`download_image`/`download_chat_images`** (`tools/tools/downloads/
  index.ts`) — gated in full. These have no page-origin concept at all
  (they write agent-generated data — a screenshot, a chat image — to the
  local filesystem, not content read from a page), so `gateRiskyAction`'s
  per-origin pageUrl is passed as `undefined`; its own existing fallback
  behavior for that case (never remember a grant, always re-prompt) is
  exactly right here and needed no special-casing.
- **`download_text_as_markdown`, `get_all_downloads`, `open_download`,
  `show_download_in_folder`, `cancel_download`, `download_current_chat_images`
  (a stub that always returns `success:false`)** — deliberately NOT
  gated. None of these write arbitrary new files to disk from
  attacker-reachable data the way the two gated download tools do; they
  manage *existing* downloads or save the user's own chat text.
- **"Cross-origin tab creation" and "any extension-ID contact"** —
  investigated, not fixed, reasoning recorded rather than silently
  dropped. `create_new_tab` (`tools/tab.ts`) is a core, extremely common
  browsing primitive (opening a tab is equivalent in risk to a user
  clicking a link); gating it would be a severe usability regression with
  no articulated, specific threat this round could confirm beyond "it
  navigates somewhere," unlike the concrete data-injection/disk-write
  risk the other gated tools share. "Any extension-ID contact":
  `sendExternalMessage(extensionId, ...)` (`apty/external-messaging.ts`)
  takes a parameterized `extensionId`, but grepping confirmed it is
  **not wired as an LLM-callable tool anywhere** — only called internally
  with a fixed, user-configured Apty Client extension id
  (`studio-diagnostics.ts`), never a model-chosen one. There is no live
  "contact any extension by ID" capability exposed to the model today to
  gate.

Added `element.test.ts` (6 tests), `computer.test.ts` (7 tests), and
`tools/tools/downloads/index.test.ts` (6 tests) — all three files had
zero test coverage before this pass.

## v7 M4: ZIP import caps, and a stale type shim that was quietly widening fflate's real types

`extractZipToFS`/`parseSkillMetadataFromZip`
(`packages/browser-runtime/src/skills/lib/utils/zip-utils.ts`) called
`unzipSync` directly on an untrusted uploaded skill ZIP with no caps at
all: a highly-compressed "zip bomb" could decompress to gigabytes in one
synchronous call before any of the extracted content was ever inspected,
and a `../../../etc/passwd`-style entry name was used directly to build
`${targetPath}/${relativePath}` with no path-traversal check.

Added `safeUnzipSync()`, wrapping `unzipSync`'s `filter` callback (which
fflate calls per-entry with the entry's *declared* size, before
decompressing it) to enforce, in order: reject any `..` path segment
(`SkillZipUnsafePathError`), a max 2000-entry count
(`SkillZipTooManyEntriesError`), a 20MB per-file cap, and a 50MB
cumulative-decompressed-size cap (both `SkillZipTooLargeError`) — the
per-file and cumulative checks both happen *before* that entry is
decompressed, so an oversized entry is rejected without ever being
inflated. Throws rather than silently skipping the oversized/unsafe
entries and extracting a partial result, since a half-installed skill is
worse than a clearly failed import.

**Found and fixed along the way**: `packages/browser-runtime/src/types/
external-modules.d.ts` had a hand-written `declare module "fflate" { ... }`
ambient shim declaring only a 1-argument `unzipSync(data): Record<string,
Uint8Array>` and `strFromU8` — far narrower than fflate 0.8.3's real
shipped types (which include the `filter` option and many more exports),
and an in-project ambient module declaration like this takes precedence
over a package's own types. This silently blocked exactly the capability
(`filter`, per-entry size inspection) needed to fix M4 properly, and
would have blocked it for any other caller too. Deleted the shim entirely
and confirmed (via `tsc --traceResolution`) that fflate's own `esm/
browser.d.ts` resolves correctly without it — this is almost certainly a
leftover from before fflate shipped usable types, never revisited. No
other file in the repo imports from `"fflate"`, so nothing else depended
on the narrower shape.

Added `zip-utils.test.ts` (8 tests, zero coverage before this round),
including a real 21MB single-entry zip-bomb-shaped test and a
54MB-across-three-files cumulative-cap test (each individually under the
per-file cap) — both using `fflate`'s own `zipSync` to build real test
fixtures rather than mocking the unzip step itself.

## v7 M5: optional_permissions for bookmarks/history/management, and a dead keyboard shortcut

**Keyboard shortcut**: `manifest.json`'s `open-apty-agent` command
suggested `Command+M` on Mac. Verified against Chrome's own extension
commands documentation (not assumed from memory) that OS-level window
management shortcuts "always take priority over Extension command
shortcuts and cannot be overridden" — Command+M is macOS's system-wide
"Minimize Window" shortcut, so this keyboard shortcut has never actually
fired on Mac. Chrome's own documented recommendation is a
`Ctrl+Shift+<letter>`/`Command+Shift+<letter>` pattern specifically
because single-modifier combos are the ones most likely to collide;
changed to `Ctrl+Shift+A`/`Command+Shift+A`.

**optional_permissions**: `bookmarks`, `history`, `management` were
unconditional `permissions` (granted at install, before the user has done
anything), each used by exactly one feature: `BookmarksProvider`/
`HistoryProvider` (ambient context on every turn) and the Apty Client
"Detect" panel's `chrome.management.get()` call. Moved all three to
`optional_permissions`, added an Options-page "Optional permissions"
panel (`entrypoints/options/permissions-panel.tsx`,
`services/optional-permissions.ts`) with a toggle per permission that
calls `chrome.permissions.request`/`.remove` from the toggle's own click
(a real user gesture — required, since Chrome rejects `.request` calls
made any other way).

**Why this was judged safe with zero changes at the three call sites**:
read each one first, rather than assuming. `BookmarksProvider` and
`HistoryProvider` already wrap their calls in try/catch and return `[]`
on failure; `extension-network-inspector.ts`'s `getManagedExtension()`
explicitly feature-detects (`if (!c?.management?.get) return undefined`)
before ever calling it. All three already treat "permission absent" as a
handled, non-crashing state — converting to optional permissions only
changes whether that state is ever reached, not whether it's handled.

**Trade-off accepted, stated plainly**: a fresh install now has
bookmark/history context and the management-based "Detect" check off by
default until the user opts in via the new panel — fewer scary bullet
points in Chrome's install-time permission prompt, at the cost of one
extra settings visit for users who want those specific features. This is
the standard, Chrome-recommended pattern (least-privilege by default,
explicit opt-in for extras) rather than a pure win with no trade-off, and
is called out as such rather than framed as a strict improvement.
`validate-manifest.mjs` was updated to check `optional_permissions`
entries against `docs/security/PERMISSIONS.md` the same way as
unconditional `permissions`, so a future optional permission still needs
a documented justification, not a loophole around the existing check.

Added `optional-permissions.test.ts` (6 tests) and
`permissions-panel.test.tsx` (5 tests, using `fireEvent` rather than
`@testing-library/user-event` — the latter isn't a dependency anywhere
in this repo, and wasn't worth adding for one test file).

## v7 WP4 dead-code cleanup: a live undisclosed third-party fetch, an unreachable external-message handler, and an incorrectly-scoped "aipex-* identifiers" item

Three small items, one of which turned out to matter more than its
"cleanup" framing suggested:

- **`ModelChangePrompt`'s default third-party fetch — a real bug, not
  just dead code.** `packages/ui/src/lib/models.ts` fetches a live model
  list from `https://www.claudechrome.com/api/models` — an unrelated
  third party, clearly left over from the upstream fork this project
  started from (`package.json`: "forked from AIPex"). A prior round
  already fixed the main model-selector path
  (`DefaultInputArea`'s `showServerModels={false}`,
  `apps/browser-extension/src/components/browser-chat-input-area.tsx`,
  with its own comment explaining exactly this risk) — but
  `ModelChangePrompt` (`packages/ui/src/components/chatbot/components/
  model-change-prompt.tsx`), rendered by `message-item.tsx` for an
  assistant message with `metadata.needChangeModel`, had **no such
  guard**: its own comment read "Fetch models from API (always runs — no
  longer gated on onFetchModels)." This directly contradicts the
  product's own Privacy card ("No analytics or telemetry are collected").
  Confirmed this specific path is not reachable *today* (`needChangeModel`
  is never actually set anywhere in the real message pipeline — only
  referenced in the type definition and this one render site), so no user
  has actually triggered this fetch yet — but it was one metadata flag
  away from firing, and the shared `packages/ui` component had no
  opt-in/opt-out mechanism at all for a future consumer, unlike its
  sibling. Added the same kind of explicit flag
  (`fetchFromServer`, default `false`) — matching `showServerModels`'s
  precedent exactly rather than inventing a different shape — so the
  built-in third-party fetch only runs when a host app explicitly opts in.
  Added `model-change-prompt.test.tsx` (3 tests, zero coverage before).
- **`external-messaging.ts`'s dead `onMessageExternal` listener.**
  `apps/browser-extension/src/entrypoints/background/external-messaging.ts`
  registered a `chrome.runtime.onMessageExternal` listener implementing an
  `"openWithPrompt"` action — by its own comment, "intentionally
  unreachable" since `manifest.json`'s `externally_connectable.ids` is
  `[]` (enforced by `validate-manifest.mjs`). Deleted the file and its
  registration in `background/index.ts`. Also deleted
  `app-root.tsx`'s `usePendingPrompt()` hook, the sole reader of the
  `aipex-pending-prompt`/`-timestamp` storage keys that listener used to
  write — with the writer gone, that hook was equally dead (always
  resolves to `undefined`), and its one call site
  (`<ChatBot initialInput={pendingInput}>`) now simply omits the
  (optional) prop rather than always passing `undefined`. Kept the
  `initialInput` prop itself on `ChatBot` — it's a generic, legitimate
  prop a host app could still use for other reasons, only this one
  specific *source* of its value was dead. Also fixed a stray branding
  leftover found in the same file: `console.log("AIPex background
  service worker started")` → `"Apty Agent ..."`.
- **"`aipex-*` identifiers" — scope-corrected, not completed as
  originally framed.** The original audit item described these as
  something to clean up alongside other dead code. Investigating found
  `aipex-`/`aipex_` is actually a **deeply embedded, active naming
  convention** across 19+ files — `STORAGE_KEYS`' own prefix
  (`aipex_settings`, etc.), a DOM attribute selector
  (`data-aipex-nodeid`) matched by CDP automation code, and more — not
  unused branding residue. Renaming a persisted storage-key prefix would
  silently "lose" existing users' settings on upgrade without a migration
  path, and renaming a functional DOM-attribute selector risks subtle
  automation breakage if any single call site is missed. This is a
  real, legitimate branding-consistency task, but it is **not** a safe
  "remove dead code" change — it needs a deliberate migration plan (e.g.
  read-old-key-as-fallback-then-write-new-key), which is a different and
  larger piece of work than what the original item's framing implied. Not
  attempted this round; flagging the scope correction here rather than
  either silently skipping it or renaming functional identifiers without
  a migration path.

## v7 WP4: leveled logger — built, not adopted at the 523 existing call sites

The original audit item was "replace `console.*` calls with a leveled
logger." Grepping confirmed the real scope: **523** `console.log`/`.warn`/
`.error`/`.debug` calls across **74 files** in `packages/browser-runtime`,
`packages/agent-core`, and `apps/browser-extension`.

Built the actual logger (`packages/agent-core/src/utils/logger.ts`,
exported from the package root): `createLogger(namespace)` returns a
`{debug, info, warn, error}` object that prefixes every call with
`[namespace]` — `createLogger("QuickJS").debug("loaded", url)` produces
byte-identical output to the existing `console.log("[QuickJS] loaded",
url)` convention already used throughout this codebase — plus a
process-wide `setLogLevel`/`getLogLevel` so a level can be raised (e.g. to
`"warn"` in a production build) without touching every call site again.
Defaults to `"debug"` (log everything), so adopting it anywhere is a pure
rename with zero behavior change until something explicitly calls
`setLogLevel`. 6 tests, all passing.

**Deliberately not migrating the 523 existing call sites this round.**
Several of them are read directly by existing tests
(`vi.spyOn(console, "error")`-style assertions appear throughout the
suite) — a mechanical codemod across 74 files risks silently breaking
those without a file-by-file check that this session's remaining budget
didn't allow for carefully. A single demonstrative migration of one or
two files was considered and rejected as arbitrary — it would prove
nothing beyond what the 6 unit tests already prove, while still leaving
521 sites unmigrated and the item just as "not actually done" either way.
Shipping the tested, ready-to-adopt module and saying so plainly was
judged more honest than a token partial migration dressed up as progress.

## Logger adopted; skills lose CDN imports; MCP token moves to the handshake

**Logger.** The 309 `console.log/info/debug` calls in source now go through
`createLogger`, converted by a syntax-aware script that skipped calls inside
functions injected into pages (none turned up). `console.warn/error` stay
as they are: tests assert on them, and they report real failures. The
esbuild `pure` stripping of debug calls is gone, because it also stripped
the logger's own output and made a support-time switch impossible. Each
extension context calls `initLogging()`: `warn` in production, `debug` in
development, and debug when Settings → General → Troubleshooting → Verbose logging is
on. Content scripts can't read settings, so they keep the build default.

**Skills.** The CDN loader was removed rather than pinned harder: no
integrity check is possible against `esm.sh`, and the Chrome Web Store
forbids remotely hosted code outright. Skills keep the built-in `fs`
module; anything else must be bundled into the script.

**MCP token.** The browser's `WebSocket` can't set headers, so the token
rides in `Sec-WebSocket-Protocol` as `apty-token.<token>` next to
`apty-mcp.v1`. The daemon answers with `apty-mcp.v1` only, so the token is
never echoed, and it refuses `?token=` outright rather than accepting both:
the extension and the daemon ship from this repository together.
