# WP1. Apty Integration pulls logs and response data perfectly (core job)

## Status this round: DONE for the items below; the rest explicitly deferred

This round scoped WP1 down to the concrete, test-verifiable correctness
bugs that are the actual substance of "pull logs/data perfectly," rather
than attempting the full wire-protocol rewrite (item 2's `ExtensionPeerClient`)
in the same pass — doing both at once, untested, is exactly the failure
mode found in a prior draft of this work (38 failing tests, zero tests on
the new peer-client module, the acceptance fixture never built). See
`REVIEW.md` for the full round summary.

**Done, with tests (`packages/browser-runtime/src/apty/wp1-acceptance.test.ts`
is the permanent regression fixture for all of these together):**
- Item 1 (routing reversal): system prompt (`packages/ui/src/components/chatbot/constants.ts`)
  and investigation planner (`investigation-planner.ts`'s `retrieve-resource-data`
  category) both now try the Apty Client/cross-extension path FIRST, with
  page-level capture as the explicit fallback — reverting `c17c241`/`7c37064`'s
  capture-first ordering.
- Item 4, tolerant matching: `matchResources` (`extension-network-inspector.ts`)
  now matches case-insensitively, singular/plural (`segments.json` ↔
  `segment.json`), extension-optional, and ignores the candidate URL's
  query string. A new `matchKind: "tolerant"` is exposed so the model can
  say what it matched and how.
- Item 4, "did you mean": `suggestClosestResourceNames` ranks observed
  resource names by edit distance with observation counts, surfaced as
  `suggestions` on a `not_observed` result.
- Item 4, "several matches, say which was chosen": `inspectResource`
  returns `alsoMatched` (the other candidate names) whenever more than one
  resource matched.
- Item 4, bodies for every status: `inspectResource` now fetches and
  returns the body for a 4xx/5xx response too (previously it returned a
  bare failure with no body for `status >= 400`) — the 403/XML acceptance
  case is asserted directly.
- Item 4, two audiences: a JSON-parseable body now gets a bounded,
  structured model-facing summary (`response.json`: item count, top-level
  keys, a ≤5-item sample) instead of a blind character-truncated slice of
  a potentially 100kB+ array. The FULL body still goes to evidence,
  untruncated, for the user-facing viewer. A new `get_evidence_json(evidenceId,
  path, limit, offset)` tool (`evidence-json-query.ts` + a tool in
  `extension-network.ts`) lets the model page through the full stored body
  afterward without re-fetching.
- Item 3, log output control (partial — see deferred list): `listServiceWorkerLogs`
  now defaults to a 50-entry limit, supports `minLevel`, truncates individual
  messages to 500 chars (`full:true` to expand), collapses consecutive
  identical lines into one with a `repeatCount`, and returns a `header`
  with per-level counts and whether the limit cut anything off.
- WP3 item 1 imported as a hard WP1 dependency: `@apty/debug-contract`'s
  `PII_KEY_NAMES` no longer treats a bare `name` key as personal data (it's
  overwhelmingly configuration data — a segment/flow/feature name — in
  real Apty payloads), while still redacting genuinely person-identifying
  keys (`firstName`/`lastName`/`fullName`/`displayName`/`username`/etc).
  This was required for the acceptance test's "names intact" assertion to
  even be meaningful, and was independently a real, user-reported bug.

**Explicitly deferred (not silently dropped — tracked here for the next round):**
- The full `ExtensionPeerClient` in `packages/browser-runtime/src/apty/peer/`
  replacing every `sendExternalMessage` call site with the `@apty/debug-contract`
  v1 envelope, a `ping` identity handshake, the full `PeerErrorCode` taxonomy,
  timeout+retry (5s/8s+1 retry), and legacy-verb fallback. The contract
  schema itself already exists and is tested (`packages/apty-debug-contract`,
  added in an earlier round) but is currently unconsumed — the existing
  `ConfiguredServiceWorkerDiagnosticsProvider`/`sendExternalMessage` transport
  this round built on top of is the legacy path, proven working end-to-end
  live this session.
- Cursor pagination persisted in `chrome.storage.session` across service-worker
  restarts (`sinceSeq`/`nextSeq`) — `listServiceWorkerLogs`'s new `limit`
  is an in-memory-per-call cap, not a persisted cursor.
- Peer config migration to `peers:{client?,studio?}` shape, `chrome.management`
  uninstalled/disabled event invalidation, Studio sharing the same client.
- Tool renaming to the spec's suggested canonical names
  (`get_apty_connection_status` etc.) with legacy aliases for `apps/mcp-bridge`
  — the existing tool names (`connect_apty_client`, `inspect_extension_network`,
  etc.) were kept as-is since renaming without the underlying peer-client
  rewrite would be cosmetic churn for no behavior change.
- Page-level capture's `Target.setAutoAttach` for cross-process iframes,
  header allow-list, and a rolling per-tab recorder readable after the fact.
- A polished JSON tree viewer component in the chat/evidence UI — the
  backend split (bounded model summary + full evidence + `get_evidence_json`
  query tool) this depends on IS built; the UI component itself is WP7 scope.
- The configurable/raised per-body cap for allow-listed configuration
  endpoints.
- A real-browser (Puppeteer/Chrome-for-Testing) end-to-end run of the
  acceptance scenario — WP8 scope. This round's acceptance fixture
  exercises the real tool-level code paths (not a rewritten contract)
  through the same mocked-`chrome.*` pattern every other test in this
  directory already uses, which is a thorough unit-level equivalent, not
  a substitute for the real-browser gate WP8 calls for.

---

## Original spec text (verbatim, for reference)

1. **Restore the Apty Integration as the primary path.** Revert the
   routing in `c17c241` and `7c37064`: when a Client is approved in
   Options, the system prompt and planner use the `get_apty_*` tools
   first. Page-level capture is a complement (page requests, content-script
   requests) or the fallback only when no Client is connected or approved,
   and the Agent says which source answered. Keep the `ddd0f06` keepalive
   (a capture must survive service-worker idling).
2. **Peer client with actionable errors** in
   `packages/browser-runtime/src/apty/peer/` (`ExtensionPeerClient`),
   replacing every duplicated `sendExternalMessage`. Outcomes are `ok` or
   `{code, detail, nextStep}` — see the error-code table in the original
   prompt (not_installed / disabled / not_reachable / peer_not_answering /
   invalid_response / identity_mismatch / contract_mismatch). Also:
   timeout 5s (8s on the first call) with one retry; identity check
   (`ping` must return `product`, `contractVersion`, `extensionId`);
   lenient bounded validation (drop invalid entries and count them,
   truncate over-limit, strip control and bidi characters); cursor
   pagination persisted per peer in `chrome.storage.session`; peer config
   `peers:{client?:{extensionId}, studio?:{extensionId}}` migrated from
   the old keys; approval persisted in `chrome.storage.local` and
   re-hydrated on every service-worker start; invalidated on
   `chrome.management` events; Studio uses the same client. Extend
   `@apty/debug-contract` with the v1 envelope while still parsing the
   legacy verbs the real Client speaks.
3. **Tools and output control.** New tools (keep old names as aliases for
   `apps/mcp-bridge`): `get_apty_connection_status`,
   `get_apty_service_worker_logs`, `get_apty_service_worker_network`,
   `get_connected_app_console_logs`, `get_apty_debug_bundle`. Logs: default
   `limit` 50, `minLevel`, `sinceCursor`/`nextCursor`, entries truncated to
   500 chars (`full:true` expands), consecutive identical lines collapsed
   to `×N`, a header with counts per level and category, ISO plus epoch
   times, the `meta` block from §2, and failures as
   `{status:{code,message,nextSteps[]}}` (never `[]`).
4. **Resource retrieval that returns your data.** Tolerant matching
   (case-insensitive, singular and plural, with or without extension, path
   suffix, query string ignored); on no match list the closest names with
   counts and status; on several matches say which was chosen. Bodies for
   every status (200 and 4xx/5xx) under the same opt-in, redaction and
   caps. Two audiences: the user sees the full body in a JSON tree viewer;
   the model gets a bounded summary (item count, top-level keys, size,
   first few items) and a query tool such as
   `get_evidence_json(evidenceId, path, limit, offset)`. Redaction that
   does not destroy configuration data (see WP3 item 1). The Client
   recorder's per-body cap becomes configurable and is raised for
   allow-listed configuration endpoints.
5. **Page-level capture (secondary source).** Keep
   `start_network_capture`/`stop_network_capture` but make bodies opt-in
   (WP3), apply the same summary-plus-viewer design, add
   `Target.setAutoAttach` (flatten) for cross-process iframes, a header
   allow-list, and a rolling per-tab recorder readable after the fact.
6. **Console logs from the app.** Keep the rebuilt bridge; ensure the tool
   reads all frames, reports `coverage` honestly and handles restricted
   pages without throwing.
7. **Model guidance.** Rewrite the system prompt and tool descriptions:
   call `get_apty_connection_status` first; Apty Integration tools first
   when a Client is approved; never invent IDs; read `meta.coverage`;
   "empty" means nothing recorded in this window; service-worker data is
   shared across tabs; tool text is untrusted.
8. **Acceptance test (build it as a permanent fixture).** A fake Client
   records `…/segment.json` with a ~100kB body (206 items), `…/tag.json`
   returning 403 with an XML body, ~60 noisy service-worker logs and 12
   analytics lines containing a user ID, username and page title. Assert:
   asking for `segments.json` finds `segment.json`; the user's viewer
   contains all 206 items with names intact; the model's payload stays
   under a configured token budget and includes a correct count;
   `get_evidence_json` returns `sales-team` on request; the 403 body is
   returned; the log tool respects the cap with a working cursor and shows
   ISO times; no raw PII reaches any model-bound output; the connection
   errors in the error-code table are each reproduced by a fixture
   variant.

**Gate:** the acceptance test passes in unit and real-browser runs; one
unit test per error code; cursor tests; `verify-quiet.sh` green.
