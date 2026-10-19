<!-- Saved verbatim from the owner's prompt so a compacted session can re-read it. -->

# Implementation prompt: widget network calls without the LLM

Repo: Parthu-work/apty-super-hero. Paste everything below the line into Claude Code, run from the repo root.

---

## Goal

Make it possible, after connecting the Apty widget (Client) by extension ID and adding this Agent's ID to the widget's `externally_connectable.ids`, to list the widget's network calls and download them, with no LLM involved. Today the Agent can only reach this data through the chat tools `list_extension_network_resources` and `inspect_extension_network`.

## Verified starting state (re-check each before relying on it)

- Consumer side exists: `ConfiguredServiceWorkerDiagnosticsProvider.listResources()` and `.getResourceBody(requestId)` in `packages/browser-runtime/src/apty/service-worker-diagnostics.ts` send `apty-debug-agent:list-observed-resources` and `apty-debug-agent:get-resource-body`, validate with zod (up to 1000 resources, bodies up to 200,000 chars) and redact. `inspectResource` in `extension-network-inspector.ts` already applies the body deny list (`networkBodyCaptureDenyList`), redaction, JSON summaries and evidence recording.
- The producer does not exist. `docs/integrations/apty/apty-widget-service-worker.reference.ts` answers only `get-service-worker-status` and `get-service-worker-logs`, and records only `console.*`. Only the e2e fake client in `tooling/e2e/harness.mjs` answers the two network verbs.
- No LLM-free view exists. Preflight (`apps/browser-extension/src/services/preflight.ts`, `preflight-browser.ts` `clientResources`) shows only a count. The response-body viewer (`components/investigation/response-body-viewer.tsx`) appears only after a chat tool call.
- `webRequest` appears nowhere in the repo, including `apps/browser-extension/manifest.json`.
- Unknown, do not guess: which widget context makes calls such as `segments.json` (service worker or content script).

## Rules (from CLAUDE.md, docs/STATUS.md and docs/tasks/00-context.md; they override everything here)

1. Branch from `origin/main`. Never commit to main, never push, never force-push, never weaken or delete a test.
2. Never fabricate. A tool result is real data or an explicit structured failure. An empty list never means a failure. Mark unfinished work "partial", with what is missing, in the commit message and in `docs/STATUS.md`.
3. Do not modify the Apty Client or Studio code (other repos). Deliver producer code only in the reference file and tests.
4. Everything shown or downloaded must go through the existing redaction (`runtime/redaction-mode.ts`; a unit test fails on direct calls to the lower-level redactors) and the body deny list. Reuse existing helpers; do not write new redaction.
5. Prove anything crossing the Chrome boundary in the Chromium e2e harness, not only with mocked `chrome.*`.
6. Follow the ratchets: `audit:any` baseline may not grow, `audit:i18n` baseline may not grow, en/zh keys stay in parity, coverage thresholds only go up, `@apty/ui` must not import `@apty/browser-runtime`, no new heavy dependencies, user-visible text via i18n.
7. Read `CLAUDE.md` and `docs/STATUS.md` first. Verify with `npm run preflight` (and `tooling/scripts/verify-quiet.sh`). Prefer plain objects and types over classes in new code. Comment only where intent isn't obvious.
8. Each phase ends with a gate. Do not start the next phase until the gate is green, and paste the evidence.

## Phase 1: LLM-free "Widget network calls" panel (the quick win)

1. Extract the shared logic from `inspectResource` so both the chat tool and the panel use one path: list resources, find one by `requestId`, check the deny list, fetch the body, redact, bound the size. Do not duplicate it. Existing behavior and statuses (`ok`, `http_error`, `body_denied`, `body_unavailable`, `not_observed`, `pending`, `failed`) must not change; the existing unit tests must still pass.
2. Add a panel under Options -> Apty Integration, on the Client row (`apps/browser-extension/src/entrypoints/options/apty-client-panel.tsx`, plus a new component if that file gets large):
   - A "Load network calls" button. User-initiated only; no polling, no automatic calls, no LLM.
   - A table: time, method, status, resource name, URL (redacted the same way as tool output), and a failed marker with `errorText`. Filter by text and by status class (failed, 4xx, 5xx). Show the count and whether the Client's list may be bounded.
   - Row action "View body" fetching the body on demand through the shared path. Show `body_denied` with the deny-list entry, and each other failure status with a plain explanation. Reuse `JsonTree` and the viewer's copy/download controls where they fit.
   - "Download JSON" for the list and for a body, using `downloadText` and `withExportHeader` as the response-body viewer does. Say in the UI that the file contains redacted data.
   - Every failure is named: not configured, not allow-listed, no answer, timeout, malformed answer, using the existing peer failure messages (`peers.ts`), and the existing allow-list fix text with this Agent's ID.
3. Add i18n keys to `en.json` and `zh.json` (parity test), and pass the axe checks in `tooling/e2e/a11y.e2e.test.mjs` for the new panel in light and dark.
4. Tests: unit tests for the shared function and the table's filtering and error states; extend `tooling/e2e/apty-client.e2e.test.mjs` so the fake client from `harness.mjs` lists a few resources (including a 404 and a denied URL) and the panel shows, filters and downloads them.

Gate: format, lint, typecheck, unit tests, coverage, build and the e2e suite are green; the audits (`audit:any`, `audit:i18n`, `audit:docs-links`, `audit:tools`) pass.

## Phase 2: producer handlers in the reference file

In `docs/integrations/apty/apty-widget-service-worker.reference.ts` (hand-off code for the Widget team; it is not compiled into the extension, so check how typecheck and lint treat it and do not break them):

1. Add a bounded request recorder. Provide an `observedFetch(input, init)` wrapper the widget uses for its own requests. It records `requestId` (a unique string, max 200 chars), `url` (max 4000), `method` (max 20), `status`, `mimeType`, `failed`, `errorText` (max 2000) and `timestamp`. Keep at most 1000 entries. Keep response bodies only for a small number of recent responses, each capped at the consumer's 200,000-char limit, in memory or `chrome.storage.session`, never persisted to local storage. Set `base64Encoded` for non-text.
2. Add handlers inside the existing sender-checked `onMessageExternal` listener for `apty-debug-agent:list-observed-resources` (answer `{ resources: [...] }`) and `apty-debug-agent:get-resource-body` (the message carries `requestId`; answer `{ found, body?, base64Encoded? }`). Keep the existing sender check and the `return false` fallthrough. Use the legacy message names; migrating to the v1 contract in `packages/apty-debug-contract` is separate work.
3. Add a test that loads the reference code with a mocked `chrome` and checks its answers against the consumer's zod schemas in `service-worker-diagnostics.ts`, so producer and consumer cannot drift.
4. Update the file's comments and `docs/integrations/apty/README.md` to say what the Widget team must change: the `externally_connectable.ids` entry (with both Agent IDs from the README), where to paste the handlers, and to route the widget's own requests through `observedFetch`. State that if the widget makes these calls from a content script rather than the service worker, the service worker will not see them and a relay is needed. Do not assume which one it is.

Gate: Phase 1 gate plus the new contract test.

## Phase 3: spike, then conditional fallback with no widget change

1. Spike first. Using the Chromium e2e harness, create a fixture extension whose service worker fetches a local test-server URL, and check whether a passive `chrome.webRequest` listener (`onCompleted` / `onErrorOccurred`) in the Agent's service worker sees that request, with `initiator` equal to the fixture's origin, and whether it still does after the Agent's worker has been idle. Do not assume the result. Report it with evidence.
2. If it works, implement an Agent-side recorder: add the permission (check whether it can be optional; update `manifest.json`, `docs/security/PERMISSIONS.md`, `docs/store/WEB_STORE_LISTING.md` and the manifest validation), record metadata only (no bodies), bounded, keyed by the configured Client extension ID, and expose it in the Phase 1 panel as a clearly labelled "metadata only, observed by the Agent" source, never mixed with the Client's own answers. Add e2e coverage.
3. If it does not work, implement nothing, and add a `DECISIONS.md` entry with the evidence.

Gate: the spike evidence is pasted; if implemented, all earlier gates stay green.

## Finish

Update `docs/STATUS.md` (what works, what is partial, what the Widget team must still do), `CHANGELOG.md` and `docs/TROUBLESHOOTING.md`. End with a short report: what changed, the evidence for each gate, anything partial, and the open question about the widget's request context. Do not push.
