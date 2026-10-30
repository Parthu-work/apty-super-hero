# Status

What works today, what is still open, and where to look. History of how it
got here is in [`CHANGELOG.md`](../CHANGELOG.md) and
[`docs/development/STATUS_HISTORY.md`](development/STATUS_HISTORY.md).

## Working, with real-browser tests

`npm run test:e2e` runs each of these in Chromium against the built
extension (see [`tooling/e2e/README.md`](../tooling/e2e/README.md)).

- Chat with your own AI provider; the Connections page (Menu › Connections,
  or the "N to set up" badge) shows the model, the Apty Client and Studio
  connections and whether the page can be inspected.
- Risky actions wait for a click in the side panel and are refused if the
  tab moved to another site meanwhile; "Allow on this site for 15 min" is
  per tool and origin and can be revoked. Since A1 this covers clicks on
  submit controls, destructive or confirming labels and cross-origin links
  (`click` and `computer`), and `create_new_tab` to another origin; a URL
  with a long query or a non-web scheme always asks.
- DOM Health in same-origin, cross-origin, `data:` and frameset frames,
  open and closed shadow roots, and tabs opened before an extension update. Virtualized lists (B4) are reported
  as partial coverage with the rendered and declared row counts.
- DOM Health explains each element in Apty DES terms: which step finds it
  (checkInitialPath, Partial Selector, checkSimplifyDynamic,
  checkContainers, checkSimplifyNth/checkDirectElement) or why none does,
  the attributes left out as dynamic, the hit-test reason and a fix; each
  result counts elements per step and hit-test failures per reason.
- DOM Health validation bundle (B2): "Export validation bundle" in the DOM
  health page's header builds an allow-listed, strictly redacted JSON (frame tree,
  counts, overlays, thresholds, timings, route probe hashes, versions) and
  shows it for review before Download or Copy. Exported on all six
  application shapes in Chromium. Developer tools can override the
  unverified thresholds; every override is listed. Not yet run on a real
  tenant: the protocol is
  [`real-tenant-validation.md`](development/real-tenant-validation.md).
- Page console output (including during page load), network capture with
  opt-in response bodies, runtime diagnostics, screenshots, clicks and
  scrolling. The page-world script behind console capture and routing
  evidence can be turned off or excluded per site (B5), registered by the
  service worker.
- Apty Client logs and resource bodies, with named connection failures and
  a full-response viewer. The Data-handling deny list covers Client bodies
  too (A2): a listed resource returns `body_denied` with its metadata and
  the Client is never asked for the body. A JSON body comes with a structural summary
  (B3): item count, the union of item keys with their types, and how many
  whole items the preview holds, under 1,500 characters.
- Settings → AI (C1): "Fetch models" reads the provider's
  live model list (OpenAI-compatible, Anthropic and Gemini endpoints),
  with named errors and manual entry as the fallback; Test Connection also
  probes tool calling and flags a model that does not call tools. Presets
  audited: the Anthropic host now reaches the API, unverifiable model
  names were removed, Replicate and Perplexity are marked experimental.
  Tested against a mock provider, not real ones.
- Preflight (C2): Options → Connection → Preflight (`#preflight`)
  runs every demo dependency check with its exact fix and a copy button,
  exports redacted JSON and resets demo data; `pnpm demo:check` runs it
  end to end. Demo script: [`docs/demo/DEMO.md`](demo/DEMO.md).
- The MCP bridge: the extension never sends the token; the daemon proves
  it holds it first (HMAC challenge), every call is signed, and only
  published tools are forwarded (S6).
- Redaction mode (A3): Strict, Standard or Off (development only) in
  Settings → Data handling, with a Preview; Off needs a confirmation and
  shows a side-panel banner. Every caller goes through
  `runtime/redaction-mode.ts`, and a unit test fails on a direct call.

- Accessibility (C3, UI redesign): axe-core runs on every side panel
  surface (Home, the menu and its recent chats, Connections, every
  conversation state, the investigation summary, DOM health, DOM config, a
  page it can't inspect, boot) and every Options tab at 1280 and 375 px, in
  light and dark themes, and fails on serious or critical violations; none
  remain. Every flow also runs by keyboard alone
  ([`accessibility.md`](development/accessibility.md)).
- Every package has a coverage gate (C5): package-wide ratchets one point
  below the measured value, plus the stricter groups for approvals, sender
  checks, cross-extension messaging, capture and redaction; thresholds only
  go up ([`coverage.md`](development/coverage.md)). No test is skipped, and
  CI fails on a skip without a `// skip-reason:` (C4).
- The dependency check (`knip --strict`) blocks CI; exports kept only for
  tests are tagged `@internal`, which it skips.
- Data stored under the AIPex names is no longer migrated: a developer
  machine that holds only old-named data starts empty.

- Release rehearsal (D3): the Release workflow has a `dry_run` dispatch
  that builds, tests and packages without publishing, and checks the
  packaged key yields the pinned ID; `npm run release:dry-run` does the
  same locally. Branded Chrome and Edge are checked by hand
  ([`SMOKE_TEST.md`](release/SMOKE_TEST.md)).

- Widget network calls (Settings → Connection → Apty Client): the
  Client's own network calls, listed, filtered, downloaded and read body by
  body, with no AI model involved and only on click. URLs get the chat
  tools' URL policy and bodies the deny list and redaction; every failure
  names its fix. Tested against the e2e fake Client in Chromium, including
  a filtered download that records its filter text, status class and
  "shown N of M"; the real Client does not answer these messages yet
  (below). Covered by unit tests only, not in a real browser: a relative
  Client URL is masked under the current redaction mode (an unparsable one
  shows empty); a Client list of up to 5,000 calls is read and the newest
  1,000 kept; an older body answer never replaces a newer one. The
  reference `observedFetch` returns the Widget's Response before reading
  the body, and a response body over 1,000,000 characters is not served (the
  Agent hears `found: false`); a contract test with a mocked `chrome` checks
  this, not the real Widget.
- Visibility check (partial): "my workflow 'X' is not visible in the
  widget" (and the same for tooltips, launchers, announcements,
  validations, checklists and knowledge content) is answered in the chat
  with no AI model call. The agent reads the Client's 5.x content files
  through the deny list and redaction, runs the KB card's gates
  (published in this environment, hidden, nameless, segments, the
  widget's audience, the visibility rule) and shows a card with each
  cause, its evidence, fix and KB card, or the next check when the files
  show no blocker. With no name it lists every item with a blocker. 4.x
  content is named as out of scope. Follow-up questions go to the model
  with the check in the chat's history; the model can also run it as
  `run_diagnosis`. Tested against the e2e fake Client in Chromium (both
  themes, axe-clean, no model request); not yet run against the real
  Client, which does not answer these messages yet (below).
- Request size (Settings → AI): with a request budget set, older tool
  results become stubs, long earlier messages are shortened and the oldest
  turns are left out (the first message sent says how many) until the
  request fits; a message that still cannot fit stops with a named error
  and is never sent. The answer length cap goes to the provider as
  `max_tokens` and applies from the next message. Both are off unless set.
  Tested in Chromium against the mock provider; sizes are estimates
  (characters / 4), not a provider's token count.
- Widget check (partial): "the Apty widget is not appearing", "works in
  Test but not in Production" or "only works on some pages" runs a widget
  pack with no model call. It matches the page in the conversation's tab
  against `app-urls.json`'s patterns as the KB cards describe them (by
  order, `*` a wildcard, anywhere in the URL) and names a page no
  environment covers, a pattern too specific for it, or a lower-order
  environment that wins; it reads the widget's audience from
  `app-data.json` (selected segments, the option for other users). The
  card shows no URL or pattern. A message that names a language also
  checks the item's name in it. Preflight warns when a deny-list entry
  hides the files the checks read. `evidenceFromHar` reads a HAR file the
  same way, deny list and redaction included; on the real 5.x capture it
  agrees with the earlier count (12 of 15 workflows hidden). Tested
  against the e2e fake Client in Chromium; not yet on a real tenant with
  a known failing case.
- HAR file check (partial): Menu › Check a HAR file runs the visibility
  and widget checks on a customer's HAR with no Client connected: the
  file is read in the panel only, never stored or sent, summarized by file
  names and counts, and checked with the same packs and card. "Ask about
  this result" hands the check's transcript, not the file, to a new chat.
  Tested in Chromium with a synthetic HAR (axe clean, no model request
  until Send, no file name or URL in the request); not yet with a
  customer's own export.
- Logs check (partial): a message that quotes a Console text the KB cards
  name, or asks about CSP, CORS, Apty's 404s or the errors in the logs, is
  answered with no model call from the Client's service-worker logs, its
  own calls and the console the page-world bridge buffered in the tab:
  "No active application found", "Error fetching data" or "Error parsing
  response", "[Apty] No matching version found", a failed content request,
  a CSP block or a failed load from a host the Client uses, and whether any
  of the Client's calls returned 404. Each source it cannot read is named.
  It cannot see what Apty logs in the page in Extension mode or CORS
  blocks, and says so. Tested against the e2e fake Client and a page that
  logs one of those texts, in Chromium.
- Selector and page checks (partial): "the Save tooltip is on the wrong
  element", "Apty cannot find the element for …", "step 3 fails" or "the
  selector stopped working" for a tooltip, launcher, validation or workflow
  reads the item's stored element from its file and runs the active
  selector in every frame of the tab the way the 5.x player does. It names
  an empty active field, no match, several matches, a hidden or off-screen
  match, a match only inside a frame or a shadow root the stored lookup
  does not reach, and a generated-looking value, each with its KB card;
  jQuery and custom-script selectors are not run. A workflow's steps come
  from its own file once the Client has loaded it (name and shape not
  verified on a real capture). "Apty cannot select any elements on this
  page" maps DOM Health's audit of the tab to the KB cards. The card shows
  counts, no selector or URL. Tested against the e2e fake Client and a page
  built to break each selector, in Chromium; not yet on a real tenant.
- A bare file request ("get segments.json") is answered the same way,
  through the `inspect_extension_network` tool and the full-response
  viewer with no model request; a follow-up pages that evidence through the
  model. Tested against the e2e fake Client in Chromium, the deny list
  included.

## Open

| Item | Needs |
|---|---|
| Narrow `<all_urls>` to Apty's target domains | Kept for 0.1.0, because customers run their applications on their own domains (same position as [`WEB_STORE_LISTING.md`](store/WEB_STORE_LISTING.md)); narrowing needs Apty's list of customer application domains |
| Agent bridge module in the Apty Client | The Client team ships [`docs/integrations/apty`](integrations/apty/README.md)'s module |
| Studio integration | The Agent side is done (D2: Settings row, handshake, `get_apty_studio_service_worker_diagnostics`, fixture e2e); Studio must allow-list the Agent and answer two messages ([`STUDIO.md`](integrations/apty/STUDIO.md)) |
| Validate DOM Health on a real athenaOne and Infor LN tenant, then tune thresholds | Both bundles returned. athenaOne works; LN's bundle led to four owner-approved rule changes (no-change clicks explored, placeholder frames, duplicate-id risk in the application view, hidden elements out of hit testing). Re-run LN with this build; thresholds stay untuned ([`real-tenant-validation.md`](development/real-tenant-validation.md)) |
| Remove the remaining explicit `any` | 588 in `tooling/scripts/any-baseline.json`; the rule warns and the baseline only goes down (D4) |
| LLM request safety and size | Phase A (O1-O5) is on `main`. Phase B: P4, the context budget, is built as the request budget (Settings → AI → Request size), with an answer length cap; P2 is built: a 1,258-token core sent on every call, plus each section of guidance only with its tools (a 10-turn investigation now fits an 8,000 budget); P1 is built: a short follow-up keeps the tools of the chat's last 3 tool-using turns; P3 is built: Anthropic requests mark the system prompt and the newest message for caching (not measured against a real provider). P5 is not started. Phase C not started ([`docs/tasks/llm/`](tasks/llm/00-rules.md)) |
| Production readiness | Still open: R6's icons (owner artwork, D6) and R9's human-only items. D1-D7 are unanswered and all defaults are applied provisionally ([`docs/tasks/prod/`](tasks/prod/00-rules.md)) |
| Widget network calls from the real Apty Client (partial) | The Widget team adopts the reference handlers and `observedFetch` ([`docs/integrations/apty`](integrations/apty/README.md)) and lists both Agent IDs. Open question: which Widget context makes calls such as `segments.json`; a content script would need a relay. Until then the panel names the Client's failure instead of listing calls |
| Visibility, selector and page checks on a real tenant (partial) | The real Client answering the network messages (above), then a run on a real 5.x tenant whose cause is known; membership and runtime rules stay open checks until the Client reports them. The selector check also needs a capture with a played workflow, to confirm the steps file's name and shape |
| GitHub secret scanning and push protection | A repository admin turns them on in Settings → Code security |

## Known limitations

- Page network-capture evidence carries a body preview (opt-in via
  response-body capture in Settings) that appears in
  `get_investigation_timeline`; `stop_network_capture` already returns the
  same text; free text in it is not caught by any redaction pattern.
- A URL inside prose or console output (for example a `run_console_command`
  result) is masked only when it is an absolute http(s) URL; a relative or
  non-http URL in free text reaches the model as it is.

## Where to look

- Problems: [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
- Privacy: [`PRIVACY.md`](../PRIVACY.md)
- Security findings: [`docs/security/SECURITY_AUDIT.md`](security/SECURITY_AUDIT.md)
- Releasing and the Web Store: [`docs/development/RELEASING.md`](development/RELEASING.md),
  [`docs/store/WEB_STORE_LISTING.md`](store/WEB_STORE_LISTING.md)
