# Security Audit

Format per finding: Finding / Severity / Affected component / Risk / Current
mitigation / Recommended fix / Status. Findings are listed most-severe
first within each status group. This is a living document — update it
whenever a finding is fixed or a new one is discovered, don't just append.

## Fixed

### 1. `externally_connectable` allowed any localhost webpage to control the extension

- **Severity**: High
- **Affected component**: `packages/browser-ext/manifest.json`
- **Risk**: The manifest allowlisted `"http://localhost:*/*"`. Any web page
  served from `http://localhost` on **any port** — a dev server, a
  Docker container's exposed port, another compromised local tool — could
  call `chrome.runtime.sendMessage(extensionId, {action: "openWithPrompt",
  prompt: "..."})`, forcing the side panel open and injecting a prompt that
  gets auto-submitted to the AI agent (`usePendingPrompt` in
  `packages/browser-ext/src/pages/common/app-root.tsx`). Combined with the
  extension's broad permissions (`debugger`, `<all_urls>`), this is a real
  local-webpage-to-agent-action escalation path.
- **Current mitigation**: `externally_connectable` changed to `{"ids": []}`
  — no web origin and no other extension is allowlisted. The
  `onMessageExternal` handler in `background.ts` is now unreachable by
  design; a comment there explains why and warns against re-adding a
  wildcard.
- **Recommended fix**: Done. If external messaging is needed later (e.g.
  for the Studio integration), allowlist a specific, deliberately-chosen
  extension ID — never a wildcard host/port pattern.
- **Status**: Fixed (prior session, commit `2d94ffd`).

## Open — flagged, not fixed (needs Apty-side input to resolve)

### 2. `host-access-config.json` defaults to all sites

- **Severity**: Medium
- **Affected component**: `packages/browser-ext/host-access-config.json`
- **Risk**: `{"mode": "include-all", "whitelist": ["*.google.com"],
  "blocklist": ["youtube.com"]}` — the agent is permitted to act on every
  site the user visits except youtube.com. Combined with `<all_urls>` host
  permissions and `debugger`, the agent's tools can read/act on banking
  sites, personal email, or any other sensitive site open in the same
  browser, not just Apty-related applications.
- **Current mitigation**: None applied. This is inherited, unmodified
  AIPex default config.
- **Recommended fix**: Scope to Apty's actual target application domains
  (Salesforce, ServiceNow, Workday, Apty's own admin/studio domains, etc.)
  once that list is known. This was not done because inventing a domain
  list without Apty's input would be guessing, and guessing wrong here
  either breaks legitimate use (too narrow) or leaves the exposure open
  (too broad, e.g. accidentally matching an internal domain pattern).
- **Status**: Open. Needs Apty's list of target application domains.

### 3. Console-capture bridge runs on `<all_urls>`

- **Severity**: Medium
- **Affected component**: `packages/browser-ext/src/apty-console-bridge.ts`,
  registered in `manifest.json`'s `content_scripts` with `"matches":
  ["<all_urls>"]`
- **Risk**: This MAIN-world script wraps `console.log/info/warn/error/debug`
  and buffers every call, on every page the user visits — not just Apty
  pages. If the user is debugging on one tab while their banking site's tab
  logs something sensitive to console in the background, that would also be
  buffered (though it is not sent anywhere automatically — only returned
  when `get_apty_page_logs` is explicitly called by the agent against the
  *currently active* tab).
- **Current mitigation**: Sensitive-value redaction (`apty/redact.ts`)
  strips tokens/passwords/headers from anything returned via
  `get_apty_page_logs`, and the tool only reads the active tab's buffer,
  not every tab's. The buffer is in-page memory only — nothing is persisted
  to `chrome.storage` or sent anywhere until explicitly queried.
- **Recommended fix**: Scope the content script's `matches` to Apty's
  target application domains, same as finding #2, once known.
- **Status**: Open. Needs Apty's target domain list.

### 4. Apty Studio/Widget/Client/Service-Worker integration mechanisms are unconfirmed designs

- **Severity**: Low (currently — these paths are inert until configured)
- **Affected component**: `packages/browser-runtime/src/apty/*-diagnostics.ts`
- **Risk**: The `window.__APTY_WIDGET__`/`window.__APTY_CLIENT__` contracts
  and the Studio/Service-Worker cross-extension-messaging message types
  (`apty-debug-agent:get-studio-status`, etc.) are this session's proposed
  design, not confirmed with Apty's Widget/Client/Studio teams. If/when
  those teams implement something, the message payloads they send need the
  same untrusted-input treatment as any other page data (validate shape,
  don't trust free-form fields blindly) before being surfaced to the model.
- **Current mitigation**: All providers default to `NotConfigured*` stubs
  that return `status: "not_configured"` and empty logs — no live data path
  exists to secure yet.
- **Recommended fix**: When Apty implements a real handler, validate its
  response shape (e.g. with Zod) before returning it from the tool, and
  redact its log messages the same way `get_apty_page_logs` does (the
  current code already pipes Widget/Client logs through `redactLogs`;
  extend this to Studio/Service-Worker responses too once they're real).
- **Status**: Open, low priority until a real integration exists.

## Reviewed — accepted as inherent to the product category

### 5. `debugger` permission and `<all_urls>` host permissions

- **Severity**: Informational
- **Affected component**: `packages/browser-ext/manifest.json`
- **Risk**: `chrome.debugger` grants full Chrome DevTools Protocol access
  to any attached tab (network, DOM, runtime, ability to inject JS via
  `Runtime.evaluate` if ever used) — broader than what any single tool
  strictly needs at a time. `<all_urls>` host permissions let content
  scripts and `chrome.scripting.executeScript` run on any site.
- **Current mitigation**: `debuggerManager` auto-detaches after 30s of
  inactivity and on tab close (`packages/browser-runtime/src/automation/debugger-manager.ts`);
  no tool uses `Runtime.evaluate` to run arbitrary injected code — CDP is
  only used for `Input.*` (existing computer-tool automation) and, as of
  this session, `Network.*`/`Log.*`/`Runtime.enable`+`exceptionThrown`
  (read-only observation, no code execution). The broad permissions
  themselves are structurally necessary for the class of debugging tool
  being built, and — with governance in place at the org/policy level — are
  not something to remove without removing the DevTools-inspection
  functionality that's the point of the extension.
- **Recommended fix**: None from this codebase alone; this is a deployment
  governance question (MDM-forced install policy, restricting who can
  install the extension) more than a code fix. Findings #2/#3 (domain
  scoping) are the practical mitigation available at the code level.
- **Status**: Accepted risk, inherent to the product category.

### 6. API keys stored in `chrome.storage.local` in plaintext

- **Severity**: Informational
- **Affected component**: BYOK settings (`packages/aipex-react/src/components/settings/index.tsx`)
- **Risk**: No OS keychain integration; a user's Anthropic/OpenAI API key
  sits in the browser's local storage unencrypted.
- **Current mitigation**: None beyond what Chrome itself provides
  (`chrome.storage.local` is sandboxed per-extension, not readable by web
  pages or other extensions).
- **Recommended fix**: If centralizing key custody matters, route model
  calls through an Apty-owned backend instead of BYOK (see
  `DECISIONS.md`) — out of scope for this repo alone.
- **Status**: Accepted risk, standard limitation of extension-local BYOK.

## Checklist from the project brief (section 21) — current answers

| Question | Answer |
|---|---|
| Are permissions excessive? | Broad (`debugger`, `<all_urls>`) but consistent with what a browser-debugging tool needs; see findings #2/#3/#5 for the concrete scoping gap. |
| Can arbitrary extensions communicate with this one? | No — `externally_connectable: {"ids": []}` (finding #1, fixed). |
| Is the local WebSocket server (MCP bridge daemon) properly protected? | Yes — binds to `127.0.0.1` only, validates the `Origin` header and rejects all http/https page origins (`mcp-bridge/src/daemon.ts`), inherited from AIPex and reviewed this session; no change needed. |
| Can arbitrary tools be invoked via MCP? | Only tools in `allBrowserTools`/`toolSchemas` are invocable; there's no dynamic eval-based tool execution path. |
| Are incoming messages validated? | Internal `chrome.runtime.onMessage` handlers switch on a known `request` string and validate payload shape per-branch (see `background.ts`); the (now unreachable) external handler validated `prompt` as a string before use. |
| Are origins validated? | Yes for the WebSocket daemon (see above); N/A for `chrome.runtime.onMessage` (same-extension only) now that `externally_connectable` is locked down. |
| Could logs expose passwords/tokens/cookies/PII? | Mitigated via `apty/redact.ts`, applied to `get_apty_page_logs` and Widget/Client diagnostics logs; unit-tested (`redact.test.ts`). Not yet applied to hypothetical future Studio/Service-Worker log responses (finding #4). |
| Can arbitrary JavaScript be injected/executed? | No tool calls `eval`/`Function`/`Runtime.evaluate` with model- or page-derived strings. `chrome.scripting.executeScript` is used only with statically-defined `func` closures, never a dynamically-built string. |
| Can webpage content manipulate the AI agent (prompt injection)? | Not preventable at the code level for an LLM; mitigated at the reasoning layer — the system prompt explicitly instructs the model to treat page content as data, not instructions, and not comply with injected commands. |
| Can another local process connect to the debugging bridge? | Only if it doesn't send an `Origin` header (true of non-browser clients like the intended MCP CLI) — the daemon can't distinguish "a legitimate local Node MCP client" from "some other unrelated local process" by that signal alone. This is an accepted limitation of the loopback+no-origin allowance, inherited from AIPex; not changed this session. |
| Are extension IDs trusted/validated? | Cross-extension messaging (Studio/Service-Worker) is currently unreachable in practice (`not_configured` by default); when configured, `chrome.runtime.sendMessage(extensionId, ...)` only talks to the specific configured ID — no wildcard matching. |
| Are diagnostic APIs protected? | They only run in the context of the extension's own privileged code (background/tool execution), not exposed to web pages. |
| Could browser data unintentionally be sent to the LLM? | Redaction covers known-sensitive patterns; anything not matching those patterns (e.g. business data visible in the DOM/console that isn't a credential) is sent as-is, since that's the intended purpose of a debugging agent — the mitigation targets *secrets*, not all page data. |
