# Final audit: corrections and additions (binding)

Four independent audits were run on 2026-11-28 against apty-dap `3f3adba`,
apty-assist `bbb4cbc` and this branch at `f01e659`:

1. 5.x workflow paths, end to end;
2. 4.x flow paths, end to end;
3. whether this repository can execute the prompts as written;
4. design soundness and security (adversarial).

Every finding below was read at its cited line; the main ones were
re-checked by hand. Rows marked INFERRED are readings of the code that
nothing has run yet: implement them as status `candidate` until a test or
the real-tenant smoke test confirms them.

**Precedence.** This file overrides `IMPLEMENTATION-PROMPT.md`,
`PHASE-1-WORKFLOWS.md`, `se-flow-design.md` and `se-flow-coverage.md`
wherever they differ. Paths are under `apty-dap/packages/` (5.x) or
`apty-assist/player3.0/src/` (4.x) unless shown.

---

## A. Design changes (correctness and security)

### A1. Hosts: page-named hosts are no longer trusted wholesale

Today any https host the page names is fetched, unless it is a private IP
literal (`apty/replay/content-source.ts:429-442`). Any site can set
`window.__APTY_PLAYER_CONFIG__`, so the Agent could fetch intranet or
attacker JSON and pass it to rows, Copy for support and models. The real
players can only reach `https://*.apty.ai/*` (5.x `apps/player/wxt.config.ts:86`)
and `*.apty.io` / localhost (4.x `manifests/manifest.json:11`).

**Change:**

- Accept a page-named content host only if it matches the version's Apty
  suffix (`*.apty.ai` for 5.x, `*.apty.io` for 4.x) **or** is in
  `aptyContentOrigins`. Otherwise `host_not_allowed`, naming the host to
  add (this is also C-7 / D-20).
- Default port only. Loopback only if the policy lists it.
- Normalise policy origins through `URL` when parsing the policy
  (trailing slash, default port).
- Enforce per-version ID shapes before building a path: 5.x UUIDs; 4.x
  short tenant key and numeric app/env; reject `%` in any ID (`PATH_SAFE`
  allows it today, `catalogue.ts:156`).
- Plain-http non-loopback hosts (4.x on-prem): refused unless decision
  D-HTTP-ONPREM allows them for hosts in the policy.

### A2. Fetch hardening

Today the 10 s timer is cleared when headers arrive
(`content-source.ts:188-204`), `response.text()` then has no limit
(`:318`), and the 5 MB check runs after the whole body is in memory.

**Change:**

- Keep the timer running until the body is fully read.
- Check `Content-Length`; then read the stream with a **byte** cap (5 MB per
  file, 25 MB per case). The built limit is 5,000,000 characters
  (`MAX_REPLAY_BODY_CHARS`, `content-source.ts:59`); switch to bytes.
- Thread a per-case `AbortSignal` through `fetchFile`, the Ask Dapty client
  and page reads. Closing the conversation or the case aborts them.
- Tests: slow-drip body, oversized body without `Content-Length`, abort on
  close.

### A3. Named failures: "not published" is not proof, and `auth_required` is new

- 5.x CloudFront answers **both 403 and 404** with a 200
  `default_response.json` (`apty-dap: infra/iac/modules/cloudfront/main.tf:150-157`,
  `spa_fallback` defaults to true, `variables.tf:24-27`; content site at
  `infra/iac/live/shared/main.tf:103-104`). So an access-denied path, or a
  **wrong tenant / app / env ID**, looks the same as an unpublished file.
  - Row wording: "No file at this path (not published, or the tenant,
    application or environment ID is wrong)".
  - When **every** env-scoped file is missing, the first suggested fix is
    "check the IDs".
  - Mirror the player's not-found test exactly: `ApiErrorSchema = {message: string, status: z.coerce.number()}`
    (`libs/shared/axios-client/src/schema/api-error.schema.ts:4`). Today
    the Agent requires `status === 404` as a number
    (`content-source.ts:152-153`).
- **New named failure `auth_required`:** HTTP 401 or 403, or a 200 body
  whose `status` is 401/403 (string or number). Never fold it into
  `not_published`.

### A4. 4.x content may be login-protected (SSO)

apty-assist has a CloudFront Lambda that lets only six files through
without the `apty_client_token` cookie: `content-config.json`,
`feature-flag.json`, `properties.json`, `app-urls.json`, `app-data.json`,
`tenant-config.json` (`apty-assist: widget-authentication-lambda/src/lambda/handler.ts:51-68,138-172`).
Every other file (`flow.json`, `flow-{id}.json`, `segments.json`,
`rules.json`, `users/*.json`) needs the cookie. Whether the Lambda is
attached to the SaaS distribution is not in these repos (INFERRED).

**Change:**

- Read `tenant-config.json` (public) and `feature-flag.json` first. When
  `widgetSSO` is on and `widgetSSOConfig.enabled` is true, 4.x item files
  are "?": "This tenant's content is login-protected; the Agent sends no
  cookies." Do **not** send cookies to work around it.
- Add an SSO tenant to the WP13 real-tenant smoke test; list "4.x
  SSO-gated content" in design §11.

### A5. 4.x request shape

The 4.x background sends `AptyCustomHeaderKey: AptyCustomHeaderValue`,
`x-referer: <page origin>` for apty.io hosts and `keepalive`
(`background-scripts/send-request.ts:9-34`; `api/http.ts:249-260`), and
rebuilds a 401 as content `{status:401}` (`send-request.ts:91-99`). No CDN
enforcement of these headers is in the repos (INFERRED unknown).

**Change:** record them in the catalogue as "player sends; Agent omits".
The 4.x real-tenant smoke test compares an Agent GET with a player-shaped
GET (same path and timestamp) by status and body hash. If they differ,
decision D-4XHEADERS decides whether to add the custom header only. Never
send the page origin as `x-referer`.

### A6. WNV-07 and every mirrored rule are version-dependent

The per-environment widget display ("missing `widgetDisplayConfig` means
hidden") came in `9b2eef11` (2026-11-16, `segments.service.ts:64-80`).
Players released before it still use the app-level `widgetConfig`.

**Change:**

- Every mirrored rule gets `minPlayerVersion` (and `maxPlayerVersion`
  where behaviour was removed) next to `verifiedOn`.
- WNV-07 applies the per-environment rule only when the detected player
  version (C-1 sources: injected `iframeLocalStorageURL`, the dev-mode
  panel, or one question) is at or above the first release that contains
  `9b2eef11`. Below it, keep the app-level check. Unknown version: "?"
  naming both rules.
- The owner supplies the release ↔ commit mapping (decision
  D-RELEASES). Until then the version-gated rows are `candidate`.

### A7. Whose state is judged: this page's session vs the affected user

Audience, rules, augmentation and storage rows read **this page's**
session; user-history rows read `users/{id}.json` (5.x) or, for 4.x
auto-trigger, page storage (see D, F4-67). When the SE reproduces on their
own login, a row such as "segment VIP inactive" describes the SE, not the
user.

**Change:**

- The case records `pageUser` (read exactly as the player reads it) and
  `targetUser` (given by the SE or read from dev mode).
- When they differ, or `pageUser` is unknown, page-derived audience and
  rule rows are labelled "for this browser session", and causes about the
  reported user from them become "?".
- Ask once in the intake card: "Is this page logged in as the affected
  user?"

### A8. Models and untrusted content

- Ask AI anyway tools: `userId` is fixed to the case's value; the model
  cannot choose it. The model cannot name a host or a path outside the
  catalogue (already true).
- Mask user IDs inside paths in every row, Copy for support and case
  record.
- Never send raw cookie, storage, augmentation or window values to a
  model in any redaction mode: send the rule outcome and the value type
  only.
- Pass fetched strings (item names, step HTML, scripts, Ask Dapty text,
  cards) to models as quoted data with length caps under an explicit
  "untrusted content" frame. Do not auto-render links or images from model
  output.

### A9. O-4 execution, if the owner allows it

- `Runtime.evaluate` with `awaitPromise: true`, a wall-clock race and
  `Runtime.terminateExecution`; detach in `finally`. The sync `timeout`
  option alone does not bound async scripts.
- Provide `$` the way the player's Sval does (`libs/client/utilities/src/sval-interpreter.ts:18-24`);
  a bare world gives a false "script fails".
- Refuse to run any script whose static references include `fetch`,
  `XMLHttpRequest`, storage writes or DOM mutation; report "may have side
  effects".
- Show the exact script and target frame and require per-script
  confirmation.
- Detect a blocked debugger (enterprise `DeveloperToolsAvailability=2`) or
  one already attached; report "?".

### A10. Re-check must see a new publish

`timestampFor` fetches `content-config.json` without `fresh`
(`content-source.ts:214`) and the `inFlight` key includes `fresh`
(`:242`), so under concurrency files can use the stale stamp; CloudFront
then serves the cached object (the timestamp is the cache key) and the row
never flips. **Change:** on Re-check, await a fresh `content-config.json`
(both of them on 4.x) before any other request and pass it into
`timestampFor`. Test it with 6-way concurrency.

### A11. Ask Dapty

- **Egress gate:** gate on `askDapty` being configured plus redaction. Do
  **not** use `kbEgressAllowed` (it is about KB pack text reaching a model
  and is false unless `kbToModel` is approved; `agent-core/src/config/destination.ts:111-131`).
- Validate `kbTenantId` and `kbApplicationIds` as UUIDs when the policy is
  parsed (the stream route does not). A give-up on the first call after
  setup shows "check the Ask Dapty KB configuration".
- Classify `done.reply` against the error reply text too (it arrives as a
  normal `done`, `ai-chat-widget.service.ts:89-92`). The give-up text can
  also come from the model itself, so keep the near-match rule.
- Send a non-empty `context` only if it avoids the second title call
  (`service.ts:94-97`); otherwise accept the cost and debounce: one call
  per changed question.
- `applicationType` steers web-search domains (`web-search.service.ts:37-53`):
  send the KB tenant's own type from the policy, never the customer's.

### A12. Page, tab and session robustness

- **One tab per case.** Bind the case to its tab; rebinding asks first
  (`caseReplay` overwrites `tabId` today, `case-replay.ts:318`).
- **SPA navigation mid-case:** record the URL with each page read; if it
  changed since the environment match, re-match and show "page changed".
- **Several players:** probe every frame and both versions; list all
  players found; ask when there is more than one (two 5.x builds, or 4.x
  and 5.x on one page).
- **Probe fallbacks:** if Apty adopts `use_dynamic_url`, the ID regex
  `[a-p]{32}` (`apty-cdn-source.ts:361,390`) fails; fall back to the
  observed resource base and say "Apty present, config not readable". 4.x
  isolation builds and failed-SSO pages never inject `window.var.js`
  (`main.bootstrap.ts:187-205`): SCR-13 must not read its absence as the
  D-01 freeze there. Add the 4.x MV2 test-extension mode
  (`manifests/manifest-inject.json`) to the probe table.
- **Blocked by policy:** `runtime_blocked_hosts`, the Web Store, PDF viewer
  and `file://` give "The Agent is blocked on this site by your
  organisation's policy", not "no Apty".
- **MCP-bridge path:** the pinned context lives in module memory
  (`case-replay.ts:270`); persist it in `chrome.storage.session` or fail
  closed after a worker restart.
- **Where the case run lives:** the side panel (design §3.1). Fix the
  replay header comment that says service worker (`content-source.ts:3-4`).

### A13. Nothing on disk, precisely

Case records and feedback go to IndexedDB `apty-cases-db`
(`storage/case-store.ts:1-6`). Persist only rule IDs, statuses, gate IDs
and citations. Strip paths, IDs, item names and values before the case
record is written.

### A14. The O-5 copy step

Do not ask the SE to dump the whole Apty Client storage (it may hold the
4.x `apty_client_token`, `sso.helpers.ts:16,48-55`). Use
`chrome.storage.local.get('<appId>-<envId>')`, warn not to paste anything
else, and say this needs Developer mode (often blocked by policy). Prefer
the dev-mode panel read (C-16).

---

## B. Implementation prerequisites the prompts missed

### B1. Streaming checklist: a new `LocalAnswer` shape

The agent awaits the responder fully before the first event
(`agent-core/src/agent/apty-agent.ts:709-714`); `runLocalAnswer` needs
`result` up front (`:794-815`); the case recorder reads `answer.result`
synchronously (`browser-runtime/src/case/case-recorder.ts:267-275`);
`combineResponders` merges at return.

**Change (WP7):** `LocalAnswer` gains
`{progress?: AsyncIterable<ChecklistRow>, final?: Promise<{result, transcript, decision?}>}`.
`runLocalAnswer` emits `tool_call_start`, drains `progress` as
`tool_call_progress`, awaits `final`, then emits `tool_call_complete`. The
recorder and `combineResponders` await `final`. The old synchronous shape
keeps working. Add `signal: AbortSignal` to the responder context
(`types.ts:173-184`).

### B2. Catalogue

- Add a **root** scope to `AptyFileScope` (`agent-core/src/apty/content-source.ts:12-17`)
  and root entries: 5.x `locales/{code}.json` (its timestamp is the player
  version) and `themes/default-themes.json` (no query)
  (`libs/shared/cdn-api/src/application-environment-files.ts:264-282`);
  4.x `langs.json` if root (check `api/backend.ts`; the catalogue makes it
  app-scoped today).
- Add 4.x `segment-js.js`, `custom-js.js`, `custom-css.css` and
  `most-used-content.json`, with a **non-JSON body** path (today every
  body goes through `JSON.parse`, `content-source.ts:356-358`).
- Root files take no tenant prefix and no `token=`; paths come from the
  version adapter.

### B3. Page CSP source

Network capture is CDP-based and sees the document only if attached
before load (`network-capture-session.ts:427`). Add a
`chrome.webRequest.onHeadersReceived` listener (`main_frame`,
`responseHeaders`) in the service worker; keep only the CSP value per tab
in memory; fall back to `<meta http-equiv>`; with neither, the row is "?"
(never "allowed"). `webRequest` and `<all_urls>` are already in
`apps/browser-extension/manifest.json:63-89`, so no new permission.

### B4. UI components

`GateRow` and `VerdictFooter` are private functions in
`apps/browser-extension/src/components/investigation/check-result-card.tsx:496,624`,
typed on browser-runtime's `GateResult`; they cannot be used from
`@apty/ui`. **Change:** build new `@apty/ui` checklist-row and result
components typed on agent-core's `ChecklistRow`; leave the old card for
the legacy packs. The KB fallback card is exported as `UnknownSettingCard`
(`kb-unknown-setting.tsx:23`).

### B5. Settings and policy keys

`askFirst` (D-ASKFIRST) and `askDaptyWhen` (D-DAPTY-WHEN) need Settings
controls, `managed-schema.json` keys ("lockable by policy"), and the same
for `askDapty`, `modelA`, `aptyClientRecord`. Update `ORG_POLICY.md`, run
`policy:generate`, and keep `policy:check` and `check:dist-policy` green.

### B6. Test infrastructure

- **Fixtures:** the 5.x `app-data.json` fixture has `environments: []` and
  no `widgetDisplayConfig`; after A6/WP1 every 5.x E2E using it would see
  "widget hidden". Add `widgetDisplayConfig` to it in WP1. Add the missing
  files: `content-config.json`, `users/{id}.json`, locales,
  `application-locales.json`, `theme.json`, `application-script.json`
  (5.x); `form.json`, `tenant-config.json`, `segment-js.js`, `users/*.json`
  (4.x).
- **Fixture builder:** generate the fire / no-fire fixture pair per rule
  from a table-driven builder; about 150 conditions need them.
- **Fake 4.x Extension-mode Client** (`window.var.js` plus web-accessible
  `config.json`); only `tooling/e2e/fixtures/fake-4x-client/injected-player.js`
  exists.
- **Anthropic `/v1/messages` mock:** extract the inline ones from
  `tooling/e2e/anthropic-workspace.e2e.test.mjs:64` and
  `provider-schemas.e2e.test.mjs:91` into the harness.
- **Coverage manifest:** seed it from `PHASE-1-WORKFLOWS.md` §5.1 plus
  section D of this file, with the corrected citations; hash against the
  local checkouts `/home/user/apty-dap` and `/home/user/apty-assist` (or a
  path from an env var).

### B7. acorn

acorn 8.16.0 is only transitive today (not hoisted). Adding it as a direct
`@apty/agent-core` dependency needs decision **D-ACORN**, a lockfile
update and a regenerated `apps/browser-extension/THIRD_PARTY_NOTICES.txt`
(`audit:notices --check`). Add `audit:notices`, `policy:check` and
`check:dist-policy` to the audit list in master §1.4. Without D-ACORN,
SCR-02 (parse) is "?".

### B8. i18n

Every new gate and rule needs `checkPack.gate.*` (or the new row keys)
and rule copy in `en.json` and `zh.json`; about 150 rows in Phase 1.

---

## C. Contradictions resolved

| # | Contradiction | Resolution |
|---|---|---|
| C1 | "Never weaken a test" vs. Phase 1 replacing old behaviour. `tooling/e2e/visibility-check.e2e.test.mjs:134-149` asserts "Could not reach the Apty Client: No Apty Client extension ID is saved." and `:215-224` "2 of 9 have a blocker" for S-LIST wording; `dapty-cdn.e2e.test.mjs:219-236` asserts the Ask Dapty card for wording Phase 1 sends to S-LAUNCH; `router.test.ts` asserts a single `Route` | Decision **D-TESTS**: the owner approves an **assertion migration list** limited to these assertions, each replaced by an assertion of the new behaviour for the same input, and recorded in the phase review. Add `routeSymptoms(): Route[]` beside `routeSymptom` so `router.test.ts` stays as is |
| C2 | No new runtime dependency vs. acorn | Decision D-ACORN (B7) |
| C3 | WP14 "delete the code replaced in WP3" vs. D-CLIENT "keep it, off" | D-CLIENT wins: keep the Client path behind `aptyClientRecord: optional`; delete only code that nothing reaches |
| C4 | Hand-over file names | Phase review: `docs/tasks/se-flow/PHASE-<n>-REVIEW.md`. Master review: `docs/tasks/se-flow/REVIEW.md`. "Record in `REVIEW.md`" in §1 means the current phase's review |
| C5 | "`content-config.json` once" vs. 4.x needing the tenant and the app content-config | Per version: 5.x one; 4.x two (tenant + app) |
| C6 | Group names and order differ between WP6, WP7, WP10 and Phase 1 §5 | Canonical groups and order: **Context, Platform, Load, Widget, Item, Audience, Rules, Auto-trigger, Launch, Steps, Element, Scripts, User history, Knowledge, Not checked**. WP6's "Steps file" and "Step play" are the Steps group; "List" is the Item group |
| C7 | §3.1 "result when the slower lane finishes" vs. WP7 "result within 6 s" | Rows and the **issues** part of the result render as soon as the checks finish; the guidance or card section fills in when Ask Dapty finishes (20 s cap). Ask AI anyway appears only after both |
| C8 | WP10 Prove asks for S-TOOLTIP and S-WIDGET E2E | In Phase 1, only the workflow symptoms; the rest in their phases |
| C9 | Manifest seeded from the coverage doc, which lacks F4-07, F4-22 and SCR IDs and has bad citations | Seed from Phase 1 §5.1 plus section D (B6) |
| C10 | WP11 gates Ask Dapty through `kbEgressAllowed` | A11 |
| C11 | Docs drift: CLAUDE.md omits `@apty/debug-contract`; says preflight builds (it does not); §1.5 says agent-core has no provider SDK (it depends on `@openai/agents`) | Informational; do not "fix" by removing the dependency |

---

## D. Condition corrections and additions

All new IDs below are in Phase 1 scope (§5.1) and must be rows in the
coverage manifest.

### D1. 5.x: new conditions

| ID | Condition | What the user sees | Code | Dec. | Group |
|---|---|---|---|---|---|
| W5-62 | `displaySuccessBalloon` **and** `displayFeedback` on, and the user already gave feedback: success closes, nothing marks the run complete (`markWorkflowAsCompleted` never runs) | From the second run on, never "completed": checklist not ticked, completion analytics missing | `libs/client/workflow-engine/src/run/workflow-engine.service.ts:144-146,830-837`; `apps/player/src/main-content-script/tool-items/workflow/player-workflow-bindings.ts:142-153` | F + U (`workflowsFeedback[]` holds the id) | User history |
| W5-63 | Autopilot limits: CLICK_NEXT-only steps skipped; `autopilotInputValue`/`autoPilotInputType`/`autopilotDropdownValue` hard-coded null, so INPUT steps do nothing and CHANGE steps look for `''` (INFERRED never matches); no `mouseup` branch; `mousedown` dispatches a non-bubbling plain `Event` (host handler INFERRED not triggered); floating steps have no autopilot | "Autopilot not working" or stops on a step | `libs/client/tool-items-content-script/src/common/tool-items/flows/use-flow-step-advance-on.controller.ts:134-161,163-225`; `libs/client/tool-items-schema/src/mappers/flow-step.mapper.ts:63-69`; `use-attached-step.controller.ts:24` | F + P | Steps |
| W5-64 | Step retries need the tab visible and `document.hasFocus()`; losing presence aborts retries as ABORTED (not broken); split evaluation likewise | Step never appears and no broken card until the user clicks into the page | `libs/client/utilities/src/browser/tab-visibility.service.ts:71-75,101-104,107-125`; `tool-items-content-script/src/main/messaging/ipc.service.ts:338-358`; `workflow-step.service.ts:251-259`; `workflow-continuation.service.ts:28-34` | R (P: `document.hasFocus()`) | Steps |
| W5-65 | An ERROR outcome (IPC failure or exception on activation) leaves the run stored with no expiry; it retries on every reload and blocks every auto-trigger | Nothing on screen; auto-trigger never fires | engine `:356-359`, `:260,374`; `workflow-step.service.ts:212-218,243-249`; `active-dialog.service.ts:26-28` | R (+ stored run) | Steps, Auto-trigger |
| W5-66 | A split hand-off to a workflow not in `workflow.json` (or dropped by the schema) keeps the current run active | Stuck on an invisible split step; auto-trigger blocked | engine `:313-324` | F | Steps |
| W5-67 | A split JUMP to a step id that does not exist restarts at the entry step (else `order===1`) instead of ending | Loops back to the start / wrong branch | engine `:333-347`; `workflow-step.service.ts:140-143` | F | Steps |
| W5-68 | A split hand-off marks the source workflow complete and skips its success and feedback | Success / feedback not shown for the first workflow | engine `:326-331` | F | User history |
| W5-69 | Auto-trigger contention: a rule rise while another workflow runs is consumed and dropped (EVERY_TIME waits for fall-then-rise); activations queue with concurrency 1, each waits its own `delay`, the first wins, the others leave no record | A second or EVERY_TIME auto-trigger "never fires" | `apps/player/src/main-content-script/tool-items/workflow/workflow-autotrigger.service.ts:24,132-138,169-199` | E / R | Auto-trigger |
| W5-70 | The auto-trigger record is written even when the started run broke, aborted or was skipped; under display None the invisible run still consumes a ONCE record | "Already triggered" though the user never saw it | engine `:466-476`; autotrigger `:155-166` | U | Auto-trigger |
| W5-71 | After the `delay`, only the dialog and frequency checks repeat; restriction is checked only before the delay; the rule's truth is not re-checked (the launch gate is) | Fires on a restricted page or after the rule went false | autotrigger `:175,188-199,132-151` | R | Auto-trigger |
| W5-72 | Checklist item launch: target from the validated visible list; `activateWorkflow`, not re-gated, source WIDGET, entry step (C5-02/03 rows for launch) | Item missing, or opens at the wrong step | `apps/player/src/main-content-script/widget/content/checklists/ChecklistPageItem.tsx:57-65`; `cdn.service.ts:481-507`; `libs/client/tool-items-schema/src/mappers/checklist.mapper.ts:19-42` | F + E | Launch |
| W5-73 | SPA navigation during a run to another environment's URL: the run is stored under `${appId}-${envId}` and `getActiveIds` re-matches each call, so the run is hidden and Next does nothing; a URL matching no environment throws; file caches keep the first env's content (effects INFERRED) | Stuck balloon; Next does nothing | `storage/local-storage.service.ts:125-128,163-182`; `cdn.service.ts:90-104,118-143`; engine `:617-621` | P | Steps / resume |
| W5-74 | Permalink syntax: type `WF` is case-sensitive; exactly 2 or 3 colon parts, else "Unknown permalink type"; `WF:id:` starts at the entry step | Link does nothing | `permalink/permalink.service.ts:99-125`; `permalink.types.ts:4-8` | F / P | Launch |
| W5-75 | A permalink starts during async init, before the tool-items IPC exists (INFERRED effect: ERROR after the IPC timeout, then resumed by the continuation service) | Linked workflow appears late or not on first try | `ioc.ts:56-63,79-86`; `widget-restriction.service.ts:43-46`; `workflow-step.service.ts:189-194` | R | Launch |
| W5-76 | A broken step inside an iframe likely never auto-recovers: the broken card is in the main window and recovery looks in the main document (INFERRED) | "Step broken" stays although the element is there | `ipc.service.ts:363-367`; `main/tool-items/flows/broken-recovery-step/BrokenRecoveryStep.tsx:27-40` | R | Steps |
| W5-77 | URL matching extras: `urlRegex` and `regExpUrl` flags are hard-coded off, so regex env URLs never match as regex; a desktop-widget URL short-circuits matching | Info: "regex URLs are ignored in 5.x" | `cdn.service.ts:124-125,129,133-134,937-939`; `libs/shared/cdn-api/src/types/feature-flags.ts:25-39`; `active-application.helpers.ts:15-30` | F | Load |

### D2. 5.x: corrected statements

| ID | Was | Correct |
|---|---|---|
| W5-16 / W5-17 / W5-18 | `enableSuccess`/`enableFeedback` need a message, else the workflow is dropped | Only the **list** path validates (`WorkflowMapper(flow, …, true)` at `cdn.service.ts:406`, used by the widget list, launchers `:531-539` and checklists `:486,502`). `getWorkflowById` (`:437-441`) does not: announcement CTA, step CTA, Ask Dapty, auto-trigger, permalink and split hand-off still open it, with empty success/feedback text |
| W5-49 | Click listens to `workflowAdvanceOnClickEventType`, default `mousedown`; unknown advance reads as Next (controller) | Missing or invalid event type means **`click`** (`libs/shared/core/src/types/workflow-step.ts:44-46`; `application-config.schema.ts:256`); `mousedown` only when app properties are absent (`controller:27`). Unknown advance-on → CLICK_NEXT comes from `AdvanceOnOptionsSchema.catch` (`workflow-step.ts:57`) |
| W5-29 | Day / week / month since the record | Day = at least 24 h elapsed. Week = `floor((floor(Δms/86400000) + start.getDay())/7) ≥ 1` (Sunday-start calendar week, browser-local). Month = calendar-month index difference (Jan 31 → eligible Feb 1) (`libs/shared/core/src/utilities/date-diff-counter.ts:5-20`). Near a boundary, show "?" (browser clock and time zone) |
| W5-40 | Entry point: `enableEntryPoint` whose rule is true | `enableEntryPoint` with a **null** rule id always passes (`flow-step.mapper.ts:86-101`; `rule-engine-visibility-rule.service.ts:88-91`). Only **ATTACHED** steps can be entry points; "last" means last in file array order, not highest `order`; entry rules use the same 15×100 ms wait; a requested id that does not exist falls through silently; the `order===1` fallback can be any step type; orders starting at 0 with no entry point launch nothing (`workflow-step.service.ts:130-143`) |
| W5-57 | Completes when no `order+1`, on split end, or hand-off | The completion record depends on the dialogs: success only → immediately; success + feedback → only when success closes with feedback pending (else never, W5-62); feedback only → on submit/dismiss, or immediately when already given (engine `:144-158,801,822,847`) |
| W5-01 | Top frame only, `index.tsx:12-14` | From the manifest `apps/player/wxt.config.ts:75-78` (`all_frames: false`); injected mode has no top-frame guard (INFERRED) |
| W5-02 | `index-injected.tsx:51-54,88-96` | `:25-41` (`15000` at `:28`); widget starts after the iframe at `:62-70` |
| G5-22 | `user-preference.service.ts:62-75` | Whole-file parse and fallback: `libs/shared/cdn-api/src/cdn-reader-api.ts:86-98` (`getWithFallback`); `application-environment-files.ts:216-222` |

### D3. 5.x: exact semantics to mirror

| ID | Semantics |
|---|---|
| W5-45 / W5-46 | `optionalTimeOut` applies only when `enableOptional`; non-optional steps always 5 s (`flow-step.mapper.ts:47-48`; `WORKFLOW_STEP_TIMEOUT_MS`). Attempts = 1 immediate + `timeout/1000`, 1 s apart (`ipc.service.ts:338-352`). Floating steps always succeed (`tool-items.service.ts:99-113`). For `optionalTimeOut` ≥ 10 s the IPC timeout `max(stepTimeoutMs, 10000)` may expire first (ERROR, W5-65) (INFERRED) |
| W5-48 | Activation succeeds when the element is **present**, not visible (`tool-items.service.ts:81-97`). An invisible anchor gives no balloon, no advance listeners and no broken card (`AttachedStep.tsx:66-71`). Tell "stuck, nothing shown" apart from "broken" |
| W5-51 | Split attempts = `5000/1000`; the authored `waitForSplit` is **ignored** (`flow-step.mapper.ts:190-201`). Null rule results count as false (`workflow-split-rule.service.ts:20-35`). All attempts failing → GO_TO_NEXT = `order+1`. Same `toolId` → jump; other → new flow (`workflow-step.service.ts:93-126`) |
| W5-54 | Expiry is an inactivity timer on the current step: `contentRunExpiryTime` min × 60000 (≤0/null → 30), restarted on each step success or broken, cleared on deactivate or tab hidden, in memory only (`workflow.mapper.ts:80-85`; engine `:85-87,260,374,772-774`) |
| W5-53 | Resume fires from the tab-visibility subscription at boot (`tab-visibility.service.ts:78-84`; `workflow-continuation.service.ts:19-26`); a `pendingCompletion` run re-shows the success/feedback dialog (engine `:552-585`); storage scope `${appId}-${envId}` (W5-73) |
| W5-28 / W5-29 | Lookup `flows[workflow.sourceId][stepSourceId]`; the user file is per **app**, so records are shared across environments; evaluation throttled to 500 ms (`autotrigger:26`); EVERY_TIME with a record is eligible only on a rise; `delay` is seconds (`:190`) |
| W5-38 / C-14 | Autopilot only from a permalink with `autopilot=true` and the workflow's `enableAutopilot` (engine `:514`); then W5-63's per-step limits |
| K5-07 | A workflow in a label leaves the main list and appears only in the label group (favourites and most-used duplicate it); sort by `order`, nulls last (`widget.mapper.ts:55-94`; `sorting.helpers.ts:1-11`). In Phase 1 scope for S-LIST |
| W5-16 | Locale rows match the current `localeCode` exactly (`locale-fallback.ts:22-23`); language from stored → `isDefault` → `<html lang>` prefix → first enabled (`locale/locale.service.ts:30-53`) |
| W5-34 | Step resolution first: if no step resolves, the current run is not cancelled (engine `:410-415` before `:420-433`); AI_CHAT, step CTA and split sources overwrite the run without cancelling |
| W5-36 | `getVisibleWorkflowById` = in cached `workflow.json` + segment check + visibility rule (`cdn.service.ts:444-450`; `visibility-rules.service.ts:14-17`); no name or success-text validation |

### D4. 4.x: new conditions

| ID | Condition | What the user sees | Code | Dec. | Group |
|---|---|---|---|---|---|
| F4-64 | In extension mode `<PlayFlow/>`, `<ErrorModal/>`, `<StepBrokenWidget/>` and `<Launchers/>` render inside `#apty-player-root`; when the widget is hidden by `showPlayerAccordingToSegments` (env `enablePlayer` false, display None, Specific with no match, or segments not loaded) the whole root is `display:none` | A flow starts but no balloon, error or launcher is visible | `index.tsx:227-245`; `App.tsx:88-100`; `common-helpers.ts:128-136`; `app.selectors.ts:128-152` | F + E | Widget (applies to S-AUTO, S-LAUNCH, S-STEP) |
| F4-65 | (P4-16 made certain) `app.effects.ts:69-73` is the only sender of `DOMChanged`, and only while the widget is shown; user-ID checks, rule re-evaluation, frame checks and step re-checks depend on it | No user ID, so no auto-trigger; milestone steps never show; rules stale | `user-identification.effects.ts:112-114`; `rule-engine.effects.ts:86-91`; `frame.enroll.ts:31-35`; `play-flow.enroll.ts:51` | F + E (iframe delivery INFERRED) | Widget, Auto-trigger, Steps |
| F4-66 | Auto-trigger waits for `isItemCompletionLoaded`, set only after a non-default user's file loads or a tool records progress this session; no `userIdentification`, an absent Custom key or an unresolved ApplicationID means no auto-trigger | Never pops up | `rule-engine.effects.ts:290-291`; `user-identification.effects.ts:80-83,412-435`; `user-identification.reducer.ts:43-58` | F + P | Auto-trigger |
| F4-67 | **Auto-trigger history is not read from the user file.** `sanitizeUserPreferences` drops `autoTriggerData`; only host `localStorage['apty_player_local_storage_persistent_fractions']` → `userDetailsState.userPreferences[userId].toolsCompletionProgress.autoTriggerData.flows[flowId][stepId]` counts, under any user ID including the default | Fires again in a new browser, after cleared storage, or on another origin; "never again" is per browser and origin | `user-identification.effects.ts:326-339,394-408`; `storage.effects.ts:52,336-340`; `user-identification.helpers.ts:75-96`; `localstorage.helper.ts:1-7` | **P** | User history |
| F4-68 | Frequency `Once`, or any missing or unknown value, returns false once a record exists | Fires once only | `rule-engine.effects.ts:306-308`; `rules-engine.types.ts:189-194` | F + P | Auto-trigger |
| F4-69 | Auto-trigger loops over **all** of `flow.json` with no segment, schedule, hide or rule-visibility check; ignores decision-step rules; skips frequency-blocked flows and fires the first that passes; a target with no `name[locale]` shows "flow not available" and the trigger is still recorded | Unexpected error modal, then never retries | `rule-engine.effects.ts:259-284,319-328`; `flows.effects.ts:586-597` | F | Auto-trigger |
| F4-70 | `TRIGGER_WF_AFTER_DELAY` is takeLatest: re-evaluation during `delay` restarts the timer; after it, `currentStepId` is checked (this is F4-22) | Delayed trigger may never fire on a busy page (INFERRED) | `rule-engine.effects.ts:313-317,342` | F (+R) | Auto-trigger |
| F4-71 | A failed hit test makes the step `NotVisible`, which still counts as found: no error, but the balloon renders `visibility:hidden` | Looks stuck, no modal | `flows.effects.ts:325,367-381`; `play-flow.component.tsx:515-520,586`; `element-identification.utils.ts:107-131,188` | P | Steps |
| F4-72 | A required step whose condition fails is hidden and the run stalls with no error. Every operand must pass; the top-level junction `type` is ignored; `ELEMENT_EXISTS` is jQuery `$(selector)` in the step's frame and needs a non-zero rect; `QUERY_MATCHES` uses the top URL's parameter as an unanchored regex, absent = false | Stuck step, no modal | `play-flow.component.tsx:522`; `play-flow.selectors.ts:108-144`; `play-flow.service.ts:342-395`; `element-identification.helpers.ts:237-245` | F + P | Steps |
| F4-73 | Every milestone step (not just the first) needs its `formId` frame active; replayed after frames change only with `InvokeStepAfterFramesUpdate` | No balloon, then the error after the wait time | `flows.effects.ts:373-380`; `frames.effects.ts:233-246` | F + P (frame truth O-3) | Steps / Frames |
| F4-74 | Decision point: only "true with exactly one action" bounces; anything else → next step; new engine polls every 1 s up to `timeOut*1000 \|\| 2000`; a rule id missing from `rules.json` = false; a bounce to another flow marks the current one Completed | "Wrong branch" | `flows.effects.ts:412-461`; `play-flow.effects.ts:175-201,221-234` | F (+R, O-3) | Steps |
| F4-75 | `checkForStepFailure` is skipped while the flow plays in a new window; it is dispatched before a decision point is evaluated, so `timeOut` > `workflowWaitTime` can raise the error (INFERRED) | Spurious "WorkFlow Error", or none | `play-flow.effects.ts:205-208,300-342` | F | Steps |
| F4-76 | A stale `stepId` from a launcher, smart canvas, announcement or auto-trigger gives no step data → error after `workflowWaitTime`. Launch from widget, onboarding, launcher or runtime message checks only that the flow exists with `name[locale]` (no schedule, segment or rule check) | Error modal after about 15 s | `play-flow.effects.ts:211-215,319-328`; `flows.effects.ts:583-598`; `launchers.component.tsx:122-126` | F | Launch |
| F4-77 | Runtime message `TRIGGER_WORKFLOW` (`externalUniqueId`) matches the filtered list; an unknown id plays `id: undefined` → error modal (sender not in repo; INFERRED OneX or Ask Dapty) | Error modal, or nothing | `components/player-ui/body/content/tool-list/tool-list.effects.ts:41-50` | F + E | Launch |
| F4-78 | Autopilot: list button only with `enableAutopilot`; a permalink ignores `enableAutopilot`; acts only when the element is in the main window (iframe steps need the user); `CLICK_NEXT` never automated (this refines D-33) | Autopilot does nothing | `list-item-row.component.tsx:156`; `flows.effects.ts:337-346,693,702`; `play-flow.service.ts:168-181`; `play-flow.effects.ts:771-816` | F + P | Launch / Steps |
| F4-79 | A scheduled flow with an empty `timeZone` is hidden; an invalid zone throws and drops it; the schedule filters only the list (not auto-trigger, permalink, launcher or CTA) | Missing from list | `shared/helpers/announcement.helpers.ts:30,59-76`; `tool-list.selectors.ts:27` | F | Item |
| F4-80 | Other resolver blockers: `preFetchAllData` throwing (e.g. an invalid raw RegExp in `regExpUrlCheck`) dispatches `*Failed` actions the resolver does not wait for; `SESSION_STORAGE_LOADED` waits on the background `GetFlowDetails` reply (undefined reply INFERRED never resolves); a popup waits on the opener (O-3) | No widget, no resume | `resolver.effects.ts:60-71,99,144-153`; `injected.helpers.ts:18-22`; `storage.effects.ts:273-282,353-356` | F / R | Load |
| F4-81 | `baseTag` missing: extension mode never attaches the container, so balloons and modals are invisible too; injected mode `querySelector(...).prepend` on null throws (INFERRED) | Nothing visible | `index.tsx:183-191,227-249` | F + P | Load |
| F4-82 | Resume: state in host `sessionStorage` (per origin and tab) or chrome.storage keyed by appId and appEnv; runs only after the resolver; re-checks `name[locale]`; with `EndWorkflowOnBrowserClose` a missing record means no resume (refines F4-45) | No resume after navigation | `storage.effects.ts:41-72,286-305`; `resolver.effects.ts:166-169`; `play-flow.effects.ts:667-691`; `play-flow.helpers.ts:71-76` | P | Steps (resume) |
| F4-83 | Permalink race: checked on every `LOAD_FLOWS_SUCCESS`, which can arrive before segments (then all flows pass) or before the locale (default 1, so the error modal may show) (INFERRED) | Plays outside its segment, or a false error | `flows.effects.ts:752-753`; `segments.selectors.ts:66-67`; `locales.reducer.ts:24` | P | Launch |
| F4-84 | Any locale change, including first detection on load, clears play-flow state (refines F4-41) | A started or resumed flow vanishes (INFERRED) | `locales.effects.ts:54-68,142-144` | P | Locale / Steps |
| F4-85 | Feedback shows at most once per flow per user record; success and feedback follow `displaySuccessBalloon` and `displayFeedback` | "No feedback prompt" | `play-flow.effects.ts:487-498,529-538` | F + P | Steps / completion |

Add the missing inventory rows **F4-07** (publishing off: no flows in the
widget list, WP9 text) and **F4-22** (= F4-70).

### D5. 4.x: corrected statements

| ID | Was | Correct |
|---|---|---|
| F4-06 | `rule-engine.helpers.ts:388-411` | `rule-engine.helpers.ts:45-68` plus the fail-open at `tool-list.selectors.ts:44-46` |
| F4-21 / WP9 | Data in the user file; needs a non-default user ID; decidable by U | The deciding record is in host localStorage (F4-67), under any user ID; decidable by **P**. "Never again" also applies to `Once` and unknown frequencies (F4-68) |
| D-34 / flag table | With `BrokenWorkflowRecovery` the flow is not nulled; widget instead of ending | The flow **is** nulled by `checkForStepFailure` (`play-flow.effects.ts:327-328`). The flag suppresses **every** error modal (`error-modal.component.tsx:63`), including launch and permalink errors. The widget needs `erroredStep` and `activeStepIndex < 0` (`broken-step-widget.component.tsx:308`); with the flag on, `flowPlayError` is never dispatched (`flows.effects.ts:271-273`) |
| F4-23 | Else the flow-error modal | Silent when `BrokenWorkflowRecovery` is on |
| D-09 / scripts table | `pauseFlow` hides the step | It **ends the run**: `nullifyPlayFlowStep` clears flowId, stepId and chrome storage, so no resume (`play-flow.effects.ts:623-626,444-474`); `fail()` cancels the run (`:619-621`) |
| D-28 / WP17 | Publishing off: files irrelevant; stop the file groups | `flow.json` is still loaded from the CDN at start (`resolver.effects.ts:130`; `flows.effects.ts:732-742`) and drives auto-trigger, permalink, launcher and CTA. Only **steps** come from the API (`flows.effects.ts:167-171`); the list switches to API data only on a locale change (`resolver.effects.ts:186-203`). So keep the flow, auto-trigger and launch file groups; mark the steps-file group "uses the legacy API" |
| P4-16 | Inferred | Certain (F4-65) |
| F4-32 | Present means visible plus 6 of 9 hit points | For flows, `NotVisible` also counts as present; the hit test decides only balloon visibility (F4-71) |
| D-29 | Removal location NOT VERIFIED | Removal at `tool-list.component.tsx:117` via `group-content.selector.ts:15-24`, covering all tags; the group shows only tags with `name[locale]` (`:9-13`), so a flow in an untranslated tag disappears entirely |
| F4-26 / F4-27 | Needs an active segment | The flow must be in active segments' `flows[]`, **or any flow when no segment is active** (`segments.selectors.ts:60-68`). A permalink does not check schedule, hide or rule. An active segment with an empty `flows[]` gives an empty list (`tool-list.selectors.ts:31`) |
| P4-07 | Wildcard, or raw RegExp when the flag is on | With the flag on, **both** are tried (OR); the wildcard is an unanchored substring match (`app.helper.ts:93`; `url-helpers.ts:82-105`); the whole app loop is in one `try`, so one invalid regex aborts every app; both test `window.top.location.href`; the flag type is `boolean \| string`, so `"false"` is truthy (`injected.helpers.ts:18-49`) |
| F4-37 | An optional step times out to the next | The timeout race runs only when `optionalTimeOut > 0` (`play-flow.effects.ts:264-277`); otherwise `NotPresent` skips at once, possibly backwards (`flows.effects.ts:387-396`) |
| Flag table | `EndWorkflowOnBrowserClose` at `index.tsx:340-342` | `index.tsx:342-344` |

### D6. 4.x: exact semantics to mirror

1. **Two failure timers.** `workflowFailEffect` runs only for list
   launches with the flag off (i18n title; its second branch is dead
   because `erroredStep` is null, `flows.effects.ts:219,250`, INFERRED).
   `checkForStepFailure` runs on every step-ID change (takeLatest), title
   hard-coded "WorkFlow Error". Wait = `workflowWaitTime*1000 || 15000`, so
   0 means 15 s (`app.selectors.ts:169-170`).
2. **Routing.** On 4.x, S-AUTO, S-LAUNCH and S-STEP also run the Widget
   group (F4-64, F4-65).
3. **Element types.** CSS (type 3) goes through extension-core
   `getIdentifiedElement` (`element-identification.helpers.ts:110-121`), so
   full parity needs O-3; without it, a CSS match on the page is
   `candidate`. XPath (type 4) is direct (`:124`). Custom script uses page
   `Function` in injected mode (`element-helpers.ts:44-49`).
4. **Frames** (ElementSelection, Auto, CustomScript, URI, LabelComparison;
   `frames.reducer.ts:31-45`) are evaluated by extension-core
   `FrameService` (`frame.enroll.ts:25`): "?" with inputs until O-3.
5. **Permalink parsing.** The href captured at bootstrap is used, and only
   `aptyref` is removed (`main.bootstrap.ts:116-118`), so `letznavref`
   replays on every reload. Only the last `?` segment is read, and the
   first parameter whose key *contains* the reference name. `shortid.isValid`
   applies to part 1; the step external ID is the full value
   (`url-helpers.ts:16-36`; `permalinks.effects.ts:41-60`).
6. **CDN timestamps.** Each file uses its content-config timestamp, then
   `latest`, then now (`content-config.helper.ts:5-29`; `api/backend.ts:274-290`).
7. **Closed-library decisions** (O-3): rule truth (`ruleEvaluator`),
   element selection and jQuery types, frame activity, step-frame match
   (`iframesService.isCurrent`, `play-flow.service.ts:273-283`) and opener
   messaging: "?" with their inputs.
8. **World parity for `WINDOW_VARIABLE`** (`localstorage.helper.ts:33-49`):
   mirror exactly: `window.top[first]` (throws in a cross-origin iframe,
   no try); intermediate string values are JSON-parsed; a falsy
   intermediate restarts at `window.top[kName]`; `doubleStringifyCheck` on
   the result. The Agent's reader today (`readUserValueInPage`,
   `apty-cdn-source.ts:419-447`) does none of this and reads frame 0 only.
   Build a parity table with the JSON-string, falsy-restart and
   cross-origin cases; record which frame the player evaluates in; show
   "?" when Apty runs in a child frame.

---

## E. New owner decisions (add to master §5 and ask with the others)

| ID | Question | Default |
|---|---|---|
| D-ACORN | Add `acorn@8.16.0` (the parser the 5.x Sval uses) as a direct `@apty/agent-core` dependency for script parse checks? | Yes. Without it, SCR-02 is "?" |
| D-TESTS | Approve the assertion migration list (C1): the listed assertions in `visibility-check.e2e.test.mjs` and `dapty-cdn.e2e.test.mjs` are replaced by assertions of the new behaviour for the same inputs? | Yes, limited to those assertions, each recorded in the phase review |
| D-RELEASES | Provide the 5.x player release ↔ commit mapping (at least which release first contains `9b2eef11`)? | **Partly answered by apty-dap `3ad61ef9` (§F1): per-environment widget display from 5.2.4.** Other rows stay `candidate` until the mapping is given |
| D-MODELB | Model B is "the Agent's configured model, whatever its provider" (not only Anthropic)? | Yes. A missing key is `no_key` |
| D-4XHEADERS | If the 4.x smoke test shows the CDN needs `AptyCustomHeaderKey`, may the Agent send that one header? | No until the smoke test shows it is needed; never `x-referer` |
| D-HTTP-ONPREM | Allow plain-http 4.x on-prem content hosts when the policy lists them? | No |

---

## F. apty-dap after the pinned commit (`3f3adba` → `dc502c81`)

apty-dap moved on by seven commits after the pin (to `dc502c81`,
2026-11-27). Five do not touch the web player (server, Studio, mobile,
automation). Two do, and they are binding:

### F1. `3ad61ef9`: per-environment widget display applies from player 5.2.4

`apps/core-service/src/accounts/application-config/application-config.service.ts`
(`mirrorProductionWidgetDisplay`): "Players before 5.2.4 read who sees the
widget from here, so it follows Production's; remove after 5.2.6". On
every environment save, the server copies the **Production** environment's
(`order === 1`) resolved `widgetDisplayConfig` into the application-level
`widgetConfig.display` and `selectedSegments`.

**So WNV-07 (A6) is:**

- player **≥ 5.2.4**: per-environment `widgetDisplayConfig` of the matched
  environment; missing means hidden (`segments.service.ts:64-80`);
- player **< 5.2.4**: app-level `widgetConfig.display` / `selectedSegments`
  (which the server now keeps equal to Production's). On a non-Production
  environment, add an info row: "this player shows the widget by
  Production's display setting, not this environment's". If the app-level
  value differs from Production's resolved display, the mirror has not run
  since the change (no environment saved yet): say so;
- version unknown: "?" naming both rules.

`minPlayerVersion: "5.2.4"` on the per-environment rule. Re-check the
mirror's removal after 5.2.6.

### F2. `a2d73e67`: step wait time comes from `workflowWaitTime`

`libs/client/tool-items-schema/src/mappers/flow-step.mapper.ts`: a
non-optional step now waits `applicationProperties.config.workflowWaitTime
× 1000` ms when that property is set, else `WORKFLOW_STEP_TIMEOUT_MS`
(5000). Optional steps still use `optionalTimeOut`. The same commit removes
`FlowsFocusTrap.tsx` (focus lock moves to `enableFlowFocusLock` in
`AttachedStep.tsx`).

**So:** W5-45 / W5-46 (and D3's timing row) get a version split — players
with `a2d73e67` use `workflowWaitTime`; older ones a fixed 5 s. C-18's
`enableFocusLock` row is re-read at `a2d73e67` (`AttachedStep.tsx`,
`libs/client/tool-items-schema/src/types/workflow.ts`). Until the release
containing `a2d73e67` is known (D-RELEASES), show both values and mark the
timing row `candidate`.

### F3. Which commit to cite

Keep citing `3f3adba` for everything else. For F1 and F2 cite the new
commits; read them with `git show <commit>:<path>` and change nothing in
apty-dap. Record in the phase review any other drift found between
`3f3adba` and the newest commit.
