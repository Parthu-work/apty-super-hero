# Master prompt: build the SE debugging flow end to end in apty-super-hero

**Version 2.** It changes version 1 in these ways:

- It reads the consolidated design `docs/development/se-flow-design.md`
  first.
- It adds the network-call policy as testable acceptance (§3.2, WP10 and
  WP15).
- It states the how-to route (WP6) and why the checks run in parallel
  (§3.1).
- It adds decisions D-ASKFIRST and D-DAPTY-WHEN.
- It adds the external dependencies (§3.3).
- It records that `inFlight` de-duplication is built (`c38343b`).

You are a coding agent working in **Parthu-work/apty-super-hero**. This is
a pnpm monorepo for the Chrome/Edge MV3 extension "Apty Agent", which Apty
Solution Engineers (SEs) use to find why Apty content does not work on a
customer page and how to fix it.

This file is the whole brief. It holds the confirmed design, every change
to make, where to find the evidence in Apty's code, and how each change is
proven. Read it end to end before you change anything.

---

## 0. How to work with this file

1. **Keep this file as the scope.** It lives at
   `docs/tasks/se-flow/IMPLEMENTATION-PROMPT.md`. After a context
   compaction, re-read it and `docs/STATUS.md`. Never guess scope.
2. **Read these first, in this order:**
   1. `CLAUDE.md` and `AGENTS.md`: package rules, test conventions, code
      style.
   2. `docs/STATUS.md`.
   3. **`docs/development/se-flow-design.md`: the final design and the
      single source of truth.** Where any other document differs, this
      one wins.
   4. `docs/development/se-flow-coverage.md`: every player condition, with
      IDs such as W5-08 or F4-21, and its citation.
   5. `docs/development/replay-network-source.md`: the request catalogue
      and the replay design, already built.
   6. `docs/development/se-flow-architecture.md`: the design history and
      its citations. Read it for background only.
3. **Keep `docs/STATUS.md` current.** Give each work package (WP) a row:
   not started, in progress, done or partial, with the commit and what is
   missing.
4. **Write `REVIEW.md` at the end** (§11).

---

## 1. Rules (these override everything below)

### 1.1 Repositories

| Repository | Role | Commit to read |
|---|---|---|
| `Parthu-work/apty-super-hero` | **The only repository you change** | Branch `claude/amazing-gauss-1q2tme`. It already holds the replay work (§2) |
| `aptyInc/apty-dap` (Apty 5.x) | **Read only.** Evidence for 5.x behaviour | `3f3adba84862ac031d219881441fbd2a15746d71`; paths under `packages/` |
| `aptyInc/apty-assist` (Apty 4.x) | **Read only.** Evidence for 4.x behaviour | `bbb4cbc518a9b1c84055d33ba56822aa7d58ca17`; paths under `player3.0/src/` |

- **Never modify apty-dap or apty-assist.** Do not open pull requests
  there, push there or edit files there. Read them only to confirm
  behaviour.
- **Never import Apty code.** Write the equivalent logic in the Agent and
  prove it matches with parity tests. Every rule that mirrors Apty
  behaviour cites `repo:path:line@commit` in its doc comment and in its
  `verifiedOn` field. Follow the existing pattern in
  `packages/browser-runtime/src/apty/diagnosis/content-not-visible.ts`
  (`VERIFIED_ON`).
- **Re-check every fact in §4 against the code before you rely on it.**
  If the code has moved on (a newer commit), cite the new location. Record
  any difference in `REVIEW.md`.

### 1.2 Git

- Work on `claude/amazing-gauss-1q2tme`, branched from `main`. Commit one
  WP at a time, with a message that names the WP.
- End each commit message with the attribution lines this environment
  gives you.
- **Do not push, merge, force-push or open a pull request** unless the
  owner asks in so many words.

### 1.3 Evidence over claims

- A WP is done only with passing tests and the pasted output.
- For every behaviour change, run the new test against the old code
  first, show it failing, then show it passing.
- **Never delete, skip or weaken an existing test.** If an existing test
  conflicts with a required change, change only its setup, keep its
  assertions, and explain why in `REVIEW.md`.
- Mark unfinished work **partial**, with exactly what is missing.
- Do not claim what you did not run. No real tenant, AI provider or
  Ask Dapty KB tenant is available unless the owner gives one. Say "not
  run" where that applies.

### 1.4 Verification commands

- `npm run preflight` must pass before you finish each WP. It runs
  format:check, lint, typecheck, test and test:coverage. The coverage
  thresholds in each `vitest.config.ts` are a ratchet: they may only go up.
- Run `npm run typecheck` after changing a package's exports. Sibling
  packages resolve through the `dist` that typecheck writes; run
  `pnpm -r --if-present build` when a test imports another package.
- **E2E:** `npm run build && E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`.
  You may run a single file with
  `node --test --test-timeout=180000 tooling/e2e/<file>.e2e.test.mjs`.
  **Never run unit tests and E2E at the same time.** Timing tests fail
  under CPU contention.
- Run these audits and keep them passing:
  - `npm run audit:architecture`
  - `audit:tools`
  - `audit:i18n`
  - `audit:any`
  - `audit:design-tokens`
  - `audit:docs-links`
  - `audit:settings-readers`
  - `audit:test-skips`
  - `lint:dependencies` (knip)
- `apps/mcp-bridge` is its own pnpm project. If its typecheck fails for
  missing modules, run
  `pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace`.

### 1.5 Architecture

- `@apty/agent-core`: pure TypeScript, with no Chrome and no provider SDK.
  It holds interfaces, types and pure decisions: version adapters, the rule
  evaluator, schema mirrors, aggregation, the provider chain and the
  quality check. It never imports `@apty/debug-contract`.
- `@apty/browser-runtime`: everything that touches Chrome. That covers
  fetching, page probes, MAIN-world readers, tools, check packs, the case
  run and the Ask Dapty client.
- `@apty/ui`: depends on `@apty/agent-core` only, **never** on
  `@apty/browser-runtime`. Views take plain types.
- `apps/browser-extension`: wiring, Options, the side panel and the
  manifest.
- **Plain objects and functions over classes** (CLAUDE.md). Vitest tests
  sit next to the code. Add no comments that restate the code; comment
  only a non-obvious *why*, and cite Apty code where the behaviour mirrors
  it.

### 1.6 Privacy and security (release blockers)

- Content requests are **GET only**, with `credentials: "omit"`, no
  redirects, and only catalogue paths from the player's own file list. A
  file outside the catalogue, or an ID that is not a plain path segment,
  is never requested. This is built in
  `packages/browser-runtime/src/apty/replay/catalogue.ts`.
- **Hosts.**
  - Content hosts come only from the page's Apty config or the org
    policy's `aptyContentOrigins`.
  - The Ask Dapty host and KB tenant come **only** from the org policy or
    Settings.
  - **Never** take a host from a model's text or from page text, apart
    from the page's own Apty config.
  - A page-named private-network or IPv6 host is refused; this is built.
- Every response body goes through the body deny list, which is checked
  **before** the request, and through the same redaction as the Client's
  record (`readResourceBody` in `apty/extension-network-inspector.ts`).
- **Nothing is stored on disk.** Bodies live in memory for the case
  (`apty/replay/case-replay.ts`, at most 20 cases).
- **No POST to Apty except Ask Dapty's public chat route.** Never call an
  authenticated, admin or Studio API, and never send cookies.
- The SE's question is redacted before it goes to Ask Dapty. No `userId`
  or `chatId` is sent.
- **Page reads.**
  - MAIN-world readers return only the values named by the rules being
    evaluated, as strings or JSON-safe values with a length cap.
  - They never read `HttpOnly` cookies (use `document.cookie` only), and
    never send page values to a model unredacted.
- **Customer scripts** (`customScript` rules, 4.x `segment-js.js`,
  custom-script element types and step scripts) are **never executed**
  unless owner decision **O-4** allows it.
- **Add no extension permission.** Keep `externally_connectable` as it
  is. Add no runtime dependency unless an owner decision allows it
  (decision D-UA).
- **Never log** keys, tokens, page content, tool results, request bodies,
  or URLs with query strings.

### 1.7 UI, copy and accessibility

- Every user-visible string goes in `packages/ui/src/i18n/locales/en.json`
  **and** `zh.json`, and `audit:i18n` passes.
- Use the existing design tokens only (`audit:design-tokens`) and the
  existing components:
  - `GateRow`, `CheckResultCard`, `VerdictFooter`;
  - `SupportBundleButton`;
  - `kb-matches-card`, `kb-unknown-setting`.
- **Copy rules** (follow the existing locale strings):
  - plain, specific language from the user's side;
  - active voice;
  - error text says what happened and how to fix it;
  - no apologies;
  - no internal jargon in user copy. Rule IDs appear only as small tags.
- **Accessibility:**
  - live updates use `aria-live="polite"`, and only the summary is
    announced, not every row;
  - every control is reachable by keyboard and has a visible focus state;
  - respect `prefers-reduced-motion`;
  - the axe E2E suites stay green: `tooling/e2e/a11y-*.e2e.test.mjs`
    (light and dark).
- The side panel works at 400 px and at 480 px wide (`chat-scroll-400`,
  `chat-scroll-480`).

---

## 2. What already exists on the branch (do not redo)

The branch has these commits on top of `main` `7d6e9ef`:

| Commit | What |
|---|---|
| `4753e7a` | **Replay, 5.x.** <ul><li>The `AptyContentSource` interface (`packages/agent-core/src/apty/content-source.ts`, with named failures `not_published`, `http_<code>`, `network`, `timeout`, `schema_mismatch`, `host_not_allowed`, `ids_missing`, `body_denied`, `too_large`, `unparsable`, `unknown_file`).</li><li>`aptyContentOrigins` in the org policy and `apps/browser-extension/managed-schema.json`.</li><li>`packages/browser-runtime/src/apty/replay/`: `catalogue.ts` (4.x and 5.x file catalogue and `filePath`), `schemas.ts` (minimal loose schemas), `content-source.ts` (`createReplaySource`, which includes the player timestamp and the 200 not-found detection), and `case-replay.ts` (per-case registry, `pinContext`, `replayResourceSource`).</li><li>The tools `resolve_apty_context`, `list_apty_files` and `fetch_apty_file` (`tools/apty-content.ts`, group `aptyContent`, file-route budget 11).</li><li>Per-gate `source` (`client`, `capture` or `agent`), with the card suffix and `filesFromReplay`.</li><li>A loader fix: a 200 `{status:404}` body is read as HTTP 404.</li><li>`replayVersion` on evidence.</li><li>`tooling/e2e/replay-source.e2e.test.mjs`.</li></ul> |
| `e973337`, `7119848` | A page-named content URL on a private-network or IPv6 literal host is refused unless the policy lists it |
| `7487016`, `5831beb`, `752de41`, `af4c7a6`, `d77fa34`, `a91a063` | Design documents and this prompt (§0) |
| `c38343b` | **`inFlight` de-duplication:** concurrent `fetchFile` calls for the same file share one request, `content-config.json` included (`apty/replay/content-source.ts`, with its test) |
| (this version) | `docs/development/se-flow-design.md`, the consolidated final design |

**Current flow (to change).**

1. A chat turn goes to **one** path: one check pack, a KB card answer, a
   file fetch, or the model. The local responders are registered in
   `apps/browser-extension/src/hooks/browser-agent-config.ts:203-259`
   (`combineResponders`, first answer wins).
2. Inside `createDiagnosisResponder`
   (`packages/browser-runtime/src/apty/diagnosis/responder.ts:748-813`)
   the order is: `routeCheck`, `routeLookup`, `asksAboutDapty`,
   `routeSymptom` (`router.ts:217`, **one** route), then `kbAnswer`.
3. A local answer emits `tool_call_start` and `tool_call_complete` back to
   back (`packages/agent-core/src/agent/apty-agent.ts:794-815`). There is
   no progress event (`packages/agent-core/src/types.ts:173-184`,
   AgentEvent union at about `:306`).
4. Files come from, in order (`apty/diagnosis/apty-files.ts:200-265`):
   1. the Client's record;
   2. the page capture;
   3. pinned replay;
   4. the probed CDN.

---

## 3. The confirmed design (what you are building)

**The SE's job:**

- Say what is wrong, in chat. Example: "workflow 'Create a lead' does not
  start".
- Give the tenant, application and environment IDs **only if** the Agent
  cannot read them from the page, or to check another environment.
- Give a user identifier only if a user-dependent check needs one and the
  page does not show it.

The rest of the debugging is the Agent's work.

**The flow:**

```
SE question
  → 0 resolve the Apty context: given IDs (pinned) | page probe + URL match | ask the SE
  → in parallel:
      1 Ask Dapty: public widget chat stream, dedicated KB tenant from the org policy,
        one KB application per version
      2 every check group the symptom needs, on files the Agent fetches itself (replay),
        the page, and its own rule evaluation; live checklist rows as each resolves
  → 2b cards (Confluence KB pack, in memory), only if Ask Dapty gave up or may have answered from the web
  → 3 ONE result: "Issues found, please fix all of these"
       (cause · evidence · fix · source), the Ask Dapty guidance (labelled) or the card as written,
       [Re-check] [Copy for support]
  → 4 nothing found, no KB answer, no card → [Ask AI anyway]
       → Model A (org OpenAI/Azure key, model gpt-6-luna) → quality check
       → on error or failure: Model B (Anthropic, the Agent's model) → quality check
       → on failure: "Not enough evidence" (unsupported claims "to check", next check, Copy for support)
```

**Decisions already confirmed by the owner** (do not revisit):

- **No script in the Apty Client** (`docs/integrations/apty/CLIENT-PATCH.md`
  and `TEST-RECORDER.md` become legacy). **No Client extension ID is saved
  or typed.** The Client record stays behind the org policy
  `aptyClientRecord: off | optional`, which defaults to `off`.
- **Both versions:** 4.x (apty-assist) and 5.x (apty-dap), one flow, with
  per-version adapters.
- **The checklist shows every step the Agent takes:**
  - context;
  - Ask Dapty;
  - cards;
  - each file;
  - each gate;
  - each "not checked" item.

  Each row carries its status (✓ pass, ✗ fail, ? could not decide,
  ℹ info) and its source (page, published file, Ask Dapty, cards,
  not checked).
- **Ask Dapty's text is guidance, never a cause.** A web answer cannot be
  detected for certain: the stream has no web-search event
  (`apty-dap: libs/shared/contracts/src/ai/ai-chat-widget/ai-chat-widget.schema.ts:37-44`).
- **Accuracy promise:** every cause shown is backed by evidence and is
  correct. Anything the Agent cannot decide is shown as "?" with the exact
  value that would decide it, never as a guess.
- **Ask AI anyway** uses Model A, then Model B, behind a deterministic
  quality check.
- **A bare how-to makes no content-file requests** (WP6 item 2).
- **Only necessary requests** (§3.2).

### 3.1 Why the checks run in parallel with Ask Dapty

- **The checks never read Ask Dapty's answer.** The symptom router
  chooses the checks from the SE's message, and Ask Dapty's text is
  guidance only.
- **Speed.** Rows appear within about a second. The result appears when
  the slower of the two finishes; Ask Dapty streams for several seconds
  and times out at 20 s.
- **Resilience.** An Ask Dapty error, timeout, give-up or missing setup
  never blocks the root cause.
- **Accuracy.** An unverifiable answer must not suppress the checks: Ask
  Dapty gives no sources, and a web answer cannot be detected.
- **Only the cards wait for Ask Dapty.**
- **Do not make the checks wait for Ask Dapty**, unless the owner picks
  D-DAPTY-WHEN = "only when the checks find nothing". In that case Ask
  Dapty starts after the checks, and only if they found no cause.

### 3.2 Network-call policy (acceptance criteria, asserted in WP10 and WP15)

| Situation | Content-file requests allowed | Ask Dapty |
|---|---|---|
| Bare how-to | **0** | 1 |
| All three IDs given | No `app-urls.json` lookup | — |
| Only some IDs, or IDs from the page | `app-urls.json` exactly once | — |
| A symptom | Only the files its check groups declare (each group exports its file list), each **at most once per case**, plus `content-config.json` once for the version stamp | 1, in parallel |
| A user-specific check | `users/{id}.json`, only when such a check runs and the ID is known | — |
| Element, page, rule and segment checks | **0** (local page reads) | — |
| A follow-up question in the same case | **0** new requests; answered from the case cache | Only if the question changed |
| Re-check | One **conditional** request per file (`If-None-Match` / `If-Modified-Since`) | Only if the question changed |
| Limits | At most 6 concurrent and 40 per case; 5 MB per file and 25 MB per case | — |

Built already:

- the per-case cache, including `not_published`;
- `inFlight` de-duplication;
- conditional requests;
- the catalogue-only paths and host allow-list.

No AI model request is made on the check path.

### 3.3 External dependencies (none needs Apty to act per case)

| Dependency | Handling |
|---|---|
| Apty's public file paths and formats stay stable | Coverage manifest and `audit:apty-coverage` (WP1) |
| The real content host serves without authentication | Real-tenant smoke test (WP13). Until it runs, mark this "not run" |
| An Ask Dapty KB tenant with documents, and the route staying public | D-KB. Without it, the checks and cards still work |
| Org policy set once by IT | WP3, WP11, WP12; document the defaults (WP14) |
| `aptyInc/apty-extension-core` and `rules-engine-package` | O-3; until then, those 4.x rows are "?" |
| The SE's network reaches the content host | The row shows the exact `network` or `timeout` error |

---

## 4. Facts to rely on (verified; re-check before use)

Facts marked ✔ were re-read at the commits in §1.1. The full list, with
every condition, is in `docs/development/se-flow-coverage.md`; the work
packages below repeat what each one needs.

### Network and endpoints

- ✔ **5.x content path:** `{contentURL}/tenant-{t}[/app-{a}[/env-{e}]]/{file}?timestamp={ts}`
  (`apty-dap: libs/shared/cdn-api/src/cdn-path.builder.ts:26-31`,
  `cdn-reader-api.ts:69-132`). No credentials and no headers
  (`libs/shared/axios-client/src/axios-client.ts:34`).
- ✔ **Timestamp:** the timestamp is `getFileTimestamp(contentConfig, path)`
  (`apps/player/src/main-content-script/cdn/file-timestamp.ts:4-27`), and
  `content-config.json` itself uses `Date.now()` (`cdn.service.ts:147`).
- ✔ **Unpublished file:** CloudFront answers 200 with a `{status:404}`
  body, and MinIO answers a real 404 (`axios-client.ts:45-54,84-88`).
- ✔ **4.x:** the path is the same, plus `&token=` (empty) on every content
  GET (`apty-assist: shared/helpers/common-helpers.ts:90-95`). The
  timestamp is `cc[app][env][file] || cc.latest || now` over the merged
  tenant and app content-config (`shared/content-config.helper.ts:5-29`;
  `main.bootstrap.ts:172-178`).
- ✔ **Ask Dapty:**
  - Routes: `POST {aiBackendURL}/ai-service/api/v1/ai/{tenantId}/widget/chat/stream?applicationId=…`,
    with `/widget/chat` as the one-shot route.
  - Access: public (`apty-dap: libs/server/core/src/auth/auth.guard.ts:11,53-55`).
    CORS never rejects a request; an unknown Origin only leaves out the
    allow headers (`libs/server/core/src/app-origin-cors/app-origin-cors.delegate.ts:40-68`).
  - Body: `{message, context[], envId, applicationType, userId?, chatId?}`
    (`ai-chat-widget.schema.ts:20-29`).
  - SSE events: `token`, `tool_start`, `tool_end`, `done{reply,suggestions}`,
    `title`, `error` (`:37-44`).
  - Give-up text, exact (`apps/ai-service/src/api/ai-chat-widget/ai-chat-widget.service.ts:23-24`):
    "I couldn't find information about that in the available documentation. Could you rephrase, or check with your team?"
    The server forces this text only when the reply is empty, and then
    drops the suggestions (`:144-146`).
  - Error reply: "Sorry, I was unable to generate a response. Please try
    again." (`:89`). Stream failure: `{type:'error'}` with "The assistant
    could not complete this reply." (`ai-chat-widget.controller.ts:11,90`).
  - Retrieval filters on `tenant_id` and `application_ids ∋ {appId | __tenant_wide__}`
    (`apps/ai-service/src/vector-store/vector-store.service.ts:175-185`).
- ✔ **Model A's default name:** `gpt-6-luna` is ai-service's default OpenAI
  model (`apps/ai-service/src/llm/llm.constants.ts:3-7`). It is a model
  name only; the Agent calls OpenAI or Azure with the org's own key.

### Page probes

- **5.x Extension mode:** `chrome-extension://<id>/window-script.js` on the
  page, then the web-accessible `player-config.json` gives `contentURL`
  and `tenantId`. **5.x Injected mode:** `window.__APTY_PLAYER_CONFIG__`.
  Both are built: `apty/apty-cdn-source.ts` `tabAptyPage`.
- ✔ **4.x Extension mode:** the player injects
  `chrome-extension://<id>/window.var.js` (`apty-assist: shared/helpers/react.element.helper.ts:7-19`;
  `main.bootstrap.ts:203-207`). `config.json` is web-accessible
  (`player3.0/src/manifests/manifest.json:17-21`) and holds `contentURL`,
  `tenantKey`, `regExpUrlFlag`, `isSelfHosted` and others; read only those
  four.
  - **Caveat:** on a page where no application matches, the player stops
    before `window.var.js` (`main.bootstrap.ts:162-170`), so the probe
    finds nothing and the Agent must ask for IDs.
- ✔ **4.x Injected mode:** the `#letznav-script` attributes
  `data-instanceid`, `data-content-url`, `data-app-urls`,
  `data-reg-exp-url` and `data-self-hosted` (`shared/helpers/injected.helpers.ts:344-375`).

### Environment matching

- ✔ **5.x** (`apty-dap: libs/client/tool-items-schema/src/helpers/active-application.helpers.ts:3-45`):
  - each pattern is escaped, `*` becomes `.*`, and the match is
    **unanchored** (a substring match);
  - environments are sorted by `order`;
  - the first app with a match wins, in file order;
  - regex matching is never used, because feature flags are never fetched
    (`apps/player/src/main-content-script/cdn/cdn.service.ts:937-939`).
- **4.x** (`apty-assist: shared/helpers/injected.helpers.ts:18-49`;
  `shared/helpers/app.helper.ts:81-109`; `url-helpers.ts:82-105`):
  - apps are taken in order;
  - env keys are sorted with `Object.keys(o).map(Number).sort()`. That
    sorts **as strings**, so "10" comes before "2";
  - each pattern is a wildcard, or a raw `RegExp` when the
    `feature-flag.json` `regExpUrl.status` flag is on;
  - `enablePlayer` comes from the env matched in `app-data.json`,
    otherwise env 1;
  - self-hosted: the content URL becomes `{hostedContentUrl}/contents`
    (`main.bootstrap.ts:138-150`).

### Current Agent defects found by the research

- ✔ **5.x widget display drift.**
  - **The player:** since apty-dap `9b2eef11` (2026-11-16), display is per
    environment: `appData.environments[envId].widgetDisplayConfig.{display, selectedSegments}`.
    A missing config means **None, so the widget is hidden**
    (`apps/player/src/main-content-script/segment/segments.service.ts:64-80`;
    `libs/shared/contracts/src/accounts/application-config/application-config.schema.ts:287-295`).
    The app-level `config.widgetConfig.display`, `selectedSegments` and
    `enabledForOtherUser` are **ignored**.
  - **The Agent:** its check
    (`packages/browser-runtime/src/apty/diagnosis/widget-not-visible.ts:365-429`,
    WNV-07, verified at `4c406d5`) reads the app-level fields. It is
    **wrong today**.
- ✔ **5.x auto-trigger fields.** Auto-trigger is driven only by the
  workflow's `stepsAutoTrigger[].attachedRule`
  (`libs/client/tool-items-schema/src/mappers/workflow.mapper.ts:89-93`;
  `cdn.service.ts:452-466`). The workflow-level `autoTriggerRuleId`,
  `autoTriggerFrequency` and `autoTriggerDelay` fields are read nowhere in
  the player.

---

## 5. Owner decisions to ask at the start

Ask these in **one message** before you begin. Start meanwhile with WPs
that don't depend on them. A default applies only if the owner replies
"use defaults".

| ID | Question | Default |
|---|---|---|
| O-3 | Grant read access to `aptyInc/apty-extension-core` and `aptyInc/rules-engine-package`? They hold the 4.x frame, element-selection and rule logic; `player3.0/package.json:29-30` pins them | No access. The 4.x rule-tree and element-selection rows stay "?" and show their inputs |
| O-4 | May the Agent execute customer scripts (`customScript` rules, 4.x `segment-js.js`, custom-script elements) to decide a rule? | No. Rows are "?" and name the script |
| O-5 | May the Agent ask the SE for an Apty ID that lives in the Client's storage, when a user-dependent row needs it? | Yes: once, with one copy step |
| O-6 | Fix the 5.x widget display check first? | Yes |
| D-UA | Allow two small runtime dependencies so `os`, `browser`, `device` and `country` rule sources match the player exactly (`ua-parser-js` ^2.0.7, as in `apty-dap: libs/client/rules-engine/package.json`, and a timezone-to-country table)? | No. Write a minimal equivalent in agent-core for the common families, and mark any rule on a value it can't classify as "?" |
| D-WIN | The player's `window` source **calls functions** on the dotted path (`apty-dap: libs/client/rules-evaluation/src/main-world/window-ipc-handles.service.ts:27-46`). May the Agent's reader do the same? | No. Read properties only; a path that reaches a function gives "?" with "the player calls this function" |
| D-KB | Who owns the KB tenant: its documents, with one application each for 4.x and 5.x plus tenant-wide common documents? | Owner names one. Until set, `askDapty` is absent and no call is made |
| D-CLIENT | Delete the Client-record code, or keep it behind `aptyClientRecord: optional`? | Keep it, off by default |
| D-SELFHOSTED | 4.x self-hosted `hostedContentUrl` names a host the policy may not list | Use it only when it is in `aptyContentOrigins`; otherwise the row is `host_not_allowed` and names the host to add |
| D-ASKFIRST | Always confirm the tenant, application and environment in the intake card before the first content request, even when they were read from the page? | No. Read them from the page and ask only for what is missing. Implement the mode behind a setting (WP6), off by default |
| D-DAPTY-WHEN | Call Ask Dapty in parallel with the checks, or only when the checks find nothing? | In parallel. Implement the alternative behind a setting (WP11) |

---

## 6. Target architecture

```
@apty/agent-core
  apty/content-source.ts          (built) AptyContentSource, named failures
  apty/versions/                  NEW  AptyVersionAdapter + v5.ts + v4.ts (pure: matching, timestamp, ID shapes, paths)
  apty/schema-mirror/             NEW  per-file validators mirroring the player's per-item and whole-file parse rules
  apty/rules/                     NEW  5.x rule evaluator (grammar, compare, predicates, resolver) + 4.x segment evaluator
  apty/coverage/                  NEW  condition IDs, rule registry (status: active | candidate), symptom → groups map
  case-run/                       NEW  CaseRunEvent, ChecklistRow, CaseRunResult, aggregate()
  ask-dapty/                      NEW  DaptyAnswer types, classify() (pure)
  answer/                         NEW  provider chain decisions, FallbackReason, qualityCheck() (pure)
  agent/ + types.ts               CHANGE LocalAnswer.progress, AgentEvent "tool_call_progress"
  config/org-policy.ts            CHANGE askDapty, modelA, aptyClientRecord

@apty/browser-runtime
  apty/replay/                    (built) + CHANGE: adapters, 4.x timestamp/matching, stored chats
  apty/probes/                    NEW  probe5x, probe4x (ext + injected), page-input reader (MAIN world)
  apty/diagnosis/                 CHANGE fix WNV-07; NEW check groups; router returns all routes
  apty/case-run/                  NEW  orchestrator (parallel groups, rows, result, Re-check)
  apty/ask-dapty/                 NEW  SSE client, one-shot fallback, redaction, rows
  answer/                         NEW  provider chain runner (Model A → Model B), error classification
  tools/                          CHANGE relevance; inspect_extension_network fallback to replay

@apty/ui
  case-run views                  NEW  live checklist, result card, guidance panel, AI answer, Not enough evidence
  lib/kb-grounding.ts             MOVE the pure parts to agent-core (quality check), keep the UI wrappers

apps/browser-extension
  hooks/browser-agent-config.ts   CHANGE register the case-run responder
  components/investigation/*      CHANGE render progress rows, Ask AI anyway for all "nothing found" cases
  components/connections/first-run.ts   CHANGE "client" row → info "Apty found: version · mode"
  entrypoints/options/*           CHANGE hide Client ID panels unless aptyClientRecord=optional; Ask Dapty + Model A status
  managed-schema.json             CHANGE askDapty, modelA, aptyClientRecord
```

**Where things run.** The agent loop, local responders and tools run in
the side panel (an extension page with `<all_urls>` host permission; CORS
does not apply). The MCP-bridge path runs the same tools in the service
worker. Keep long requests (the Ask Dapty stream) in the side-panel
context. Abort them when the conversation closes, or after 20 s with no
event.

---

## 7. Work packages

Every WP lists:

- **Change:** files to change or create.
- **Read:** evidence in apty-dap or apty-assist.
- **Do:** the behaviour.
- **UI:** where there is any.
- **Prove:** tests.
- **Done when:** the acceptance criteria.

Condition IDs (W5-xx, F4-xx and so on) refer to
`docs/development/se-flow-coverage.md`; the needed ones are repeated here.

### WP0: Baseline

- **Do:**
  1. Run `npm run preflight` and the E2E file
     `tooling/e2e/replay-source.e2e.test.mjs`, and paste the results.
  2. Ask the §5 decisions.
  3. Add the WP rows to `docs/STATUS.md`.
  4. Add a line for `se-flow/` to `docs/tasks/README.md`.
- **Done when:** the baseline is green, or each existing failure is
  recorded with its output.

### WP1: Fix drift, and the coverage manifest

**Change:**

- `packages/browser-runtime/src/apty/diagnosis/widget-not-visible.ts`
  (WNV-07 and its tests), `types.ts` (new reasons), and
  `packages/ui/src/i18n/locales/{en,zh}.json`.
- New: `docs/development/coverage-manifest.json`,
  `tooling/scripts/check-apty-coverage.mjs` (and its `.test.mjs`), and an
  `audit:apty-coverage` script in `package.json`.

**Read:**

- `apty-dap: apps/player/src/main-content-script/segment/segments.service.ts:64-80`
- `libs/shared/contracts/src/accounts/application-config/application-config.schema.ts:285-295`
- `git log 9b2eef11` for the change itself

**Do:**

1. **5.x widget display** reads `environments[envId].widgetDisplayConfig`:
   - missing or `null` → **None**, a cause ("the widget is turned off for
     this environment: no display setting is saved");
   - `None` → a cause;
   - `All` → pass;
   - `Specific` → needs one active segment in `selectedSegments`, decided
     by WP5. Until WP5 lands: "?" with the segments named.
2. When the app-level `widgetConfig.display`, `selectedSegments` or
   `enabledForOtherUser` is set, show an **info** row: "This setting has no
   effect in 5.x; the environment's display setting decides." Keep the 4.x
   path (`widget-not-visible-4x.ts`), which still reads `widgetConfig`.
3. Update `VERIFIED_ON` to `3f3adba`.
4. **The coverage manifest.** One entry per condition ID:
   `{id, version, repo, path, lines:[from,to], sha256 of those lines at the verified commit, ruleIds:[...]}`.

   Seed it from `se-flow-coverage.md`, at least every condition a WP
   implements.

   `check-apty-coverage.mjs --dap <path> --assist <path>` hashes the cited
   ranges in read-only checkouts. Changed or missing ranges exit non-zero
   and list the rule IDs to re-verify. New files under the player's
   visibility directories are listed as "unmapped":

   - `apps/player/src/main-content-script/{visibility-rules,segment,cdn,tool-items}`
   - `player3.0/src/components/**/{segments,rule-engine,flows,tooltips,launchers,announcements}`

   Without checkouts it exits 0 and prints "skipped: no checkout". It must
   not break preflight.

**Prove:**

- Unit tests with synthetic `app-data.json` for every branch above: None,
  missing, All, Specific (active, inactive, unknown), and app-level fields
  set.
- A test that the old app-level behaviour no longer decides 5.x.
- Tests of the manifest script, using temporary directories.

**Done when:**

- the tests pass;
- `tooling/e2e/visibility-check.e2e.test.mjs` and `dapty-cdn.e2e.test.mjs`
  still pass, or their fixtures are updated with a `REVIEW.md` note
  (fixtures only, never assertions);
- the manifest has an entry for every condition implemented later.

### WP2: Version adapters (5.x moved, 4.x added)

**Change:**

- New: `packages/agent-core/src/apty/versions/{index,v5,v4}.ts` (with
  tests).
- `packages/browser-runtime/src/apty/replay/{content-source,catalogue,case-replay}.ts`.
- New: `packages/browser-runtime/src/apty/probes/{probe5x,probe4x}.ts`,
  which moves the probe code out of `apty-cdn-source.ts`.
- `apty/diagnosis/pack-kit.ts` (`playerVersionOf`).

**Read:** the §4 page probes and environment matching, plus:

- `apty-assist: shared/types/common-models.types.ts:1022-1031`: the
  `app-urls.json` shape `{id:number, environments:{[n]:{url, hostedContentUrl?}}}`.
- `main.bootstrap.ts:133-136`: the tenant content-config timestamp.
- `main.bootstrap.ts:276-285`: `app-urls.json` uses an ISO-date timestamp.
- `api/backend.ts:373-377`: `most-used-content.json` uses local midnight.

**Do:**

1. `AptyVersionAdapter` is a plain object. Its fields:

   | Field | Meaning |
   |---|---|
   | `version` | `4.x` or `5.x` |
   | `files` | the catalogue |
   | `looksLikeIds(ids)` | 5.x: UUIDs; 4.x: a short tenant key, a numeric app and numbered envs |
   | `filePath` | as built |
   | `urlSuffix` | as built |
   | `contentConfigFiles(ctx)` | 5.x: tenant; 4.x: tenant and app |
   | `timestamp(ctx, file, contentConfigs, now)` | the version's timestamp rule |
   | `matchEnvironment(appUrls, pageUrl, regexOn)` | the version's matching rule |
   | `regexFlag(files)` | 5.x: always false; 4.x: `feature-flag.json` `regExpUrl.status` |
   | `contentURLFor(ctx, match)` | 4.x self-hosted handling |
   | `packs` | symptom → check groups |

2. **5.x:** move the existing logic onto the adapter. Behaviour must not
   change: the existing replay tests must pass unchanged.
3. **4.x:**
   - matching that reproduces the **string sort** of numeric keys;
   - the regex flag from `feature-flag.json`;
   - env 1 as the default when no env matches;
   - the merged-content-config timestamp, with an ISO timestamp for
     `app-urls.json` and local midnight for `most-used-content.json`;
   - self-hosted `{hostedContentUrl}/contents`, only if the host is in
     `aptyContentOrigins` (D-SELFHOSTED).
4. **Probes:**
   - 4.x Extension mode: find `chrome-extension://<id>/window.var.js` in
     `performance.getEntriesByType("resource")` or `script[src]`, then
     fetch `config.json` and keep only `contentURL`, `tenantKey`,
     `regExpUrlFlag` and `isSelfHosted`;
   - 4.x Injected mode: read the `#letznav-script` attributes;
   - run the 5.x probe first, then 4.x;
   - the probe result names the version and mode.
5. **Choosing the version:** the version the SE names, then the probe,
   then the ID shape, then ask the SE. Pin it with the context. Evidence
   carries `replayVersion` (built).

**Prove:**

- Adapter unit tests:
  - 4.x key order "1", "10", "2";
  - the regex flag on and off, including an invalid regex;
  - the self-hosted host allowed and not allowed;
  - each timestamp rule;
  - ID-shape inference.
- Probe unit tests with fake DOM and fake fetch.
- **E2E** `tooling/e2e/replay-4x.e2e.test.mjs`. A fake 4.x Client
  extension serves `window.var.js` and a web-accessible `config.json`, and
  a fake content host serves the 4.x fixtures
  (`packages/browser-runtime/src/apty/diagnosis/fixtures/content-4x`).
  The 4.x content check must reach its verdict with no Client record, and
  every request must be a GET with no cookie and an empty `token=`.

**Done when:** all of the above pass and the 5.x E2E tests are unchanged.

### WP3: Remove the Client dependency (no script, no saved ID)

**Change:**

- `packages/agent-core/src/config/org-policy.ts` and its test (new key
  `aptyClientRecord`), and `apps/browser-extension/managed-schema.json`.
- `packages/browser-runtime/src/apty/diagnosis/apty-files.ts`: the source
  order.
- `apty/diagnosis/dapty-sources.ts`: stored chats via replay.
- `apty/apty-cdn-source.ts`: retire it into replay.
- `tools/extension-network.ts` and `tools/file-fetch-responder.ts`: fall
  back to replay.
- `apps/browser-extension/src/components/connections/first-run.ts:86-95`.
- `apps/browser-extension/src/entrypoints/options/{apty-client-panel,client-network-calls-panel,index}.tsx`.
- `packages/ui/src/components/settings/apty-cdn-card.tsx`.
- Docs: `docs/integrations/apty/README.md`, `CLIENT-PATCH.md` and
  `TEST-RECORDER.md` are marked "legacy: needed only with
  `aptyClientRecord: optional`".

**Read:**

- `apty-dap: apps/player/src/main-content-script/widget/ai-chat/widget-chat-storage.service.ts:68-80,110,138`:
  stored chats at `users/{userId}/widget-chat/chat-list.json` and
  `{chatId}.json`.
- `user-tracking/user-tracking.service.ts:46-76,153-172`: the user ID.

**Do:**

1. **Source order:**
   1. page capture (a real observation in Injected mode);
   2. replay for the pinned or probed context;
   3. the Client record, only with `optional`.

   With `off` (the default), the Agent never pings or messages the Client,
   and never reads `clientExtensionId`.
2. **Move the probed-CDN path onto `createReplaySource`.** The stored-chat
   read uses `fetchFile(ctx, "users/{userId}/widget-chat/chat-list.json")`
   and `{chatId}.json`. Delete the duplicate request code in
   `apty-cdn-source.ts` once its tests are moved (keep the probes; WP2
   moves them).
3. **`inspect_extension_network` and the file-fetch responder.** When the
   Client is not used, answer from `fetch_apty_file`, with the same result
   viewer and `get_evidence_json` paging.
4. **UI:**
   - **First run:** remove the "Apty Client ID" to-do. Show an info row:
     "Apty found on this page: 5.x, Extension mode", or "No Apty on this
     page: the Agent will ask for IDs when needed".
   - **Options:** hide the Client ID, Client connection and Widget network
     calls panels unless `aptyClientRecord` is `optional`. Show a
     read-only "Apty content hosts" list from the policy.
   - **Settings card "Apty content CDN":** reword it to "The Agent reads
     Apty's published files itself", keeping the existing on/off switch.

**Prove:**

- Unit tests for every source-order branch, and for `off` never calling
  `sendExternalMessage`.
- Stored chat via replay.
- First-run row states.
- An Options visibility test (`*.test.tsx`).
- **E2E:**
  - `dapty-cdn.e2e.test.mjs` passes with `aptyClientRecord` absent;
  - a new case: with the policy `optional` and a fake answering Client,
    the Client record is used first.
- `audit:settings-readers` passes.

**Done when:** no code path contacts a Client by default, and every
existing E2E test passes.

### WP4: Schema-drop mirrors (silent drops become causes)

**Change:**

- New: `packages/agent-core/src/apty/schema-mirror/{v5,v4,index}.ts`
  (with tests).
- `packages/browser-runtime/src/apty/diagnosis/loader.ts`: `LoadedFile`
  gets `dropped?: Array<{index, id?, field, reason}>` and
  `wholeFileRejected?: {field, reason}`.
- New rule IDs SCH-01…; i18n.

**Read (5.x):**

- Per-item drop: `apty-dap: libs/shared/axios-client/src/axios-client.ts:116-140`
  and `libs/shared/cdn-api/src/cdn-reader-api.ts:48-56`.
- Whole-file parse: `cdn-reader-api.ts:73-109,126-134` covers
  `app-urls.json`, `app-data.json`, `workflow-{id}.json` and
  `users/{id}.json`.
- Schemas:
  - `libs/shared/contracts/src/dap/workflow/workflow.schema.ts:30-76,150-183`
  - `workflow-step.schema.ts:32-256`
  - `tooltip/tooltip.schema.ts:35-98`
  - `tool/tool.schema.ts:7-59`
  - `common.schema.ts:55-103`
  - `launcher/launcher.schema.ts:140-158`
  - `knowledge-content/knowledge-content.schema.ts:52`
  - `announcement/announcement.schema.ts:200-250`
  - `segment/segment.schema.ts:55-74`
  - `rule/rule.schema.ts:16-20,140-146`
  - `application/application.schema.ts:81-190,279-309`
  - `application-locale/application-locale.schema.ts:17-30`
  - `libs/client/tool-items-schema/src/schemas/user-preference.schema.ts:106-110`
  - `libs/shared/core/src/utilities/smart-canvas-utils.ts:192-198`
    (`hasNonEmptyHTMLContent`)

**Read (4.x):** files that are not lists fall back to the default
(`apty-assist: api/http.ts:278-284`), and the TypeScript models are in
`shared/types/*.types.ts`. 4.x has no zod, so mirror only the faults that
change behaviour: a missing `name[locale]`, an empty steps file, a
non-list steps file, and `app-data.json` with no `config.customConfig`.

**Do:**

1. Each mirror reports **why** the player drops an item or rejects a
   file. Minimum 5.x causes:
   - id or `sourceId` is not a UUID;
   - a missing boolean;
   - `order` outside 1–9999;
   - a blank `locales[].name`;
   - empty success or feedback HTML;
   - **the visibility pair mismatched** (`visibilityRuleId` and
     `visibilityRuleAction`: both set, or both null or absent);
   - **the auto-trigger trio mismatched**;
   - a bad `stepsAutoTrigger` item;
   - **a tooltip with any blank `contentHTML` row**, which drops it in
     every language;
   - a missing tooltip `screenshotConfig`;
   - a non-UUID `themeId` or `popupSourceId`;
   - a step's `order` below 0, `optionalTimeOut` below 1, empty
     `advanceOn`, empty HTML, or bad `splitStep`. Any one of these makes
     the **whole** steps file `[]`.
2. **Rows:**
   - "Dropped by the player: workflow "X" has `visibilityRuleId` without
     `visibilityRuleAction` (workflow.json item 4)";
   - "Rejected by the player: workflow-….json step 3 has an empty
     advanceOn, so the workflow cannot start".
3. **Side effects to report:**
   - a dropped `segment.json` row makes its items unsegmented, so visible
     to everyone;
   - a dropped `rule.json` row hides the items whose visibility rule
     pointed at it.

**Prove:**

- One fixture per drop cause, under
  `packages/browser-runtime/src/apty/diagnosis/fixtures/` (synthetic
  only).
- Unit tests that the mirror and the loader name the field.
- A parity table: for each cause, the Apty schema line it mirrors.

**Done when:** every cause listed above is reported with the field and the
item.

### WP5: Rule and segment evaluation on the page

**Change:**

- New: `packages/agent-core/src/apty/rules/{types,compare,predicate,resolver,evaluate,segments5x,segments4x}.ts`
  (with tests).
- New: `packages/browser-runtime/src/apty/probes/page-inputs.ts`, a
  MAIN-world reader with its tests, plus `apty/probes/user-file.ts`.
- `apty/diagnosis/content-not-visible.ts` and `widget-not-visible.ts`,
  changing segment and visibility rows from "?" to evaluated.

**Read (5.x engine):**

- `apty-dap: libs/shared/rules-engine/src/rule/rule-evaluator.ts`,
  `compare.ts`, `predicate.ts`, `resolver.ts` and `types.ts:67-218`.
- Sources:
  - `libs/client/rules-engine/src/browser-context.ts:12-53`
  - `libs/client/rules-engine/src/helpers/page.ts:3-36`
  - `libs/client/rules-evaluation/src/main-world/window-ipc-handles.service.ts:10-111`
  - `libs/client/rules-evaluation/src/context/rule-evaluation-context.service.ts:64-86,163,192-262`
  - `apps/player/src/main-content-script/tool-items/rule-engine/player-rule-evaluation.bindings.ts:132-228`
- Segments:
  - ✔ `apps/player/src/main-content-script/segment/segments.service.ts:51-55`
  - ✔ `visibility-rules/segments-rule.service.ts:26-34`
  - `cdn/cdn.service.ts:658-663`
  - `libs/client/tool-items-schema/src/mappers/workflow.mapper.ts:60`
- Visibility rule:
  - `libs/client/tool-items-schema/src/mappers/rule-engine.mapper.ts:13-24`,
    where the action is always SHOW;
  - `visibility-rules/rule-engine-visibility-rule.service.ts:20-41`;
  - `visibility-rules/visibility-rules.service.ts:14-17`, the AND of
    Segments, Engine, Later and Recurrence.

**Read (4.x segments):**

- `apty-assist: shared/helpers/segments.helpers.ts:11-37,92-120`
- ✔ `shared/helpers/segment-executor.helpers.ts:130-179`, where an absent
  key is false even for `not_equals`
- `components/tools-ui/segments/segments.effects.ts:55-82`
- `components/app/analytics/common-store-utils.ts:39-121`
- `segments.selectors.ts:37-161`

**Do (5.x evaluator, pure, parity with the player):**

1. **Grammar:**
   - `group` is `AND` or `OR`, short-circuited, with no NOT;
   - `condition` is `left` (var) · operator · `right` (literal, var or
     array).
2. **Operators:**
   - `eq` / `neq` compare strictly with no coercion; Date versus string
     parses the string (`YYYY-MM-DD` as local midnight).
   - A **missing value makes `neq`, `notContains` and `notIn` true**.
   - `contains` works on a string, an array element (by equality), or an
     object key.
   - `startsWith` / `endsWith` need a string on the left.
   - `gt`, `gte`, `lt`, `lte` convert to numbers: a Date becomes its
     milliseconds, a number is kept, and a non-blank string is **tried as
     a date first, then as a number**. This mirrors V8, so `"5"` reads as
     2001-05-01.
   - `in` / `notIn` take an array or object on the right.
   - `regex` is `new RegExp(right).test(left)`, with no flags and
     unanchored. **An invalid pattern fails the whole pass**: every rule
     in the pass becomes "?", naming the rule with the bad pattern.
3. **Predicates:**
   - `isValidEmail`: lowercase, then regex;
   - `isNumber` / `isNotNumber`;
   - `isEmpty` / `isNotEmpty`: null, a blank string, `[]` or `{}`.
4. **Paths:** dotted, and a numeric segment needs an array.
5. **Sources:**

   | Source | How the Agent reads it |
   |---|---|
   | `page.*` | The top frame |
   | `window` | MAIN world, properties only (D-WIN), then `String()` |
   | `localStorage` / `sessionStorage` | MAIN world. Missing is `null` |
   | `cookie` | `document.cookie`, first `key=` match, then `decodeURIComponent`. Missing is `undefined` |
   | `dateTime` | Local clock and timezone; keys as in `resolver.ts:91-127` |
   | `os`, `browser`, `device`, `country` | D-UA |
   | `augmentation` | MAIN-world `window.aptyAugmentation`, while the player runs. Otherwise "?" |
   | `element.<id>.(exists\|visible\|text)` | Via the existing element probe (`apty/element-probe.ts`). The row is ✓/✗ only when the selector is CSS, XPath or picker **and** has one unambiguous match. Otherwise "?" with the reason |
   | `customScript` | "?" (O-4) |
   | `userActivity.toolProgress.{WORKFLOW\|CHECKLIST}.<id>` | `users/{userId}.json` (WP6 intake); completed wins |
   | `userActivity.lastActivityTime` | "?", because it is kept in the Client's storage |
   | `screen`, `attribute` | Always undefined on the web |

6. **Segment active** = `segment.isActive && result[segment.ruleId] === true`.
   An item's segments are every `segment.json` row that lists its
   `sourceId`, **including inactive ones**. Items with no segments pass;
   otherwise any one active segment is enough (OR).
7. **The reader requests only the keys the rules reference.** It caps
   each value at 2 KB. Values pass through redaction before any of them
   reach a model. Rows show the value **masked by the current redaction
   mode**.

**Do (4.x segments):**

- Evaluate `conditions[][]`: OR over groups, AND within a group.
- Build the metadata the player builds, as far as the page allows:
  - `platform_*`: `navigator`, the timezone (normalise `Asia/Calcutta`
    and `Asia/Katmandu`), screen, userAgent;
  - `page_*`;
  - `application_storageData`: storage and window keys from conditions
    of category `LOCAL_STORAGE`, `SESSION_STORAGE` or `WINDOW_VARIABLE`;
  - `user_id` from `localStorage['apty-user-id']`.
- Keys under `application_customData` are "?" (O-4).
- **Keys are plain paths only.** A key containing `?(` or `(` is "?"
  ("the player runs this key as code").
- Relations: `equals`, `is_number` and `is_boolean` use exact joined
  strings; `contains`, `is_in_list` and `is_not_in_list` are lowercased;
  **an absent key is false for every relation**.
- No active segment means all items pass.

**Rows:**

- "✓ Segment "Sales team" active: `localStorage.role` = "sales"".
- "✗ Visibility rule "On a lead page" false: `page.path` "/accounts/7"
  does not contain "/leads"".
- "? Segment "VIP" not decided: its rule uses a custom script (not run)".

**Prove:**

- **Parity test table:** ≥ 60 `{definition, context, expected}` cases
  covering every operator, every predicate, a missing value for each
  negating operator, the date-first parse, an invalid regex, path
  arrays, and short-circuiting. Comment the Apty source line for each.
- 4.x relation tests, including absent keys.
- MAIN-world reader tests with a fake `window`.
- **E2E** `tooling/e2e/rule-eval.e2e.test.mjs`: a page sets
  `localStorage.role` and a window variable. A synthetic `rule.json` and
  `segment.json` decide one segment active and one inactive. The card
  shows ✓ and ✗ with the deciding values masked as the redaction mode
  requires.

**Done when:** segment and visibility-rule rows are decided for every
source the Agent can read, and say why for every source it can't.

### WP6: Symptom router and intake

**Change:**

- `packages/browser-runtime/src/apty/diagnosis/router.ts` (return
  `Route[]`, ranked, with symptom IDs) and `lookup.ts` (item resolution).
- New: `packages/agent-core/src/apty/coverage/symptoms.ts`, mapping each
  symptom to its check groups.
- New: `packages/browser-runtime/src/apty/case-run/intake.ts`.
- UI: `packages/ui` intake prompt card; i18n.

**Do:**

1. **Symptoms** (match on English words, including today's synonyms in
   `router.ts`):

   | ID | Symptom | Check groups |
   |---|---|---|
   | S-WIDGET | Widget not visible | Load, Widget |
   | S-LIST | Item missing from the widget list | Load, Widget, Item, Audience, Rules, List |
   | S-AUTO | Workflow does not start by itself | Load, Item, Audience, Rules, Auto-trigger, User history |
   | S-LAUNCH | Workflow does not open (widget, launcher, link, Ask Dapty, announcement) | Load, Item, Audience, Rules, Launch, Steps file |
   | S-STEP | Step stuck, broken, wrong element, ends early, wrong branch | Steps file, Step play, Element |
   | S-TOOLTIP | Tooltip not visible | Load, Item, Audience, Rules, Element (+ Schedule for 4.x) |
   | S-LAUNCHER | Launcher missing or click does nothing | Load, Item, Audience, Rules, Element, Launch target |
   | S-VALIDATION | Validation not firing or not disabling | Load, Item, Audience, Rules, Element, Validators |
   | S-ANNOUNCE | Announcement not showing, or shows again | Load, Item, Audience, Rules, Schedule and recurrence, User history |
   | S-CHECKLIST | Checklist missing or items not ticked | Load, Item, Checklist items, User history |
   | S-KC | Knowledge content missing or not opening | Load, Item, Audience, Rules, List |
   | S-LOCALE | Wrong language or missing text | Load, Locale, Item texts |
   | S-ONBOARD | Onboarding task missing (4.x) | Load, Onboarding |
   | S-DAPTY | Ask Dapty problems | The existing Ask Dapty pack, plus Item and Launch for the suggested item |
   | S-LOGS | Errors and logs | The existing logs pack; the Client logs row says "not available" when the Client is not used |
   | S-PAGE | Page readiness | The existing DOM Health pack |

   An ambiguous message runs the union of the plausible symptoms' groups.
2. **A bare how-to makes no content-file requests.**
   - **Bare how-to:** `isBareHowTo` in
     `packages/browser-runtime/src/kb/kb-intent.ts:62-74`. The message
     starts with "how do I", "how to", "can I", "where is the setting for"
     and similar, and `hasSymptomWord` (`:54-60`) finds no symptom word.
   - **Its route:** context resolution only. It reads the version from the
     page config or the SE's words, with no content request. Then it goes
     to Ask Dapty, using that version's KB application, or the common
     tenant-wide documents when the version is unknown. Its reply is the
     answer, shown as guidance.
   - **No cards:** KB cards answer symptoms, not how-tos (owner decision
     D-KB1).
   - **Ask AI anyway** is offered only if Ask Dapty gives up, errors or
     isn't configured.
   - **A "Run checks" button** on the answer (reuse `runCheck`,
     `apty/diagnosis/responder.ts:688-698`) lets the SE start the symptom
     checks if there is in fact a problem.
   - **Symptom wording wins:** a how-to that contains a symptom word ("how
     do I fix the tooltip that doesn't show") runs the checks.
   - **Prove it:** a router test that a bare how-to yields no check route.
     An E2E test where the fake content host receives **zero** requests for
     a bare how-to, and the fake ai-service receives exactly one.
3. **Item resolution** uses the existing `lookup.ts`: exact name first,
   then the sourceId or id, then part of the name. Several matches give
   **one** question listing the candidates' names and environments.
4. **Ask-first mode (D-ASKFIRST).** A setting, off by default, and
   lockable by policy. When it is on, the intake card always shows the IDs
   that will be used, including those read from the page, and **no
   content request is made until the SE presses Run checks**. Prove it
   with an E2E test: with the mode on, the fake content host receives
   zero requests until the click.
5. **Intake: ask only what is missing, once, in one card.**
   - IDs come from the message. Detect a UUID (5.x) and a 4.x key or
     numbers, e.g. "tenant 0f…, env 0e…".
   - The page comes from the bound tab. When the symptom needs it and
     the tab is elsewhere, say "Open the page where it fails".
   - The user ID is needed only when a user-dependent group runs and
     `userIdentificationConfig` (5.x) or `userIdentification` (4.x) gives
     no value on the page. Then ask (O-5), with the copy step text:
     "Open chrome://extensions, then the Apty Client's service worker,
     then run `chrome.storage.local.get()` and copy the
     `apty_player_local_storage_user_id` value". Verify the key and scope
     in `apty-dap: apps/player/src/main-content-script/storage/local-storage.service.ts:84-112`
     before writing this text.
   - The version is asked only if neither the probe nor the ID shape
     settles it.
   - IDs the SE gives are pinned with `pinContext`. A pinned context whose
     tenant differs from the page's tenant shows a confirm step: "Use
     tenant … instead of this page's tenant?"
6. **UI: the intake card.** It shows the fields with values filled in
   from the page, marked "from page". Each field is editable. One button:
   **Run checks**. Validation messages are specific, e.g. "An application
   ID is a UUID in 5.x".

**Prove:**

- Router unit tests: each symptom from three phrasings; mixed phrasings.
- Intake unit tests: each missing-field branch, and the tenant-mismatch
  confirm.
- An intake card component test, plus axe.

**Done when:** a message with no IDs on a page with Apty runs with no
questions, and every question the Agent asks is needed by a group that
runs.

### WP7: Live checklist (progress events)

**Change:**

- `packages/agent-core/src/types.ts`: `LocalAnswer.progress?: AsyncIterable<unknown>`
  and AgentEvent `{ type: "tool_call_progress"; toolName: string; progress: unknown }`.
- `packages/agent-core/src/agent/apty-agent.ts`: `runLocalAnswer` yields
  each progress item between start and complete, and emits the hook
  events.
- `packages/ui` chat adapter, and the tool-display slot for progress.
- New: `packages/agent-core/src/case-run/rows.ts` (the `ChecklistRow`
  type).
- `apps/browser-extension/src/components/investigation/check-result-card.tsx`:
  render streamed rows with the existing `GateRow`.

**Do:**

1. **The row model:**

   ```
   {id, group, label, status: pass|fail|unknown|info, source: page|agent|client|capture|dapty|cards|not-checked,
    evidence?: string[], ruleId?, cardPageId?, reason?, version}
   ```

   Rows are ordered by group: Context, Load, Knowledge (Ask Dapty and
   cards), Item, Audience, Rules, Element, User history, Not checked. They
   are de-duplicated by `id`. A later status for the same `id` replaces
   the earlier one.
2. **Accessibility.** The list is `role="list"`, and the summary is an
   `aria-live="polite"` region: "4 of 9 checks done, 1 issue". Do not
   announce each row. No animation under `prefers-reduced-motion`.
3. **Transcript.** The case recorder and the transcript keep **only** the
   final result. Rows reach the model only as the final result's
   gates.
4. **Timing budgets** (asserted in E2E with generous margins):
   - the first row appears ≤ 1.5 s after send on a fixture host;
   - all file rows are done ≤ 4 s;
   - the result appears ≤ 6 s, not counting Ask Dapty, which streams
     separately.

**Prove:**

- Agent-core tests: progress items are yielded in order, between start
  and complete, and nothing else changes when `progress` is absent.
- UI tests: rows render and replace, and the summary is announced.
- **E2E:** rows appear before the result card, checked by timestamps of
  DOM mutations.

### WP8: New 5.x check groups

**Change:**

- New pack files under `packages/browser-runtime/src/apty/diagnosis/`:
  `load-5x.ts`, `autotrigger-5x.ts`, `launch-5x.ts`, `steps-5x.ts`,
  `tooltip-5x.ts`, `launcher-5x.ts`, `validation-5x.ts`,
  `announcement-5x.ts`, `checklist-5x.ts`, `locale-5x.ts`, `list-5x.ts`.
- Extend `content-not-visible.ts` and `element-not-found.ts`.
- `types.ts` gets new `RuleId`, `GateId` and `GateReason` values.
- `check-cards.ts` (card links where a KB card exists).
- i18n en and zh.

Each new rule cites its apty-dap line and records `verifiedOn`.

**Rule IDs:**

| Prefix | Group |
|---|---|
| `LD5` | load |
| `AT5` | auto-trigger |
| `LC5` | launch |
| `ST5` | steps |
| `TP5` | tooltip |
| `LN5` | launcher |
| `VD5` | validation |
| `AN5` | announcement |
| `CK5` | checklist |
| `LO5` | locale |
| `LI5` | list |
| `SCH-*` | schema drops (WP4) |
| `RE5` | rule evaluation (WP5) |

Keep the existing CNV, WNV, SEL, DOM, LOG and DAP rules. Paths below are
relative to `apty-dap/packages/apps/player/src/main-content-script/` unless
they start with `libs/`.

**Load** (each one a cause):

- No app or env matches. `app-urls.json` is parsed whole: one invalid row
  turns it into `[]`. Name the row (W5-03, W5-04; `cdn/cdn.service.ts:122-143`,
  `libs/shared/cdn-api/src/cdn-reader-api.ts:99-108`).
- `app-data.json` is missing or invalid: "No application found"
  (W5-05; `cdn.service.ts:181-185`).
- `defaultThemeId` is not in `themes/default-themes.json` ∪ `theme.json`,
  so the player fails to start (G5-06; `libs/client/tool-items-schema/src/mappers/theme.mapper.ts:27-31`).
- No `enabled` locale, or a missing `locales/{code}.json`, so the player
  fails to start (W5-07; `cdn.service.ts:208-226,577-599`;
  `locale/locale.service.ts:30-54`).
- Injected mode: the storage iframe did not load within 15 s
  (W5-02; `index-injected.tsx:51-54`). Check whether
  `iframeLocalStorageURL` loads.
- `restrictionPatterns`: any regex matching the URL hides everything,
  including auto-trigger (W5-11; `widget/widget-restriction.service.ts:10-67`).
  This exists today; verify it against these lines.

**Widget:** WP1. Plus feature tabs: `features.aiAssistant` and
`reminders`, and self-hosted turns AI off (G5-11; `widget/WidgetTabBar.tsx:44,60`;
`cdn.service.ts:194-206`).

**Item / List:**

- `hideFromWidget` hides from the list only (W5-19; `cdn.service.ts:418`).
- Knowledge content `hideFromWidget` **defaults to true** when absent
  (K5-01; `libs/shared/contracts/src/dap/knowledge-content/knowledge-content.schema.ts:52`).
- Name resolution: the current locale, else `en`; blank counts as missing.
  `enableSuccess` and `enableFeedback` need their messages
  (W5-16…18; `libs/client/tool-items-schema/src/mappers/workflow.mapper.ts:29-40`;
  `libs/shared/core/src/utilities/locale-fallback.ts:15-31`).
- Labels and most-used group workflows only; search does not match tags;
  `process-group.json` is unused (info rows; K5-07…11;
  `libs/client/tool-items-schema/src/mappers/widget.mapper.ts:12-96`;
  `search-filter.controller.ts:8-81`).
- Completed workflows stay listed (info).

**Auto-trigger (S-AUTO):**

- `stepsAutoTrigger[]` must exist. When the workflow-level `autoTrigger*`
  fields are set, say "these fields are not used by the 5.x player"
  (W5-26 ✔).
- The attached rule must be true. Evaluate it with WP5; at page load a
  rule already true counts as a rise. `EVERY_TIME` needs false → true
  (W5-27, W5-28; `tool-items/workflow/workflow-autotrigger.service.ts:47-78`).
- Frequency (W5-29 ✔; `workflow-autotrigger.service.ts:100-125`) uses
  `users/{uid}.json` `toolsCompletionProgress.autoTriggerData.flows[workflowId][stepId]`:
  - no record: eligible;
  - `ONCE` or null: **never again**. The cause reads "already triggered on
    <date>, frequency ONCE";
  - `ONCE_A_DAY`, `ONCE_A_WEEK`, `ONCE_A_MONTH`: one day, week or month
    since the record, using the date-diff semantics in
    `libs/shared/core/src/utilities/date-diff-counter.ts:5-24`; read them
    and mirror them;
  - an unknown frequency reads as `ONCE` (`libs/shared/core/src/types/rules.ts:22`).
- Restriction blocks it; display mode does **not** (W5-30;
  `workflow-autotrigger.service.ts:175-177`).
- An active dialog blocks it: a stored run, even paused; knowledge
  content; an announcement; checklist success. The row is "?" with "close
  any open Apty dialog or running workflow and reload"
  (W5-31; `tool-items/active-dialog.service.ts:23-29`).
- `autoTriggerData` is written on activation (info; W5-33).

**Launch (S-LAUNCH):**

- **Widget click:** not re-gated, and cancels a current run (W5-34;
  `widget/content/help/use-help-list.controller.ts:36-59`).
- **Launcher:** the target must be a workflow in the tool list. The
  launcher must itself be visible, and it is not rendered when display is
  off or restricted (W5-35; `cdn.service.ts:524-560`;
  `libs/client/tool-items-content-script/src/main/ContentScriptRoot.tsx:19-30`).
- **The gate for launcher, Ask Dapty, announcement, auto-trigger and step
  call-to-action:** the workflow exists and passes segments and the
  visibility rule (W5-36; `cdn.service.ts:444-450`).
- **Permalink:** `aptyref=WF:<sourceId>[:<stepSourceId>]`, read once and
  removed from the URL, **not gated**. Autopilot needs `autopilot=true`
  and `enableAutoPilot` (W5-38; `permalink/permalink.service.ts:29-126`).
  When the SE pastes a link, parse it and check the IDs.
- **Start step:** the requested step, else the **last** attached step
  with `enableEntryPoint` whose `entryPointRuleId` is true (via WP5), else
  `order===1`, else a silent failure (W5-40; `libs/client/workflow-engine/src/run/workflow-step.service.ts:129-143`).
- **The steps file is parsed whole:** one invalid step means nothing
  launches (W5-41; WP4).

**Steps (S-STEP):**

- **Next step is exactly `order + 1`. A gap ends the run early as done**
  (W5-50 ✔; `workflow-step.service.ts:150-153`). Name the gap: "steps go
  1, 2, 4, so the run ends after step 2".
- **Element:**
  - CSS, jQuery or picker, with the `screenTokenFunction` gate, shadow
    roots, and a rendered match preferred;
  - **container score ≥ 0.75**;
  - XPath and custom script are also supported;
  - shadow fallback and dynamic search are off.

  Extend the element probe with the screen token and the container score,
  or mark them "?" with the reason (W5-43; `libs/client/tool-items-content-script/src/common/element-identification/element-identification.service.ts:42-134`;
  `libs/client/element-identification/src/scope.ts:137-141`;
  `libs/client/tool-items-schema/src/mappers/application.mapper.ts:26-51`).
- **Frames:** `iframePath` levels match ready, rendered iframes
  (W5-44; `libs/client/utilities/src/dom/filter-iframe-tool-items.ts:35-102`).
- **Timing:**
  - one attempt, then retries at 1 s for `optionalTimeOut`, else 5 s;
  - an optional step is skipped; otherwise "Step broken", which recovers
    when the element appears (W5-45, W5-46; `libs/client/tool-items-content-script/src/main/messaging/ipc.service.ts:330-365`).
- **Advance:** `advanceOn[]`. Click listens to
  `config.widgetConfig.workflow.workflowAdvanceOnClickEventType` (default
  `mousedown`). An unknown value reads as Next (W5-49;
  `libs/client/tool-items-content-script/src/common/tool-items/flows/use-flow-step-advance-on.controller.ts:20-94`).
- **Split:** the rule is tried 5 times, 1 s apart; then end, jump, or
  start another workflow (W5-51; `workflow-step.service.ts:88-127`).
- **Balloon visibility:** needs visibility unless `showWhenOutsideViewPort`
  is set (W5-48).
- **Resume after navigation:** the same app and env must resolve, and the
  workflow must still be published (W5-53).
- **Step UI hidden:** when display is off or restricted, an auto-triggered
  or linked run is invisible (W5-56).

**Tooltip:**

- **One blank `contentHTML` row drops the tooltip in every language**
  (T5-01 ✔, WP4).
- The resolved content must be non-empty (T5-02).
- Element, frame depth, visibility (6 of 9 hit points plus viewport), and
  ICON versus FLOATING trigger (T5-04…07;
  `libs/client/utilities/src/dom/element-visibility.service.ts:9-90`).

**Launcher:**

- The target exists and is visible: a workflow with name, success and
  feedback texts; a knowledge-content item; a popup in `popup.json`;
  custom script always passes (L5-02; `cdn.service.ts:524-561`).
- A BUTTON needs `buttonLabel` (L5-03; `libs/client/tool-items-schema/src/mappers/launcher.mapper.ts:107-117`).
- The click re-resolves the target (L5-06).

**Validation:**

- Validators (required, length, regex and custom) each run only when
  enabled.
- A disable group is blocked while **any** validation on it is invalid,
  **including an empty field at mount**
  (V5-04…08; `libs/client/tool-items-schema/src/mappers/validation.mapper.ts:49-112`;
  `tool-items/validation/validation.service.ts:40-93`).

**Announcement:**

- A locale row or a popup is required (A5-02).
- "Later": host `sessionStorage['apty_player_session_storage_later_announcements']`
  (A5-04; `visibility-rules/later-rule.service.ts:15-22`).
- NONE/ONCE: an accepted completion in the user file hides it forever.
  **`scheduleRange` is not enforced**, so say so when the SE expects dates
  to matter (A5-05; `libs/client/tool-items-schema/src/mappers/announcement.mapper.ts:75-167`;
  `visibility-rules/recurrence-rule.service.ts:259-264`).
- REPEAT recurrence arithmetic, with **no end date and no start guard**,
  in browser-local time (A5-06; `recurrence-rule.service.ts:35-252`).
- **Only one shows:** the first by `order`, then name; blocked while a
  dialog is active (A5-07; `cdn.service.ts:693-714`).
- Permalink `AN:` bypasses everything (A5-08).

**Checklist:**

- Items need a visible, locale-valid target.
- **0 items means the checklist is dropped.**
- An item is ticked iff its id is in `toolsCompletionProgress.flows[]` or
  `customContents[]` (C5-02, C5-03, C5-05; `libs/client/tool-items-schema/src/mappers/checklist.mapper.ts:261-298`).

**Knowledge content permalink:** `KC:` appears never to match, because of
a `KC-` prefix comparison (K5-05; `cdn.service.ts:888-894`). Report it
only as "candidate", with the citation.

**Locale (S-LOCALE):**

- The order: stored (Client storage, "?"), then `isDefault`, then the
  `<html lang>` prefix, then the first enabled locale.
- Per-field fallback to `en` (G5-12, G5-14).

**User history:**

- The user file is parsed whole; a schema failure means empty preferences,
  so completions are forgotten (G5-22; `widget/content/user-preference/user-preference.service.ts:62-75`).
- Feedback is recorded on submit only (W5-59).

**Prove:**

- Per rule: one synthetic fixture where the rule fires and one where it
  does not.
- Per group: an evidence and fix copy test (en and zh keys present).
- A coverage-manifest entry per rule.

### WP9: New 4.x check groups

**Change:** new packs `load-4x.ts`, `flow-4x.ts` (list, auto-trigger,
launch, steps), `tooltip-4x.ts`, `launcher-4x.ts`, `validation-4x.ts`,
`announcement-4x.ts`, `onboarding-4x.ts`, `kc-4x.ts` and `frames-4x.ts`.
Extend `content-not-visible-4x.ts` and `widget-not-visible-4x.ts`, plus
i18n.

**Rule IDs:** `LD4`, `FL4`, `AT4`, `TP4`, `LN4`, `VD4`, `AN4`, `ON4`,
`KC4`, `FR4`. Keep W4X and C4X.

Paths below are relative to `apty-assist/player3.0/src/`.

**Load / Widget:**

- OneX mode (chrome.storage `IS_APTY_ONE_X`): no widget. "?" (P4-02;
  `main.bootstrap.ts:432-447`).
- Self-hosted test extension: the player aborts. "?" (P4-04;
  `main.bootstrap.ts:125-128`).
- Env keys sort as strings (P4-06): report it when the order changes which
  env matches.
- If `feature-flag.json` fails, the defaults apply: all off except
  `widgetSessionTracker` and `customTabOrder` (P4-10;
  `main.bootstrap.ts:75-86,365-376`).
- SSO: the `widgetSSO` flag plus `tenant-config.json`
  `widgetSSOConfig.enabled` need a token; SSO failure means no player
  (P4-11; `main.bootstrap.ts:186-197`; `shared/helpers/sso.helpers.ts:108-150`).
- An empty `app-data.json` means a silent no-player. This exists today as
  W4X-06; re-verify it at `main.bootstrap.ts:247-249,323`.
- A **missing `baseTag` element means no widget** (P4-13; `index.tsx:186-191`).
- `restrictURLs` (raw RegExp) hides the widget **and the flow balloons**
  (P4-14; `index.tsx:143-165,319-337`).
- **A segment-hidden widget also stops `DOMChanged`**, so frames, steps,
  rules and the user ID stall. Report this as "candidate (inferred)"
  (P4-16; `components/app/app.effects.ts:64-73`).
- `hideAptyWidgetWhenNoContent` (P4-17; `banner.component.tsx:140-229`).
- The iframe ignore list (P4-18; `shared/helpers/injected.helpers.ts:66-258`).
- `publishingSystem` off means **no flows in the widget list**
  (G4-01, F4-07; `components/player-ui/body/content/tool-list/tool-list.selectors.ts:50-60`).

**Flows (list):**

- Present in `flow.json` (F4-01).
- Segment `flows[]`, decided by WP5; no active segment means all (F4-02).
- `name[locale]` exists (F4-03).
- Schedule: `scheduleEnabled`, `fromDate`, `toDate`, `timeZone`; missing
  dates default to now ±2 days (F4-04; `shared/helpers/announcement.helpers.ts:59-92`).
- `hideInWidget` (F4-05).
- `attachedRule.visibilityResult` is fail-open. The row is "?" until O-3,
  and shows the rule's inputs (F4-06; `components/app/rule-engine/rule-engine.helpers.ts:388-411`).
- Tags remove a flow from the flat list (F4-08; `group-content.selector.ts:9-24`).

**Auto-trigger (S-AUTO):**

- `stepsAttachedRules[]` with an `AutoTrigger` action. Only the **first**
  eligible flow fires, with no segment or hide check (F4-20;
  `components/app/rule-engine/rule-engine.effects.ts:259-284`).
- **Frequency** (F4-21 ✔; `rule-engine.effects.ts:298`):
  `differenceInDays(last, now) >= 1` is never true, so **daily, weekly and
  monthly fire once per user and never again**. The cause reads "already
  triggered on <date>; in 4.x this flow will not auto-start again for this
  user".
  - It needs a non-default user ID (F4-63;
    `components/app/user-identification/user-identification.effects.ts:70-163,412-436`).
  - The data lives in the user file at
    `toolsCompletionProgress.autoTriggerData.flows[flowId][stepId]`.
- `delay`, and no flow in progress, are "?" (F4-22).

**Launch:**

- The flow exists with `name[locale]`, else the flow-error modal. An empty
  `flow-{id}.json` cancels silently (F4-23; `flows.effects.ts:561-617`).
- An announcement call-to-action needs the name and an active segment
  (F4-26).
- **Permalink:** `aptyref=WF-<shortid>[-<step>]` must pass
  `shortid.isValid`, is matched on `externalUniqueId`, and needs an active
  segment. **An unknown flow fails silently** (F4-27;
  `components/tools-ui/permalinks/permalinks.effects.ts:41-76`; `flows.effects.ts:678-712`).

**Steps:**

- First step: the last milestone whose `formId` is an active frame, else
  step 0 (F4-29).
- Frame, through `frames[]` or `iFramePath` (F4-30).
- Element by type: 3 CSS and 4 XPath are decided on the page; 1 element
  selection and 5 jQuery are "?" until O-3; 2 custom script is "?" (O-4)
  (F4-31; `shared/helpers/element-identification.helpers.ts:78-172`).
- Present means visible plus 6 of 9 hit points (F4-32).
- Step `condition` (`ELEMENT_EXISTS`, `QUERY_MATCHES`, `NOT`): an optional
  step is skipped, a required step is hidden (F4-34; `services/play-flow.service.ts:342-406`).
- Optional timeout. Otherwise `customConfig.workflowWaitTime` (default
  15 s) leads to the "WorkFlow Error" modal (F4-37, F4-38).
- A language change aborts the run (F4-41).
- `contentExpiryTime` defaults to 30 min (F4-46).
- `uriHashes` is unused (info).

**Tooltip:**

- **Scheduled with an empty `timeZone` means hidden** (T4-01 ✔;
  `shared/helpers/announcement.helpers.ts:29-31`).
- The `formId` frame must be active (R4, "?" until O-3 for element
  selection).
- `checkState` must be Present.
- The rule is fail-open.
- The tooltip id must be in the active segments' `tooltips[]`
  (T4-02…05 ✔; `components/tools-ui/tooltips/tooltips.selectors.ts:20-42`).
- `hoverMessage` uses the locale key, else key 1, else an **empty
  balloon** (T4-06; `shared/helpers/publishing.helpers.ts:64-73`).

**Launcher:**

- The target exists: a flow with a locale name, a template, or knowledge
  content.
- **`checkLocaleId` has no fallback**: a string `hoverMessage` without
  `localeId` fails.
- Segments need the launcher **and** its flow or knowledge-content item.
- `showButton`.

(L4-01…07; `components/tools-ui/launchers/launchers.selectors.ts:36-74`;
`publishing.helpers.ts:75-85`.)

**Validation:**

- Schedule, where the timezone defaults to Local.
- Frame.
- The input must be Present.
- Rule.
- Segments.
- The indicator appears after interaction.

(V4-01…07; `components/tools-ui/validations/validations.selectors.ts:20-65`.)

**Announcement** (A4-01…16; `components/tools-ui/announcements/announcements.effects.ts:116-559`;
`shared/helpers/recurring-announcement.helpers.ts:33-178`):

- A permalink bypasses everything.
- The user's progress must be loaded first.
- `scheduleConfig` recurrence. **An invalid schedule removes the
  announcement until reload.**
- Accepted, CTA and `isAlert`.
- Goals.
- Session dismissal (`apty-user-session-data.announcements`).
- Rule.
- Frame.
- Segments, plus `ignoreSegmentationCheck`.
- **All `conditions` must hold** ("?" until O-3).
- Busy gate.
- Smart-canvas template.
- `properties[locale] || [1]`, otherwise a **crash**.

**Onboarding:**

- Items must exist.
- `name[locale]`.
- Each item's flow or knowledge-content target must be published, in
  segment, in schedule, and named in the locale.
- The task's **own** `segments[]` field is used.

(O4-01…04; `components/player-ui/body/content/onboarding/onboarding.selector.ts:29-100`.)

**Knowledge content:**

- Schedule.
- Segments.
- `locales[locale]`.
- Hide and tags.
- Content aggregation needs its flag.
- Flows in the list need `ruleVisible`, which is computed only with
  publishing on.

(K4-01…07.)

**Frames:**

- `form.json` types 1 to 5.
- A frame is active only if every entry is Present or NotVisible.
- An unknown type, or an empty `formIdentification`, is never active.

(R4-01, R4-02; `components/tools-ui/frames/frames.reducer.ts:31-45`;
`shared/helpers/element-helpers.ts:31-34`.)

**Locale:**

1. stored;
2. `playerDefaultLocaleId`;
3. Workday, `<html lang>` or browser (code, alias or prefix);
4. `default`;
5. first.

(G4-04; `components/app/locales/locales.effects.ts:97-148`.)

**Prove:** as WP8, with fixtures under `fixtures/content-4x` (extend
them).

### WP10: The case run (parallel groups, one result, Re-check)

**Change:**

- New: `packages/browser-runtime/src/apty/case-run/{orchestrator,aggregate-io}.ts`
  and `packages/agent-core/src/case-run/{types,aggregate}.ts`.
- `apps/browser-extension/src/hooks/browser-agent-config.ts`: register the
  case-run responder ahead of the diagnosis responder, keeping lookups and
  file fetches.
- UI: the result card.

**Do:**

1. The order of work:
   1. Context (WP2, WP6).
   2. Start Ask Dapty (WP11) and every check group the symptom needs, with
      `Promise.allSettled`.
   3. All groups share **one** `apty-files` and replay per case, so each
      file is fetched once.
      - **Each check group exports the files it reads**
        (`files(version, symptom)`).
      - The orchestrator fetches the **union** of those lists and nothing
        else. That is what the §3.2 request-count assertions check
        against.
      - Fetch `content-config.json` first, then the rest.
   4. Run at most 6 requests at a time.
   5. Rows stream (WP7).
2. **Aggregate:**
   - collect the causes from every group;
   - de-duplicate by `ruleId` and subject;
   - order by gate: load, widget, item, audience, rules, launch and steps,
     element, user history;
   - status `issues`, `candidates`, `clear` or `no_data`.
3. **The result card:**
   - **header:**
     - `issues`: "Issues found, please fix all of these";
     - `clear`: "No issue found in Apty's data";
     - `no_data`: "Could not read Apty's data", with the reason;
     - `candidates`: "Possible causes to check";
   - each issue shows what is wrong, the evidence (file, field, element
     or value), the fix, the source, the KB card link, and the rule tag;
   - then the "Not checked" list;
   - then the guidance panel (Ask Dapty or the card as written);
   - buttons: **Re-check**, **Copy for support**, and **Ask AI anyway**
     when allowed.
4. **Re-check** re-runs with `fresh: true`: conditional requests (built),
   the page re-probed and rules re-evaluated. Ask Dapty is asked again only
   if the question changed. Show "Changed since last check" on rows whose
   status changed.
5. **Copy for support:** the existing `VerdictFooter` copy plus the case
   bundle (`SupportBundleButton`). Include rule IDs, statuses and
   citations. **Exclude** URLs, page values and IDs per the redaction mode
   (follow `dapty-evidence.ts` bundle rules).
6. **Failure handling:**
   - a group that throws becomes an "?" row ("this check could not run:
     <reason>") and never fails the case;
   - offline: "You're offline: the Agent couldn't reach Apty's content
     host", with Re-check;
   - the conversation closing aborts every request.

**Prove:**

- Orchestrator unit tests with fake groups: parallelism, one fetch per
  file, aggregation order, a thrown group, abort.
- **E2E:** one test per symptom family (S-LIST, S-AUTO, S-LAUNCH, S-STEP,
  S-TOOLTIP, S-WIDGET) on 5.x fixtures with no Client: rows, causes and
  fixes as expected, and Re-check after changing a fixture file.

### WP11: Ask Dapty client and the cards gate

**Change:**

- `packages/agent-core/src/config/org-policy.ts` and its test:
  `askDapty: {aiBackendURL (https or loopback), kbTenantId (uuid), kbApplicationIds: {"4.x"?: uuid, "5.x"?: uuid}, envId, applicationType}`.
- `managed-schema.json`.
- New: `packages/agent-core/src/ask-dapty/{types,classify}.ts` and
  `packages/browser-runtime/src/apty/ask-dapty/{client,rows}.ts`.
- Options: a read-only status ("Ask Dapty: KB tenant set · not set").
- UI: the guidance panel.

**Read:**

- `apty-dap: apps/ai-service/src/api/ai-chat-widget/ai-chat-widget.controller.ts:13,49-105`
- `ai-chat-widget.service.ts:23-24,89,94-112,140-189`
- `libs/shared/contracts/src/ai/ai-chat-widget/ai-chat-widget.schema.ts:20-45`
- `ai-chat-widget.contract.ts:97-107` (the one-shot route checks UUIDs)
- `apps/player/src/common/widget-chat-stream.ts:18-31,152-154` (how the
  player reads the stream)
- `api-client/widget-chat-api-client.service.ts:55-88` (the one-shot
  fallback)
- `apps/ai-service/src/vector-store/vector-store.service.ts:175-185`

**Do:**

1. **Request:**
   - `POST {aiBackendURL}/ai-service/api/v1/ai/{kbTenantId}/widget/chat/stream?applicationId={kbApplicationIds[version]}`;
   - body `{message: redacted question, context: [], envId, applicationType}`,
     with **no** `userId` and **no** `chatId`;
   - `credentials: "omit"`.
   - If the stream does not open within 5 s, or answers 4xx before SSE
     headers, use the one-shot route once.
   - Abort with no event after 20 s.
   - **D-DAPTY-WHEN.** The setting `askDaptyWhen: "parallel" | "nothing-found"`
     defaults to `"parallel"` and can be locked by policy. With
     `"nothing-found"`, the case run starts Ask Dapty only after the
     checks finish with status `clear` or `no_data`.
2. **Parse** `data:` frames. `done.reply` is authoritative. Keep the names
   of `tool_start` events.
3. **Classify** (pure):

   | Class | When |
   |---|---|
   | `gave_up` | The reply equals the give-up text, or after normalising (trim, case, punctuation) is within 0.9 similarity of it with no suggestions |
   | `error` | The error reply, an `error` event, a timeout, a 4xx/5xx, or no `done` |
   | `kb_answer` | A `knowledge_retrieve` tool round was seen, and the reply has `[n]` markers or no URL outside the KB tenant's documents |
   | `web_or_unknown` | Anything else |

4. **Rows:**
   - "Ask Dapty asked: answered from the KB";
   - "gave up";
   - "may include web results";
   - "error: <reason>";
   - "not set up (no KB tenant)".
5. **The cards** (`kbAnswer` / `localKbMatches` in
   `packages/browser-runtime/src/kb/kb-matches.ts:178`) run only for
   `gave_up`, `web_or_unknown` and `error`. The card is shown as written
   (the existing `kb-matches-card.tsx`).
6. **Guidance panel:** "Ask Dapty guidance · KB", or "· may include web
   results". It is **never** in the issues list. The text passes output
   privacy.
7. **Privacy:**
   - the call is made only when `askDapty` is set;
   - the question goes through `kbEgressAllowed` and redaction at the
     case's redaction level;
   - document the call in `PRIVACY.md` and the store data disclosures
     (`docs/store/`).

**Prove:**

- Classifier unit tests: the exact text, near-misses, the error reply,
  URLs, `[n]` markers.
- Client tests with a fake SSE: frames split across chunks, the error
  event, a timeout, the one-shot fallback.
- **E2E** `tooling/e2e/ask-dapty.e2e.test.mjs` with a fake ai-service:
  - a KB answer shows guidance and no cards;
  - a give-up shows the card;
  - an error leaves the checks unaffected;
  - every request body has no `userId` or `chatId`, and the question is
    masked;
  - no call is made without `askDapty`.

### WP12: Ask AI anyway (Model A, then Model B, with a quality check)

**Change:**

- `packages/agent-core/src/config/org-policy.ts`:
  `modelA: {provider: "openai"|"azure", host?, model = "gpt-6-luna", token}`.
  Parse it like `preset`, and add it to `managed-schema.json`.
- New: `packages/agent-core/src/answer/{chain,quality,claims}.ts`. Move the
  pure parts of `packages/ui/src/lib/kb-grounding.ts`
  (`ungroundedPhrases`, `ungroundedLocations`) here and re-export them
  for the UI.
- New: `packages/browser-runtime/src/answer/runner.ts`.
- `apps/browser-extension/src/components/investigation/kb-unknown-setting.tsx`:
  generalise "Ask AI anyway".
- `packages/browser-runtime/src/apty/diagnosis/responder.ts:686-689`: a
  `not_covered` question no longer goes to the model automatically when a
  case ran.
- UI: the AI answer card and the "Not enough evidence" card.

**Do:**

1. **When to offer it:** the result is `clear` or `no_data`, AND Ask Dapty
   is `gave_up`, `error` or not set up, AND no card covers the question.
   It is the only question put to the SE.
2. **The chain:**
   - Slot A is used if `modelA` is set and allowed by `destinationAllowed`
     (`packages/agent-core/src/config/destination.ts:59-72`).
   - Slot B is the Agent's configured Anthropic model.
   - The existing same-provider retries run inside each slot (429, 5xx and
     timeout; `apty-agent.ts:57,74-127`).
   - Move to the next slot on: a 400 or 404 naming the model, 401, 403,
     retries exhausted, a timeout, or a failed quality check.
     `FallbackReason` is `no_key`, `model_unavailable`, `auth`,
     `rate_limited`, `server`, `timeout` or `quality_failed`.
3. **What the model gets:**
   - the question;
   - every checklist row (status, source and evidence, masked);
   - the causes;
   - Ask Dapty's text, marked as guidance;
   - the cards, only if `kbToModel` is `approved`;
   - read-only tools: `fetch_apty_file`, `list_apty_files`,
     `resolve_apty_context`, `run_diagnosis`, `search_kb` and the element
     tools;
   - the instruction: every Apty claim cites `kb://<card>#L<n>`,
     `check://<ruleId>` or `code://<repo>:<path>:<line>`.

   Keep the request within the tool-route budgets
   (`packages/browser-runtime/src/tools/tool-relevance.ts`,
   `TOOL_ROUTE_BUDGETS`) and `tooling/e2e/request-budgets.json`. Raise a
   budget only with the reason in the commit.
4. **The quality check** (pure, no model):
   1. split the answer into claims: sentences naming an Apty setting,
      file, field, item, rule or menu;
   2. each claim needs a resolving citation: `kb://` returned this turn,
      `check://` present in this case, or `code://` in the allow-list
      shipped with the KB pack (add the list to the pack format, or ship
      it at `packages/agent-core/src/answer/code-allowlist.ts`);
   3. grounding: `ungroundedPhrases` / `ungroundedLocations`;
   4. no claim contradicts a decided row, matched on `GateResult`
      `id`, `status` and `params` (e.g. "is published" versus a failed
      `published` row);
   5. no claim is cited only from the other version's cards.

   It passes, or it fails with the unsupported claims listed.
5. **UI:**
   - **AI answer card:** labelled "AI answer · gpt-6-luna" or "AI answer ·
     Anthropic", with citations as links (the existing `kb://` rendering)
     and a "Why this answer" disclosure listing the checks used.
   - **"Not enough evidence" card:** the unsupported claims listed as
     "to check", the next check to run, and Copy for support.
   - **While running:** "Asking gpt-6-luna…", then, after a fallback,
     "Asking Anthropic…".

**Prove:**

- Chain unit tests for each `FallbackReason`.
- Quality-check tests: uncited claims, a contradiction, the wrong
  version, every claim passing.
- **E2E** with mock models (`startMockModel`; add an OpenAI-shape mock
  for A):
  - A passes;
  - A 401 falls to B, which passes;
  - A fails quality, B fails quality, giving "Not enough evidence";
  - no Ask AI button when an issue was found.

### WP13: Accuracy and measurement

**Change:**

- `packages/agent-core/src/case/case.ts`: `CaseFinding` gets
  `seMark?: "correct"|"wrong"`, and `pilotMeasures` adds precision per
  rule and resolution per symptom.
- New: `packages/agent-core/src/apty/coverage/registry.ts`, with each
  rule's status `active` or `candidate`.
- UI: the mark control on each issue.
- New: `tooling/scripts/smoke-real-tenant.mjs`.

**Do:**

1. **The mark control:** "Was this right? Yes · No", one tap, saved to the
   case record. The record keeps only rule IDs and marks; no page values.
2. **Demotion.** When a rule has ≥ 20 marks and precision below 99%, it
   is set to `candidate` in the registry, by an owner-run script that
   writes the registry from an exported pilot CSV.
   - A candidate rule's finding shows as "possible cause" and never in
     "Issues found".
3. **The smoke script.**
   - Inputs: a test tenant and content host, from arguments only, never
     committed.
   - It fetches `app-urls.json` and one environment file per version, and
     records **status and shape only** (keys and types, never values).
   - It confirms:
     - that no authentication is needed;
     - whether other `?timestamp=` values are accepted;
     - the 4.x `token=` and `Referer` behaviour.

   Write the findings into `docs/development/real-tenant-validation.md`.

**Prove:** unit tests for the measures and the registry; the smoke script
tested against the fake content host.

### WP14: Production readiness

Do each item and record its evidence:

1. **Privacy and security.**
   - Update `PRIVACY.md` (the Agent reads published files itself; Ask
     Dapty calls; MAIN-world reads; what reaches a model), `SECURITY.md`
     (hosts, no customer-script execution, SSRF guards) and `DECISIONS.md`
     (one entry per §5 decision as answered).
   - Run `npm run audit:architecture`.
   - Review every new MAIN-world function for page-controlled input: no
     `eval`, no `Function`, no `innerHTML`.
2. **Store.** `docs/store/WEB_STORE_LISTING.md` data-use disclosures cover
   Ask Dapty and content reads. Add no permission.
3. **MV3 lifecycle.**
   - Ask Dapty streams run in the side panel and are aborted on close.
   - The MCP-bridge path uses the same orchestrator in the service worker;
     verify a long case does not exceed the worker's lifetime, or degrade
     gracefully.
   - Add an unhandled-rejection guard around the orchestrator.
4. **Performance.**
   - The WP7 budgets.
   - Fetches: at most 6 concurrent and 40 per case; a 5 MB per-file cap
     (built) and a 25 MB per-case cap.
   - Rules are evaluated once per case and pass; the page is probed once
     per case and Re-check.
   - No model request on the check path. Assert this in each E2E
     (`model.requests.length` unchanged).
5. **Request and tool budgets.** `tooling/e2e/request-budgets.json` and
   `tool-budget.e2e.test.mjs` stay green; `audit:tools` passes.
6. **i18n and accessibility.** en and zh for every string; the axe suites
   light and dark; keyboard paths through the intake, the checklist and
   the result.
7. **Code quality.**
   - `audit:any` is not raised.
   - knip is clean.
   - No dead code: delete the code replaced in WP3.
   - The coverage thresholds rise, never fall.
   - Each new module has a top doc comment saying what it mirrors, with
     its citation.
8. **Docs.**
   - `docs/development/se-flow-architecture.md`: mark built sections.
   - `docs/development/se-flow-coverage.md`: mark each condition built,
     with its rule ID.
   - `docs/se-guide.md`: the SE's new flow; "what to type".
   - `docs/support-runbook.md`: "?" rows and what to ask.
   - `CHANGELOG.md` gets an Unreleased entry.
   - `docs/STATUS.md`.
9. **Rollout.** Every new network behaviour is gated by policy or
   settings:
   - `askDapty` absent means no call;
   - `aptyContentOrigins`;
   - `aptyClientRecord` is `off` by default;
   - the existing "Apty content CDN" switch turns all replay off.

   Document the defaults.

### WP15: End-to-end matrix

Under `tooling/e2e/se-flow-*.e2e.test.mjs`, using the harness:

- `startServer` for the fake content hosts, one 4.x and one 5.x;
- a fake ai-service SSE;
- `startMockModel`;
- `launchBrowser` with no Client extension, except in the
  `aptyClientRecord: optional` test.

For **each symptom × version** that applies:

1. The rows appear before the result.
2. The expected cause, evidence and fix are present.
3. Every content request is a GET with no cookie, and on 4.x carries
   `token=`.
4. No model request on the check path.
5. No URL and no unmasked value in the card.
6. `panel.consoleErrors` is empty.
7. Re-check after a fixture change flips the row.
8. **The request count matches §3.2.** The fake content host records
   every path. Assert:
   - exactly the symptom's declared files, each once, plus
     `content-config.json` once;
   - no `app-urls.json` when all three IDs were given;
   - **zero** requests for a bare how-to;
   - zero new requests for a follow-up question;
   - on Re-check, every request carries `If-None-Match` or
     `If-Modified-Since`.

Also run the a11y and chat-scroll suites (400 and 480).

---

## 8. UI/UX specification (one place)

- **The chat turn:**
  1. the SE's message;
  2. (if needed) one intake card;
  3. the live checklist, grouped and collapsible per group, with the
     summary line live;
  4. the result card;
  5. (if offered) Ask AI anyway;
  6. the AI answer card, or "Not enough evidence".
- **Row anatomy:**
  - a status icon (✓ ✗ ? ℹ, with an sr-only status word);
  - a one-line label;
  - a muted source suffix ("published file, fetched by the Agent",
    "page", "Ask Dapty", "cards", "not checked");
  - an expandable evidence area (file · field · value, masked; element
    selector; citation);
  - the rule tag in small type.
- **The issue anatomy:** what's wrong (one sentence), the evidence, how
  to fix it (an imperative, naming the Studio setting), a KB card link,
  and "Was this right?".
- **Empty and error states:**
  - no Apty on the page, with no IDs: "This page doesn't show Apty. Give
    the tenant, application and environment, or open a page where Apty
    runs."
  - the policy blocks the host: "Apty's content host <origin> isn't
    allowed by your organization's policy."
  - offline;
  - Ask Dapty not set up: an info row, no error.
- **Options and first run:**
  - Client screens are hidden by default (WP3);
  - read-only policy status for content hosts, Ask Dapty and Model A.
- **Consistency.** Reuse `GateRow`, `VerdictFooter`,
  `SupportBundleButton` and the existing card styles. No new colours
  outside the tokens. Dark mode is first-class.

---

## 9. Optimisation checklist

- One replay source per case (built). Concurrent requests for the same
  file share one fetch (built: `inFlight` in `apty/replay/content-source.ts`).
  One `apty-files` per case run.
- Conditional requests on Re-check (built). Cache `not_published` per
  case (built).
- The page probe and MAIN-world reads are batched into **one**
  `chrome.scripting.executeScript` per frame per case where possible.
- The rule evaluator is pure and memoised per (rule, context hash).
- The model path gets the final result only: never raw files, never
  every row's evidence. Respect `tooling/e2e/request-budgets.json`.
- Aborts propagate (an `AbortSignal` from the case to every fetch and
  stream).

---

## 10. Definition of done (the whole task)

1. WP0–WP15 are **done**, or **partial** with exactly what is missing.
2. `npm run preflight` is green. The E2E suite is green, with the new
   files listed and their output pasted. All the audits in §1.4 are
   green.
3. An SE on a page with Apty types only the problem, and gets live rows
   and one result with causes, evidence and fixes. This is shown for both
   versions in E2E.
4. With no Client extension and no saved ID, every content check works,
   for both versions.
5. Requests follow the network-call policy (§3.2), asserted in WP15
   item 8.
6. No code path contacts the Apty Client by default. No request sends
   credentials. No customer script runs (unless O-4). No value reaches a
   model unredacted.
7. The coverage manifest lists every implemented condition, and
   `audit:apty-coverage` passes against apty-dap `3f3adba` and
   apty-assist `bbb4cbc`.
8. The docs in WP14 are updated.

## 11. Hand-over

Write `REVIEW.md` with:

1. Commits per WP.
2. Test output: unit counts, E2E list, audits.
3. Each "before/after" failing-then-passing proof.
4. Owner decisions as answered.
5. Every fact from §4 that you found changed, with the new citation.
6. What is partial, and why.
7. What was not run: a real tenant, Ask Dapty KB, real models.

Do not push. Tell the owner the branch name and the head commit.
