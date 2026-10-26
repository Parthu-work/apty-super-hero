# Changelog

Meaningful changes to this repo, newest first. Not every commit is listed
individually where several form one logical change — see `git log` for the
full commit-level history.

## Unreleased

- **UI redesign (in progress, one PR)**: the side panel and Options page move to one design system. So far (WP1): the design's 18 colours are `--ds-*` tokens in both themes, and the semantic variables (background, card, primary, muted, border, input, ring, info, success, warning, destructive and new muted tints) point at them; a unit test keeps every text, control-border and status colour at its WCAG contrast. Inter 600 is bundled; monospace is the system stack; the type scale adds `text-small`, `text-title`, `text-display` and `text-score`; cards are 12 px round and dialogs 16 px. Button (40/44/32 px; new `primary` and `danger`), Badge (tone pills and `StatusBadge`, always an icon, dot or spinner plus the word), Alert, Input, Select, Textarea and Dialog are re-skinned on the tokens; Notice, OptionCard, ListRow, ProgressBar, ScoreRing, EmptyState and Skeleton are new. Dialogs now return focus to the button that opened them. `npm run audit:design-tokens` (a CI step, so `ci:local` has 24) fails on a hard-coded palette colour, hex or rgb literal, arbitrary or large text size, bold weight, uppercase or letter-spacing; WP2 took every one of those to zero in the side panel, Options and `@apty/ui` (the content script's host-page overlay, fake mouse and capture outline and the toolbar badge colour are exempt, as Chrome or the host page draws them). Section captions read in sentence case, and six Title Case labels became sentence case ("DOM health", "DOM config", "Automatic selection breakdown", "Manual selector dependency", "Cross-state selector replay"). Bold text is weight 600 and Inter 700 is no longer bundled. The syntax-highlighted code block gets its theme background again (its `hsl(var(...))` colours were invalid). Deleted, as the extension never renders them: `@apty/ui`'s default welcome screen with its UX-audit dialog, `LoginPrompt`, `ModelChangePrompt`, `UpdateBanner`, `ModeIndicator`, `ConfigurationGuide`, the chat theme presets and the compact and minimal tool displays. WP3: the side panel header is a Menu button, the app mark, the title "Apty Live Debugging" and a New chat icon; New chat asks before it stops a running reply, saves the chat at once and then clears it, and Alt+Left does the same (or goes back from a page). The menu is a drawer from the left (Esc closes it and focus returns to Menu) with New chat, the tools (DOM health, DOM config, Selector checker, Network inspector), the five most recent chats with their time and a delete action, View all, Connections and Settings; it replaces the header's settings and history buttons. A bar under the header names the page being inspected and whether it can be. DOM health and DOM config are full-panel pages with Back instead of cards above the composer, and the chat under an open page is inert. Home asks "What are we debugging?" with three investigations; See all adds the other two and DOM config. Typing / in the composer lists the tools, the investigations and the skills, filtered as you type and chosen with the arrows and Enter. `@apty/ui`'s Suggestion and ScrollArea components, which nothing used any more, and the `@radix-ui/react-scroll-area` dependency are removed. WP4: a "N to set up" badge in the bar under the header and on the menu's Connections row counts only what blocks: no AI provider, a configured Apty Client or Studio that does not answer, or a page the extension cannot inspect (a Client or Studio that was never set up is not counted), and hides at zero. The Connections page (from the menu or the badge) shows the AI provider, the Apty Client and Apty Studio, and whether this site can be inspected. Each peer has its status, an extension ID field checked with the existing rule, this panel's own ID to copy into the peer's allow-list, and a Connect button that checks and saves the ID the same way Options does. With no provider configured, the composer's model selector is a "Set up AI provider" chip, and a message sent anyway still shows, unsent, in a warning notice with Set up and Dismiss. The readiness pills on Home are removed.
- **The migration of data written under AIPex names is removed (Part A)**: the extension is at 0.1.0, the Web Store listing does not exist, and the owner confirmed that no build was installed outside Apty developer machines, so there is nothing left to migrate. Removed: the `aipex_*` chrome.storage key renames (at start-up and on first read), the `aipex-conversations-db`, `aipex-screenshots-db`, `aipex-skills-fs` and `AIPexSkills` database moves, the `aipex-sessions` agent-session move and its fallbacks, the one-time import of the upstream's localStorage conversations, `aipex_last_capture_event` in "Delete everything", their tests, the legacy-storage e2e and the branding allow-list entries for those names. A developer machine that still holds data only under the old AIPex names starts empty; one that already ran a build from after R2 keeps its `apty-*` data.
- **`npm run lint:dependencies` (`knip --strict`) passes and blocks CI (Part B)**: step 23 of CI and `ci:local` now stops the build on a finding, instead of reporting 311. Deleted, as nothing in production reached them: the manual replay controller, the streaming state manager, the panel's old `filterNetworkCalls`, the upstream proxy's `createEmptyToolArgsFinalizer`, the unregistered `take_snapshot` tool with `capSnapshotText`, 12 unused types, constants and aliases, and 37 barrel re-exports nobody imported; the 18 tests that covered only that code went with it. 87 declarations only their own file uses are no longer exported. The 115 exports only tests import are tagged `@internal`, which knip's production mode skips. `react` and `react-dom` are now required peers of `@apty/ui` and `@apty/browser-runtime`, which import them; `ai` is a devDependency of `@apty/ui`, which imports only its types. `services/connection-test.ts` is now `connection-check.ts` and dom-snapshot's `health-hit-test.ts` is `health-hit-testing.ts`, because knip took both for tests. The explicit `any` baseline is 595.
- **Repo hygiene (C3)**: a script test fails if `CLAUDE.md` stops being the same as `AGENTS.md` (it is a symlink to it). The finished WP3, WP7, WP8 and WP9 specs moved to `docs/archive/tasks/`; `docs/tasks/README.md` says why the rest stay. `knip.json` marks the production entry files, so `npm run lint:dependencies` (`knip --strict`) analyzes the code instead of reporting every dependency unused; what it finds now is real and step 23 stays informational.
- **The rebrand from AIPex is finished (C1)**: `@apty/agent-core`'s `AIPex` class and `AIPexOptions` type are `AptyAgent` and `AptyAgentOptions` (no alias; the package is not published), and its console prefix is `[AptyAgent]`. The skills list moves from the `AIPexSkills` IndexedDB database to `apty-skills-db` on first use, like the other databases R2 moved. `apty-cli` reads `APTY_WS_URL` and `APTY_CONNECT_TIMEOUT`; `AIPEX_WS_URL` and `AIPEX_CONNECT_TIMEOUT` still work for one release, with a note on stderr. Chat screenshot links use `apty-screenshot.invalid` (the old host still resolves), the content script's snapshot message is `apty:collect-dom-snapshot`, the built-in skill-creator says it extends the Apty Agent (on a new install; an existing one keeps the description it stored), and `@apty/ui`'s unused `ContentScript` overlay (and its `aipex_open_omni`/`aipex_close_omni` actions) is removed. The branding check now fails on each of those old names.
- **DOM Config manual capture, import, page detail and three more tabs (step R4b)**: "Capture current state" adds a run of the tab in front exactly as it is (a modal, a form, a record) under a page name the SE types, without navigating, clicking or reloading, and says when the state was already captured under another name. "Import console script results" pastes or loads the console script's output as the runs of one page, keeps the valid runs and lists each failing one with what is missing; the script itself is one Copy away. Both add to the crawl's capture, or work without one, in the same report; a new crawl asks before it replaces them. Each page opens to its runs, what changed between them and a raw-profile download behind a page-data warning. New tabs: Iframes (application iframes needing handling first), Coverage (marks captured, not applicable or planned re-run the analysis and reach the Markdown) and Warnings (every warning, weak selectors, pages not ready with "Capture another run"). `PRIVACY.md` gains a DOM Config section and `docs/development/dom-config-runbook.md` is the SE runbook.
- **DOM Config card in the side panel (step R4a)**: a "Generate DOM config" tile on the start screen and a card after DOM Health run the whole capture from the panel: scope (this page, safe, or deep after a confirmation), runs per page, the behavior probe and limits; live progress per page with Stop; a report with the five settings tiles, every warning, the Ignore conditions laid out like Apty's builder with include and exclude per rule, and the Settings tab. Copy per value and per section, and Markdown and JSON export, contain only the included rules. DOM Config and DOM Health no longer navigate the same tab at once. Results stay in memory.
- **DOM Config captures a page once when the application links back to it with a cache-busting parameter**: starting on `/home`, a link to `/home?nocache=…` used to give a second `/home` page and spend one of `maxPages` on it. A state whose route identity matches a captured page apart from placeholder-valued query parameters is now listed `skipped`, "duplicate of …", and not counted. Literal query values (`?view=visits`) still make separate pages; Audit Application is unchanged.
- **DOM Config no longer reads a port as a record number**: `http://localhost:49321/frame.html` gave a record-specific `src Regex ^.*\d{5,}.*$` rule. Digits after the `:` of a `scheme://host:port` no longer count as a record number or a PII digit run; a record number in the same URL's path still does.
- **Dependencies: zod 4.6.7, undici 6.29.1, body-parser 2.4.0, fast-uri 4.2.3**: advisories published on 23–24 October made `pnpm audit --prod` fail. zod below 4.6.6 can exhaust memory validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5, high; the workspace packages now require `^4.6.7`, the MCP bridge overrides it to `^4.6.6`); the undici 6 copy that `@ai-sdk/provider-utils` pins has two denial-of-service advisories (GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685), fixed by a `@ai-sdk/provider-utils>undici` override that leaves openai's undici 7 alone; the MCP bridge's body-parser and fast-uri override floors move to the patched releases. THIRD_PARTY_NOTICES.txt follows.
- **DOM Config crawl (step R3)**: `runDomConfigCapture` crawls the application from the current page and captures each page or state two to four times, the second after a fresh visit (the URL loaded again, or the recorded clicks replayed from the start for a state a click reached), with the behavior probe, page and time limits, a stop signal and a return to the starting page. A fresh visit that shows another state is labeled `state-mismatch` and kept out of the rules. `captureCurrentState` adds a run of the tab exactly as it is, for modals and forms, without navigating. The crawl is Audit Application's: its traversal moved into a shared driver (`application-crawl.ts`) that takes the per-state work as a visitor, with the audit's behavior and tests unchanged.
- **Audit Application no longer fails a restoration because a frame answered late**: right after the seed URL was reloaded (or a recorded click replayed), the first read of the page could miss a frame that had not answered yet. The two fingerprints then compared `uncertain`, the restoration was failed as if the screen were different, and the branch was reported `not-discovered`. The state is now read once more after the DOM settles when that happens, before the seed check, each replayed hop, a direct URL load and the capture before a click. It made the click-only DOM Health e2e fail intermittently.
- **DOM Config writes one rule per condition list**: when a pattern such as `^ui-id-\d+$` was both seen changing between runs and found by shape, the engine wrote it twice, once per kind of evidence. It now writes it once, under the stronger evidence, with the values of both.
- **DOM Config collector and behavior probe (step R2)**: every frame of a tab, cross-origin frames included, is profiled by its own content script in the DOM analysis console script's JSON shape, with Apty's own markup, password managers and overlay vendors left out, the element behind each high z-index, each frame's real `src`, open and closed shadow roots, and bounded values. A three-second probe after the page settles measures mutation bursts for the debounce. Element fingerprints are not collected; `docs/development/dom-config.md` says why.
- **Withholding a URL path no longer takes seconds on a long run without an `@`**: the path policy found emails with a global regex that rescanned such a run from every character, about 14 s on a 100,000-character path. It now scans the path once and replaces the same emails; a test compares it with the regex on 5,000 generated paths.
- **DOM Config engine (step R1)**: `buildDomConfigReport` turns several DOM analysis runs per page into Apty DOM Settings values (ignore conditions, attribute priority, Shadow DOM, debounce, max z-index, ignore DOM events), each labeled measured, derived or default and each rule with its evidence. It validates the console script's JSON, reports what Apty's reconstructed defaults already ignore, never writes page data that is not identifier-shaped into a rule, and gives the same output for the same input. The noise list shared with DOM Health gains the confirmed Apty, password-manager and extension markers. See `docs/development/dom-config.md`.

- **Redacting a URL with many sensitive query parameters no longer takes seconds**: `redactUrl` re-serialized the whole query once for every sensitive parameter name, so 5,000 of them took about 6 s and 10,000 about 28 s. The query is now rebuilt once, with the same output, and parameter names are checked for a credential word with a scan instead of a regular expression built for each parameter.
- **The credential-word key/value pass no longer takes up to a second on long runs of credential words**: `token=…`, `api_key: …` and the like were found with a regex that, from every start in a run such as `token-token-…`, tried every place the credential word could sit in the key, about 0.5–1 s per call on 100,000 characters. They are now found by looking back from each `:` or `=`, in linear time and with the same matches; tests compare the scan with the regex it replaces.
- **Redacting text no longer takes seconds on long runs of letters and separators**: emails, URL userinfo and JWT-shaped strings were found with regexes that rescanned a run such as `a-a-a-…` from every word boundary in it, about 18 s per call on 100,000 characters. They are now found by scanning from each `@`, `://` or `.`, in linear time and with the same matches; tests compare the scans with those regexes.
- **An object or array under a hyphenated credential key in cut-off JSON text is masked whole in Strict and Standard**: the key scan for text that is not one JSON value now matches hyphenated names such as `X-Api-Key`, `x-auth-token` and `Proxy-Authorization`, so `{"X-Api-Key": {"v":"…"}` no longer keeps everything after a masked `{`. String values are masked as before and Off is unchanged. Where masking the value whole would cut short a match a later pass makes across it (a PEM block split across members), the result is the one from before, so it never shows more than it did.
- **More header and client credential names as JSON keys are masked in Strict and Standard**: the exact key list now includes `x_csrf_token`, `x_xsrf_token`, `x_session_id`, `x_amz_security_token`, `client_secret`, `authorization_token`, `private_token` and `x_access_token` (any case or punctuation), so a tool result such as `{"X-CSRF-Token":"…"}` or `{"clientSecret":"…"}` no longer reaches the model unmasked. Off is unchanged, and keys that only contain a credential word, such as `token_count` or `session_start_time`, are still not masked by name.
- **`X-Api-Key`, `X-Auth-Token` and `Proxy-Authorization` as JSON keys are masked in Strict and Standard**: the exact key list now includes `x_api_key`, `x_auth_token` and `proxy_authorization` (any case or punctuation), so a tool result such as `{"X-Api-Key":"…"}` no longer reaches the model unmasked. Off is unchanged.
- **PRIVACY.md's redaction table matches what reaches the model**: header lines and credential words in text are masked in Off too, JSON keys are matched by an exact list (now in the doc), and `redaction-table.test.ts` pins every row's Off column.
- **Client JSON bodies over 100,000 characters can be read** (the real
  Client's `rules.json` is 109,410): such a body is redacted value by
  value with the same redactor, up to 2,000,000 characters, instead of
  being withheld. It is still withheld when it is not JSON, holds one value
  over 100,000 characters, or has a match that would run from one value into
  the next; a test compares the result with whole-text redaction and fails on
  any secret the whole-text pass hides and this one shows.
- **Network calls read as unique requests, end to end**: the Settings
  panel and the chat's `list_extension_network_resources` group the Client's
  calls by method + URL without query ("32 unique requests (105 calls)"),
  with a count, a failed marker and a per-request history.
  `inspect_extension_network` and **View body** read the newest call that
  has a body, and say when it is an older one. The reference service worker
  keeps bodies per request (latest success and latest failure) under a
  total budget instead of for the last 10 calls, reports `hasBody` per call
  and a `reason` when a body is missing (both optional). See
  `docs/integrations/apty/CLIENT-PATCH.md`.
- **Redaction keeps a JSON body JSON**: a JSON object or array is redacted
  value by value with the same passes. A key the key/value pass treats as
  sensitive (`auth`, `session…`, `…token…`) now loses its whole value
  whatever its type, where a number came out as a bare `<REDACTED>` and an
  object or array lost only its first character; a string ending in
  `token=` no longer masks the values after it. Text that is not JSON, and
  JSON where a PEM block or URL userinfo match runs from one value into the
  next, are redacted as one text as before.
- A medical record number written in text (`MRN 4815162342`, `?mrn=…`) is
  masked in Strict and Standard; before, only an `mrn` key was.
- The chat tools redact the Apty Client's error text where they build their
  result; the outbound sanitizer already masked it before the model.
- `check-tag-on-main.test.mjs` no longer writes into the repository being
  pushed when the pre-push hook runs it from a linked worktree.
- **Groq chat works again**: Groq rejects a `strict: true` tool whose
  parameters have no properties (`connect_apty_client` and the other
  no-argument tools). For Groq hosts only, those tools are now sent without
  `strict`; tools with parameters and every other provider are unchanged.
- **Widget network calls** (Settings → Apty Integration → Apty Client): load
  the calls the Apty Client reports, filter them by text and by
  failed/4xx/5xx, read a response body, and download either as JSON, with no
  AI model involved. URLs get the chat tools' URL policy, bodies the body
  deny list and redaction, and every failure says what to change. The panel
  and `inspect_extension_network` share one path from a call to its body.
- The Widget team's reference service worker answers
  `list-observed-resources` and `get-resource-body`, recording the Widget's
  own requests through `observedFetch`; a contract test keeps it in step
  with the Agent's schemas. The Widget team still has to adopt it.
- Decided against an Agent-side `webRequest` recorder: a spike showed Chrome
  does not show one extension's requests to another.
- Widget network calls panel: a relative Client URL such as
  `/api/users/4815162342.json?dob=…` is masked under the current redaction
  mode (Strict hides the record number and query values, Standard the query
  values), and an unparsable URL shows empty, never raw. An older body answer
  can no longer replace a newer one, and a reload drops a body still
  loading. The list download records its filter text, status class and
  "shown N of M".
- A Client list longer than 1,000 calls is read instead of rejected as
  malformed: up to 5,000 are accepted and the newest 1,000 kept.
- The reference `observedFetch` no longer slows the Widget's own fetch: it
  returns the Response as soon as `fetch` does, reads the body afterwards
  from a clone (stopping at 200,000 characters; a longer body is not served
  and the Agent hears `found: false`), never throws a recording error into
  the Widget, records a relative URL as `fetch` resolves it in a service
  worker, and writes to session storage once the calls pause. Checked by the
  contract test with a mocked `chrome`, not against the real Widget.
- An Apty Client body longer than redaction can cover whole (100,000
  characters) is no longer redacted in part and stored cut off: it is neither
  shown nor stored, and `inspect_extension_network`, the Widget network calls
  panel and `get_evidence_json` say it was too large to redact safely. The
  body is now redacted once, after it is decoded, so a secret's placeholder
  no longer pushes a body at the limit over it, and base64 longer than the
  limit is no longer cut before decoding. Checked with unit tests and a
  mocked `chrome`, not against the real Client or Widget.
- URL masking fails closed: a URL that can't be parsed is shown as empty,
  never as its raw text; a relative URL, a `file:` URL and any string under a
  URL key (or a whole value shaped like a URL under any key) are masked like
  absolute ones; `file:`, `chrome:` and `chrome-extension:` URLs keep a real
  origin instead of `null`, and a local file's title is dropped in Strict.
  Prose and console text are unchanged. Checked with unit tests and a mocked
  `chrome`, not in a real browser.

## 0.1.0 — 2026-10-16

The first release of Apty Agent. Everything below shipped in 0.1.0; the
subsections keep the order in which the work landed, newest first.

### Production readiness (security, privacy and release)

- Model output can never load a remote image or media: Streamdown blocks
  remote `<img>`/`<video>`/`srcset`/CSS `url()`, and the extension-page CSP
  allows images and media only from `'self'`, `data:` and `blob:`.
- OpenAI requests send `store: false`.
- Deleting a conversation, the history cleanup and "Delete everything" also
  delete the agent's own session history; the last captured element is no
  longer stored.
- Every tool result, attached context and MCP reply goes through the URL and
  page-title policy of the redaction mode.
- The approval gate is tighter: console commands are never remembered,
  typing and clicking have separate grants, CSS values are checked, tab
  switching and closing are gated, DOM Health application-deep runs ask
  first, and form fills and skill runs show what they will do.
- The MCP bridge and the extension authenticate each other (HMAC
  challenge–response, signed calls) and the daemon publishes an allow-list
  of tools; grants are per requester.
- LLM rate limits and 5xx errors that happen before any output are retried;
  truncated JSON with a sensitive key is redacted to the end; page hooks fail
  closed; session snapshots no longer overwrite each other; the service worker
  catches unhandled rejections; offline errors say so.
- Unused dependencies and about 4,500 lines of dead code were removed, and
  `pnpm audit --prod` is clean with nothing ignored.

### Remaining audit gaps and production readiness

**Bugs**
- `get_apty_page_logs` now captures console output written while a page is
  still loading: the console bridge is bundled self-contained, so Chrome
  injects it before the page's own scripts instead of loading it through an
  async `import()`.
- The "agent is working" border shows on the page again, and pages no
  longer log "Access to storage is not allowed": the side panel messages
  the tab instead of the content script reading extension storage.
- An approval answered after an MCP call had timed out could still run the
  action. MCP-originated requests now expire after 40 s, leaving the action
  about 20 s before the bridge's 60 s timeout; the prompt shows who asked and the time left.
- Settings → General switches (response bodies, deny-list, verbose
  logging, skill execution) were never stored unless the user also saved
  the AI tab; they now save when flipped.
- A skill tag linked to a page that doesn't exist (`src/pages/options`).
- The welcome screen cut off its top in a short side panel.

**Security**
- The MCP daemon token travels in the WebSocket handshake
  (`apty-token.<token>` subprotocol) and a `?token=` URL is refused.
- Skills can no longer import packages from a CDN (remote code); the
  third-party model-list fetch and the unused host-access config are gone.
- CI runs CodeQL, a TruffleHog secret scan and a coverage gate on the
  security-critical modules; `npm run preflight` checks without rewriting
  files (`npm run fix` does that).

**UI**
- A readiness check on the welcome screen shows the model, the Apty Client
  connection and whether the page can be inspected, with links straight to
  the setting that fixes each one.
- Options tabs and sections have URLs (`?tab=connection#apty-client`):
  reload, Back and links work.
- Typing a provider's first API key turns it on; Save stays in view on the
  AI tab; every switch has an accessible name.

**Observability**
- All debug output goes through the leveled logger instead of being
  stripped at build time. Production builds log warnings and errors;
  Settings → General → Troubleshooting → Verbose logging turns debug logs on.

**Release and docs**
- Releases include a Web Store package without the manifest `key`.
- New: `PRIVACY.md`, `docs/TROUBLESHOOTING.md`,
  `docs/store/WEB_STORE_LISTING.md`, and a short `docs/STATUS.md` (the old
  round-by-round log is `docs/development/STATUS_HISTORY.md`).

### Fixes from the 2026-10-08 repository audit

**Security**
- Risky actions (running JavaScript, filling fields, typing, uploads,
  downloads) now wait for a click on Allow or Deny in the side panel. The
  model can no longer approve its own action: `confirm_risky_action` is
  gone. "Allow on this site" grants are per tool and origin, expire after
  15 minutes, and can be revoked on the options page.

**Privacy**
- Page response bodies are only captured when enabled under Settings →
  Data handling, with a host/URL deny-list.
- Stored conversations and screenshots are deleted after 7 days without
  use; the options page can delete them immediately.
- Debug console output is stripped from production builds (since replaced
  by the leveled logger; see the section above).

**DOM Health**
- Frames are answered by a React-free responder in every frame; a frame
  with no live responder (for example after an extension reload) gets it
  injected and is asked again. The UI mounts in the top frame only.
- Closed shadow roots are inspected through
  `chrome.dom.openOrClosedShadowRoot`; the stability wait covers every
  frame and shadow tree; the Agent's own UI is no longer counted.

**Apty Client**
- Connection failures name the cause (not allow-listed, bridge missing,
  timeout, malformed answer) and this Agent's ID; the options page runs
  the real handshake and offers Test connection.
- Full response bodies can be viewed, copied and downloaded from the tool
  result; evidence and investigations survive a side-panel reload or a
  service-worker restart.

**Found and fixed by the real-browser tests**
- The Options page's MCP bridge Connect button was always rejected as an
  "Unauthorized sender": privileged messages are now trusted by the
  sender's chrome-extension:// URL, not by the absence of a tab.
- The agent could not connect to the Apty Client unless the optional
  "Manage extensions" permission was granted.
- Custom tool views (the full-response viewer) never showed for tool calls
  folded into "thinking details".
- Bookmarks and history context logged errors when their optional
  permissions were not granted.

**Engineering**
- CI had stopped running any checks: `pnpm/action-setup` failed because
  the workflow and `packageManager` both named a pnpm version. The
  workflow now takes it from `packageManager`.
- Real-browser tests (`npm run test:e2e`, 23 tests) drive the real side
  panel and agent loop against a scripted model, fake Apty Client
  extensions and the real MCP daemon in Chromium, in CI; a tag-triggered
  release workflow builds, tests, zips and checksums the extension.
- `AIPex` defaults to 30 turns instead of 2000.

### Apty Client resource inspection: fixed the transport, verified against real Chrome

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

### Apty Client extension Service Worker network inspection (V1)

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
    `apps/mcp-bridge/src/tool-schemas.ts`: `connect_apty_client` (idempotent;
    falls back to the configured `clientExtensionId`, see `apty/config.ts`),
    `disconnect_apty_client`, `get_apty_client_connection_status`,
    `inspect_extension_network` (auto-connects if needed — the primary
    "Get segments.json" chat flow doesn't require a separate connect
    step), and `list_extension_network_resources` (answers "what
    resources did the Apty Client load?").
  - Options UI: a new "Apty Client Extension" panel
    (`apps/browser-extension/src/pages/options/apty-client-panel.tsx`,
    wired into the existing "connection" tab alongside the MCP bridge
    panel) lets the user configure the extension ID once via
    `setAptyIntegrationConfig` — the panel itself only persists the ID and
    validates it resolves to a real, enabled extension via
    `chrome.management.get` (callable from any extension page); the
    actual debugger attach/capture happens lazily in whichever context
    runs the chat tools, per `AptyIntegrationConfig`'s existing
    lazy-read-at-call-time pattern. Addresses
    `docs/development/PROJECT_PROGRESS.md`'s previously-open "Options UI panel for
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
`docs/development/PROJECT_PROGRESS.md` item 10 — still judged not worth the churn/
regression risk this session; the user-facing product surface already
says "Apty Live Debugging" throughout, per `browser-chat-header.tsx`/
`debugging-welcome-screen.tsx` from earlier sessions).

### Investigation-aware network capture session

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
    schemas added to `apps/mcp-bridge/src/tool-schemas.ts` (also now 54,
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

### Autonomous investigation orchestrator, MCP bridge tool-registry fix

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
- `apps/mcp-bridge/src/tool-schemas.ts` (the MCP bridge's static JSON-schema
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

### Console/runtime event classification

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
- `docs/security/SECURITY_AUDIT.md` finding #10: classification is pure pattern-matching
  over already-redacted text/metadata — no new permission, no new data
  read, no redaction-ordering risk.

### Unified Apty component model, investigation planner, structured hypotheses, verification guard, debugger-manager fix

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
  touch the page. See `docs/security/SECURITY_AUDIT.md` finding #8.

### Investigation session lifecycle + investigation-first side panel redesign

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
- A full side-panel UI redesign (`apps/browser-extension/src/components/investigation/`,
  new directory) turning the generic AIPex chat UI into an
  investigation-first Apty debugging console: a live-investigation banner
  + browser context bar in the header (real Stop action with a confirm
  dialog), a collapsible Timeline/Components/Diagnosis summary bar above
  the input, an Apty-specific empty state, and a dedicated selector-
  analysis visual (recommended selector, ranked candidates, iframe/Shadow-
  DOM boundary note, copy-selector button) replacing the raw JSON dump for
  `analyze_element_selectors`. All of it reads real evidence/investigation
  state directly from `@apty/browser-runtime` (same JS realm as
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
- `apps/browser-extension/vitest.config.ts` was missing the
  `@apty/ui/*` → source alias that `vite.config.ts` (the
  real build) already had, so tests couldn't resolve deep subpaths like
  `/lib/utils` or `/components/ui/*` that aren't in `aipex-react`'s
  `package.json` exports map but do resolve at build time via that alias.

### Evidence correlation, investigation timeline, selector diagnostics

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
- A gap matrix in `docs/development/PROJECT_PROGRESS.md` auditing the repo against the full
  product specification (evidence correlation, investigation sessions,
  selector diagnostics, UI redesign, security hardening, tool cleanup),
  identifying what's done, partial, or not started with priorities.
- 58 new tests: `evidence-correlation.test.ts` (17), `evidence-store.test.ts`
  (8), `selector-analysis.test.ts` (29), `investigation.test.ts` (3),
  plus evidence-recording coverage added to `apty.test.ts` (1) and a new
  `devtools.test.ts` (2).

**Fixed**
- `docs/security/SECURITY_AUDIT.md` finding 1b (no multi-session/multi-tab diagnostic
  isolation) updated from Open to Fixed, reflecting the prior session's
  isolation work — the finding's own status had not been updated when
  that work shipped.

**Not done this session** (see `docs/development/PROJECT_PROGRESS.md`'s gap matrix and Next
Steps): an explicit `InvestigationSession` lifecycle object (hypotheses,
verification attempts, final diagnosis+confidence) on top of the new
evidence store; the dedicated debugging-console UI (investigation state
banner, evidence panel, timeline, diagnosis card) — the side panel is
still a generic chat UI; network diagnostics start/stop capture session
UX; console/runtime event classification; self-healing/stale-UID
recovery; friendly tool-call-name UX; `host-access-config.json`/
console-bridge domain scoping (blocked on Apty's target domain list).

### Multi-session/multi-chat isolation

**Added**
- Per-conversation browser-tab binding: `ChatOptions.runContext`
  (`packages/agent-core`) is forwarded by `AIPex.chat()` to `@openai/agents`'
  `run()` as its `context` option, reaching every tool's
  `execute(input, context)` as `context.context`. Diagnostic tools
  (`apty.ts`'s 5 tools, `devtools.ts`'s 2 tools) resolve their target tab
  via a new `resolveDiagnosticTab()` (`packages/browser-runtime/src/tools/tab-utils.ts`)
  that prefers this bound tab over the previous unconditional
  `getActiveTab()` call, so evidence stays scoped to the tab a
  conversation is actually about even if the user's focus moves
  elsewhere. The binding itself is a `Map<sessionId, tabId>`
  (`apps/browser-extension/src/services/conversation-tab-binding.ts`), wired into
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
  (`apps/browser-extension/src/lib/browser-chat-header.tsx`'s
  `handleConversationSelect`) updated the UI's message list but never
  rebound the active agent session, so the next message sent after
  restoring an old conversation could silently continue a *different*
  conversation's actual agent memory. Now rebinds via `bindSession()`
  using the newly-persisted `agentSessionId`.

See `docs/development/PROJECT_PROGRESS.md`'s "Multi-Session Isolation — Implementation
Notes" and `ARCHITECTURE.md`'s "Conversation/tab binding" section for the
full writeup, including what's still a follow-up (best-effort first-turn
binding, no concurrent multi-pane UI within one window,
`InterventionManager`'s conversation mode not yet per-conversation).

### Engineering documentation package

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
  engineering handoff summary. Full page index in `docs/development/PROJECT_PROGRESS.md`'s
  "Confluence Documentation" section. This was a documentation-only task —
  no application code was changed to produce it.

**Fixed**
- Corrected a pre-existing inaccuracy in `docs/development/PROJECT_PROGRESS.md` and
  `ARCHITECTURE.md`: the tool-registry count was documented as 47 but is
  actually 41, verified directly against `allBrowserTools` in
  `packages/browser-runtime/src/tools/index.ts`. Also corrected a claim
  that bookmark/history tools are registered — their source files exist
  from the AIPex baseline but are not included in `allBrowserTools`.

### Apty Service-Worker diagnostics hardening

**Added**
- `docs/integrations/apty/apty-widget-service-worker.reference.ts` — a
  complete, adaptable reference implementation for the Apty Widget team's
  service-worker side of the Service Worker diagnostics integration: safe
  circular-safe log serialization, a bounded (1000-entry) buffer
  debounce-persisted to `chrome.storage.local` (survives MV3
  service-worker restarts), and a sender-validated `onMessageExternal`
  handler. Not part of this extension's build — hand-off documentation
  only, see `docs/integrations/apty/README.md`.
- 16 new tests for `service-worker-diagnostics.ts` covering both the
  extension-messaging and HTTP-endpoint paths: success, timeout,
  `chrome.runtime.lastError`, malformed response, oversized response,
  redaction, and endpoint-preference-over-messaging.

**Fixed**
- `service-worker-diagnostics.ts` now validates every external response
  against a Zod schema before use (previously an unchecked `as` cast) and
  redacts log messages before returning them (previously not redacted at
  all, unlike the Widget/Client providers) — see `docs/security/SECURITY_AUDIT.md`
  finding #4a.
- `get_apty_service_worker_diagnostics` now tags its result
  `scope: "shared-global"` with an explanatory note, so the agent doesn't
  falsely attribute a service-worker log (shared across every tab) to
  whichever tab is currently being investigated.

**Investigated, not implemented** (explicitly redirected mid-investigation
to the narrower Service Worker task above): full multi-session/multi-tab
diagnostic isolation. See `docs/development/PROJECT_PROGRESS.md`'s "Multi-Session Isolation
— Research Notes" and `docs/security/SECURITY_AUDIT.md` finding #1b for what was found —
in short, every diagnostic tool operates on whichever tab is currently
active rather than a conversation-bound tab, and the fix is to thread a
`context` object through `@openai/agents`' existing (currently unused)
`RunContext<Context>` mechanism.

**Tests**: 656 passing (was 640; +16 for `service-worker-diagnostics.ts`).

### Apty diagnostics infrastructure

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
- `apps/browser-extension/.env.example` with Apty integration config
  placeholders (Studio/Widget/Client/Service-Worker extension IDs,
  service-worker diagnostic endpoint) — wired through `background.ts` →
  `chrome.storage.local` → `apty/config.ts`.
- `docs/development/PROJECT_PROGRESS.md`, `ARCHITECTURE.md`, `DECISIONS.md` (new),
  `docs/security/SECURITY_AUDIT.md` and this `CHANGELOG.md` rewritten/updated to reflect
  actual implemented state.

**Changed**
- System prompt (`packages/ui/src/components/chatbot/constants.ts`)
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
- `apps/mcp-bridge/src/tool-schemas.ts` updated to match the renamed/new tools.

**Tests**: 640 passing across all 5 packages (was 623; +7 for `redact.ts`,
+10 net from the tool-count increase not requiring new tests of their own
since they're thin Chrome-API wrappers — see `docs/development/PROJECT_PROGRESS.md`'s "Not
Implemented" test section for why).

### Earlier work

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
  ["http://localhost:*/*"]}` to `{"ids": []}` — see `docs/security/SECURITY_AUDIT.md`
  finding #1

**Added**:
- `apps/browser-extension/src/entrypoints/content/console-bridge.ts` — MAIN-world content
  script buffering console output/errors since page load
- Initial `get_apty_debug_logs` and `get_apty_widget_snapshot` tools (the
  latter later replaced by `get_apty_widget_diagnostics`, see above)

### Initial import

- Cloned from [AIPexStudio/AIPex](https://github.com/AIPexStudio/AIPex)
  (MIT licensed) as the starting point.
