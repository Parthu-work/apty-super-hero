# The SE flow, end to end: architecture and design

Status: **design**. Nothing in this document is built yet, except where it
says **exists** or **built**.

All work happens in apty-super-hero. apty-dap and apty-assist are read only.
Claims about Apty cite `repo:path:line`:

- apty-dap paths are at commit `3f3adba`, under `packages/`.
- Agent paths are at commit `7119848`.

The replay of the player's network requests is in
[replay-network-source.md](replay-network-source.md).

## 1. The answer

**Yes, the flow is achievable, with no Apty change and without the script
in the Apty Client.** Four facts make it possible, and four change the
diagrams.

### What makes it possible

1. **Network data without the Client script.** The Agent replays the
   player's public GETs itself, for a tenant, application and environment.
   It uses the same paths and the same timestamp, and every response goes
   through the same deny list and redaction. This is built and tested (5.x)
   on this branch.
2. **Ask Dapty can be called by the Agent directly.** The widget chat routes
   are public:
   - `@PublicAuthGuard` only sets `isPublic`
     (`libs/server/core/src/auth/auth.guard.ts:11,53-55`).
   - CORS never rejects a request. An unknown Origin only leaves out the
     `Access-Control-Allow-*` headers
     (`libs/server/core/src/app-origin-cors/app-origin-cors.delegate.ts:40-68`).
   - The Agent's service worker has `<all_urls>` host permission
     (`apps/browser-extension/manifest.json:59`). It is not bound by CORS,
     so it can POST to `{aiBackendURL}/ai-service/api/v1/ai/{kbTenantId}/widget/chat/stream?applicationId=…`
     and read the SSE stream.
3. **Grounding is per tenant.** `knowledge_retrieve` filters Qdrant on
   `tenant_id` and on `application_ids ∋ {appId | __tenant_wide__}`
   (`apps/ai-service/src/vector-store/vector-store.service.ts:175-185`).
   A **dedicated KB tenant** whose documents are ingested tenant-wide
   therefore answers from those documents only.
4. **The cards, the checks and the model path exist.** The cards are
   `localKbMatches` (`packages/browser-runtime/src/kb/kb-matches.ts:178`).
   The check packs are in `apty/diagnosis/`. The providers include OpenAI,
   Azure OpenAI and Anthropic
   (`packages/agent-core/src/config/ai-providers.ts:30,40,178`).

### What the research changes in the diagrams

| Diagram assumption | What the code says | Design consequence |
|---|---|---|
| "Ask Dapty … web answer" can be detected | The stream has six event types: `token`, `tool_start`, `tool_end`, `done`, `title`, `error` (`libs/shared/contracts/src/ai/ai-chat-widget/ai-chat-widget.schema.ts:37-44`). Web search runs provider-side (`apps/ai-service/src/llm/llm.service.ts:140-147`). `tool_start` reports only the first client tool call (`:358-371`). The one-shot response has no sources (`ai-chat-widget.schema.ts:31-35`). | A web answer **cannot be detected for certain**. Ask Dapty's answer is classified with a heuristic (§4.2) and is always shown as **labelled guidance, never as evidence**. |
| "gave up" is a clear signal | The server forces the exact give-up text only when the reply is empty (`apps/ai-service/src/api/ai-chat-widget/ai-chat-widget.service.ts:144-146`). Otherwise the model is only *told* to use it (`apps/ai-service/prompts/chat/system-widget.md:22-27`). | Two signals count as giving up: exact text, or a near-match of it with no suggestions. Anything else is an answer. |
| "Model A: gpt-6-luna (Apty's model family)" | `gpt-6-luna` is the **OpenAI** model ai-service uses by default (`apps/ai-service/src/llm/llm.constants.ts:3-7`). Apty's ai-service has no Azure configuration. | Model A is the **Agent** calling OpenAI (or Azure OpenAI, which the Agent supports) with the **org's key** and model name `gpt-6-luna`. Whether that key serves this model is **NOT VERIFIED**: configure it, and fall through to B on 404/400 as well. |
| Diagram 2 sends "Ask AI anyway" to Anthropic only; diagram 1 has A, then B | — | **Diagram 1 is the design.** Anthropic only is the case where no org OpenAI/Azure key is configured. |

### What the Client script gave that replay cannot

These are lost when the script goes. The table says what replaces each one.

| Lost | Used by | Replacement |
|---|---|---|
| The Client's service-worker **logs** | logs-and-errors (`diagnosis/log-loader.ts:21-40`) | The page console through `chrome.debugger` `Runtime.consoleAPICalled`, which may include the Client's content-script logs (**NOT VERIFIED**). The page console the Agent already reads. The row says "Client logs: not available (no Client script)". |
| Whether the Client's **own requests** succeeded on the user's network | logs-and-errors, the "loaded by the Client" wording | In Injected mode, page capture shows the player's real calls (**exists**: `network-capture-session.ts`). In Extension mode nothing replaces it. Rows say "published now", never "loaded by the Client". |
| The Widget's **Ask Dapty chat** in Extension mode (`get-widget-chat`) | the dapty-conversation pack (`diagnosis/dapty-sources.ts`) | The stored chat on the CDN, when the user ID is on the page (**exists**: `apty-cdn-source.ts`). The widget DOM reader (**exists**: `dapty-widget-reader.ts`). Asking Ask Dapty the same question directly (§4.2). |
| `inspect_extension_network`, the file-fetch responder, Settings → Widget network calls | the model tools and the Options page | Re-point them to `fetch_apty_file` / replay (**built**: `tools/apty-content.ts`) when no Client answers. The Options panel shows the case's replay log. |

## 2. Final flow (what the SE sees)

```
SE types the question in the Agent's chat
   │
   ▼
0. Resolve the Apty context (no request when the SE gave IDs)
   page config → tenant + contentURL; app-urls.json + page URL → app + env
   or the IDs the SE gave, pinned for the case
   │
   ├───────────────────────────────┬──────────────────────────────────────┐
   ▼                               ▼                                      ▼
1. Ask Dapty (streaming)     2. Checks (parallel, live rows)       2b. Cards
   dedicated KB tenant          replay files once per case            in memory, only if
   ├─ KB answer ─► guidance     every matching pack:                  Ask Dapty gave up or
   └─ gave up / web? ─────┐     content, widget, element,            may be a web answer
                          │     logs (page), page readiness           ├─ covered ─► card as written
                          │     ✓/✗ rows appear as they resolve        └─ not covered
                          └───────────────┬──────────────────────────────┘
                                          ▼
3. ONE result:
   "Issues found, please fix all of these"
      1. What's wrong · evidence (file, field, element) · how to fix · source
      2. …
   Ask Dapty guidance (labelled)   or   the card as written
   [Re-check] [Copy for support]
                                          │
               no issue found, no KB answer, and no card covers it
                                          ▼
4. [ Ask AI anyway ]   (the only question to the SE)
          │
   org OpenAI/Azure key configured? ── yes ─► Model A (OpenAI or Azure, default gpt-6-luna)
          │ no                                   │
          │                     quality check ─ pass ─► "AI answer · gpt-6-luna" (cited)
          │                                      │ fail, or error: no key, 400/404 model,
          │                                      │ 401, 403, 429, 5xx, timeout
          ▼                                      ▼
   Model B: Anthropic (the Agent's model)  ◄─────┘
          │
   quality check ─ pass ─► "AI answer · Anthropic" (cited)
          │ fail
          ▼
   "Not enough evidence": unsupported claims listed "to check",
   the next check to run, [Copy for support]
```

**Timeline (one screen).** The question arrives. The Ask Dapty stream and
the checks start together.

1. Rows appear as each gate resolves:
   - ✓ environment matched
   - ✓ content file loaded
   - ✓ published here
   - ✗ target element not found
2. When both are done, one result is rendered: the issues found, the Ask
   Dapty guidance (labelled), Re-check and Copy for support.

Nothing waits on the model unless the SE presses **Ask AI anyway**.

## 3. Architecture

```
@apty/agent-core            pure TS: interfaces, decisions, no browser
  apty/content-source.ts      AptyContentSource (built)
  apty/ask-dapty.ts           AskDaptyClient interface, DaptyAnswer classification types
  case-run/                   CaseRun, CaseRunEvent, Finding, aggregate(), result policy
  answer/                     ProviderChain, FallbackReason, QualityCheck (pure), AnswerLabel
  agent/                      LocalAnswer.progress + "tool_call_progress" AgentEvent

@apty/browser-runtime       Chrome implementations (service worker / side panel)
  apty/replay/                replay source, catalogue, schemas, case registry (built)
  apty/ask-dapty/             SSE client over fetch, redaction of the question, classifier
  apty/case-run/              orchestrator: context → {Ask Dapty ∥ packs ∥ cards} → result
  apty/diagnosis/             packs (exist); router returns every matching route
  answer/                     provider chain runner, error classification, quality checker

@apty/ui                    (depends on agent-core only)
  case-run views              live rows, issues list, guidance panel, AI-answer card,
                              "Not enough evidence" card, Re-check, Copy for support

apps/browser-extension      wiring: responder registration, settings/policy,
                              Options (KB tenant, Model A), Ask AI anyway handler
```

`@apty/ui` keeps no dependency on `@apty/browser-runtime`. The case-run
views take `CaseRunEvent` and `CaseRunResult` from agent-core types.

### 3.1 Data flow and trust

```
page (untrusted) ──probe──► tenantId, contentURL (vetted: https, not private network)
SE ───────────────────────► IDs (pinned per case), question (redacted before leaving)
org policy (managed) ─────► aptyContentOrigins, askDapty {aiBackendURL, kbTenantId, kbApplicationId,
                             envId, applicationType}, modelA {provider, host, model, key}, modelB
                                  │
Agent service worker ──GET──► content host (catalogue paths only, no credentials)
                     ──POST─► ai-service widget/chat/stream (KB tenant only, redacted question)
side panel ─────────────────► Model A / Model B (destination policy, KB-to-model policy)
```

Rules that carry over unchanged:

- The deny list and redaction cover every body.
- Nothing is stored on disk.
- No host comes from a model's free text.
- The Ask Dapty host and KB tenant come **only from the org policy or
  Settings, never from the page**, so a page cannot redirect the question.

## 4. Components

### 4.1 Case run orchestrator (`browser-runtime/apty/case-run/`)

```ts
interface CaseRunInput { question: string; conversationId: string; tabId?: number; fresh?: boolean }
type CaseRunEvent =
  | { type: "context"; context: AptyContentContext | { failure: AptyContextFailure } }
  | { type: "row"; packId: PackId; gate: GateResult }          // live ✓/✗ row, with source
  | { type: "dapty"; state: "streaming" | DaptyAnswer }         // guidance, labelled
  | { type: "card"; outcome: KbOutcome }                        // only if Ask Dapty gave up
  | { type: "result"; result: CaseRunResult };
```

1. It resolves the context first. It uses the pinned IDs, or else the page
   probe plus `app-urls.json` (replay, built).
2. It starts Ask Dapty and every matching pack at once, with
   `Promise.allSettled`. **Change:** `routeSymptom` returns all matching
   routes, ranked, not one (`router.ts:217`). A tooltip question runs
   content-not-visible (tooltip), element-not-found (tooltip) and
   widget-not-visible when the widget is in question. Every pack reads files
   through **one** `apty-files` per case, so each file is fetched once.
3. **Live rows.** Each pack emits gates as soon as its evidence is loaded.
   The packs are pure functions of evidence, so the orchestrator emits:
   - the `context` row;
   - one "file loaded / not published" row per file, from
     `replayResourceSource`;
   - each pack's gates when that pack finishes.

   That is enough for the timeline in §2, with no rewrite of the packs.
4. **Cards gate.** `localKbMatches` runs only when Ask Dapty returns
   `gave_up` or `web_or_unknown` (§4.2). It already exists, with its
   outcomes and "card as written" rendering.
5. **Aggregate** (`agent-core/case-run/aggregate.ts`):
   - merge `verdict.causes` from every pack;
   - de-duplicate by `ruleId` + subject;
   - order by gate order (data → environment → published → audience →
     element → page);
   - keep each cause's evidence, fix, card page and source row.

   Status:
   - `issues` when any cause is found;
   - `candidates` when only open candidates remain;
   - `clear` when nothing is found;
   - `no_data` when no files could be read.
6. **Re-check** re-runs with `fresh: true`. That makes conditional requests
   on replay (built), and a new Ask Dapty call only if the question changed.

**Streaming into the chat.** Today a local responder returns one answer, and
`runLocalAnswer` emits `tool_call_start` and then `tool_call_complete`
straight away (`packages/agent-core/src/agent/apty-agent.ts:794-815`).
Add `progress?: AsyncIterable<unknown>` to `LocalAnswer`
(`agent-core/src/types.ts:173-184`) and a `tool_call_progress` event.
`runLocalAnswer` yields each progress item between start and complete. The
case-run card renders rows from progress, then the final result. The case
recorder and transcript keep only the final result.

### 4.2 Ask Dapty client (`browser-runtime/apty/ask-dapty/`)

**Request**

- `POST {aiBackendURL}/ai-service/api/v1/ai/{kbTenantId}/widget/chat/stream?applicationId={kbApplicationId}`
- Body: `{ message, context: [], envId, applicationType }`
  (`libs/shared/contracts/src/ai/ai-chat-widget/ai-chat-widget.schema.ts:20-29`).
  No `userId` or `chatId` is sent, so no usage is attributed to a customer
  user.
- `credentials: "omit"`.
- The question is redacted at the case's redaction level before it is sent.
  It goes through the same egress decision as KB text (`kbEgressAllowed`).

**SSE parsing**

- `data: <json>` frames.
- `tool_start` / `tool_end` names are kept for classification.
- `done.reply` is authoritative.
- `error` means `error`.
- An HTTP 4xx before any SSE header (a bad body) means `error`
  (`apps/ai-service/src/api/ai-chat-widget/ai-chat-widget.controller.ts:61,97-105`).
- If the stream never opens, fall back to the one-shot route, as the player
  does (`apps/player/src/main-content-script/api-client/widget-chat-api-client.service.ts:71-88`).

**Classification (`DaptyAnswer.kind`)**

- `gave_up`: the reply equals `CANNOT_ANSWER_MESSAGE`, or is a normalised
  near-match of it with no suggestions.
- `error`: the reply is "Sorry, I was unable to generate a response…"
  (`ai-chat-widget.service.ts:89`), the stream error, a timeout (20 s), or
  no answer.
- `kb_answer`: a `knowledge_retrieve` tool round was seen, and the reply
  carries `[n]` markers or no URL outside the KB tenant's docs domains.
- `web_or_unknown`: anything else, for example a reply with URLs but no
  `knowledge_retrieve` round. This is a **heuristic**: it is shown as
  guidance labelled "may include web results", and it also opens the cards
  gate.

**Shown as:** "Ask Dapty guidance · KB" or "Ask Dapty guidance · may include
web results". It is never a cause in the issues list. The answer's text goes
through the same output privacy as other results.

### 4.3 Ask AI anyway (`agent-core/answer/`, `browser-runtime/answer/`)

**When it is offered.** The result is `clear` or `no_data`, Ask Dapty gave
up or errored, and no card covers the question. Today it is offered only on
`unknown_setting` (`packages/browser-runtime/src/kb/kb-matches.ts:266-275`).
The new rule supersedes that, and `not_covered` no longer goes to the model
by itself (`responder.ts:686-689`).

**Provider chain** (pure decision in agent-core, runner in browser-runtime):

```ts
type ModelSlot = { label: string; provider: AIProviderKey; host?: string; model: string; key: string }
type FallbackReason = "no_key" | "model_unavailable" | "auth" | "rate_limited" | "server" | "timeout" | "quality_failed"
```

- **Slot A** is the org OpenAI or Azure OpenAI key, from the org policy
  preset or Settings. The model defaults to `gpt-6-luna`.
- **Slot B** is Anthropic, the Agent's model.
- Each slot passes `destinationAllowed` (`agent-core/src/config/destination.ts:59-72`).
  A slot the policy disallows is skipped as `no_key`.
- The existing retry for the same provider (3 tries on 429 / 5xx / timeout,
  `apty-agent.ts:57,116-127`) runs inside each slot. A **400/404 naming the
  model, 401, 403**, or retries exhausted moves to the next slot.
- The answer is labelled with the slot that passed: "AI answer · gpt-6-luna"
  or "AI answer · Anthropic".

**What the model gets**

- The SE's question.
- The case result: every gate row, its source and status, and the causes.
- Ask Dapty's reply, marked as guidance.
- The cards that matched, only if the org policy's `kbToModel` is
  `approved` (`agent-core/src/config/org-policy.ts`, KB-to-model egress).
- The read-only tools: `fetch_apty_file`, `list_apty_files`,
  `resolve_apty_context`, `run_diagnosis`, `search_kb`, and the element
  tools.
- The instruction: every Apty claim must cite `kb://card#L`,
  `check://<ruleId>` or `code://<repo>:<path>:<line>`.

**Quality check** (deterministic, pure, `agent-core/answer/quality.ts`). It
runs before anything is shown.

1. **Citations.** Split the answer into claims (sentences naming an Apty
   setting, file, field, item, rule or menu). Each needs a citation that
   resolves:
   - `kb://` must be a card returned this turn;
   - `check://` must be a gate or cause in this case's result;
   - `code://` must be in an allow-list of Apty code locations that ships
     with the KB pack.
2. **Grounding.** Reuse `ungroundedPhrases` / `ungroundedLocations`
   (`packages/ui/src/lib/kb-grounding.ts:45,89`). This means moving them, or
   a pure copy, into agent-core so the check does not depend on UI.
3. **No contradiction.** A claim must not contradict a decided gate. For
   example, the answer must not say "the tooltip is published" when the
   `published` gate failed, nor "the environment is X" when the context says
   Y. Claims are matched against `GateResult.id/status/params`.
4. **Result.** Pass means every claim is cited and none contradicts a gate.
   Fail returns the list of unsupported claims.

Model B runs only if A errors or fails the check. If B fails too, the
**"Not enough evidence"** card shows:

- B's unsupported claims, listed as "to check";
- the case's `nextCheck`;
- **Copy for support**, which uses the existing `SupportBundleButton` /
  case record.

### 4.4 Result card (`@apty/ui` + extension)

- **Header:** "Issues found, please fix all of these" (`issues`), or "No
  issue found in Apty's data" (`clear`), or "Could not read Apty's data"
  (`no_data`).
- **Each issue:**
  - what's wrong, the evidence (file, field, element), how to fix;
  - its source ("Client record" / "published file, fetched by the Agent" /
    "page"), using `GateResult.source` (built);
  - its card link.
- **Live rows above the issues:** the existing `GateRow`
  (`check-result-card.tsx:624`), streamed.
- **Guidance panel:** Ask Dapty (labelled), or the card as written (the
  existing `kb-matches-card.tsx`).
- **Buttons:**
  - Re-check (§4.1);
  - Copy for support (the existing `VerdictFooter` copy, plus the case
    bundle);
  - Ask AI anyway (only when §4.3 allows).

### 4.5 Settings and organization policy

New org-policy keys, parsed strictly like the existing ones and added to
`managed-schema.json`:

- `aptyContentOrigins` (**built**).
- `askDapty`: `{ aiBackendURL, kbTenantId, kbApplicationId, envId, applicationType }`
  (uuid / https checks). It is absent by default, which means no Ask Dapty
  call.
- `modelA`: `{ provider: "openai" | "azure", host?, model = "gpt-6-luna", token }`,
  next to the existing preset (`org-policy.ts:15-21`). Settings shows it
  locked when set by policy.
- `aptyClientRecord: "off" | "optional"`. `off` (the target) never pings or
  asks the Client. `optional` keeps today's order for tenants still on the
  patch.

**Source order** (`apty-files.ts`, after this change):

1. page capture (a real observation, in Injected mode);
2. replay for the pinned or probed context;
3. the Client's record only if `optional`.

The old probed-CDN path merges into replay (§6, step 2).

## 5. Feasibility by check, without the Client script

| Check | Without the Client script | Rows say |
|---|---|---|
| Environment matched | yes: `app-urls.json` + page URL, or pinned IDs | published file, fetched by the Agent |
| Content file loaded / published here | yes: replay; the CloudFront 200 not-found page is handled (built) | published file, fetched by the Agent |
| Item present, hidden from widget, segments, audience, visibility rule, language | yes: from the files | published file, fetched by the Agent |
| Segment membership, rule results for this user | no, and not before either: runtime only | not checked |
| Target element on the page | yes: element probe in every frame (exists) | page |
| Page readiness | yes: DOM Health (exists) | page |
| Console errors | page console yes; the Client's service-worker logs no | page / not available |
| Did the Client's own requests succeed | Injected mode yes (page capture); Extension mode no | not available |
| Ask Dapty: what the user saw | stored chat (needs the page's user ID), or the widget DOM | page / published file |
| Ask Dapty: what the KB says now | yes: direct call to the KB tenant | Ask Dapty guidance |

## 6. Build plan (each step is a PR, tests next to the code, `npm run preflight`)

1. **Done on this branch:** replay (5.x), the tools, row sources, and the
   page-URL hardening.
2. **Replay as the only CDN path.** Move stored chats and the probed fallback
   onto `createReplaySource`. Add the `aptyClientRecord` setting with default
   `off`. Re-point `inspect_extension_network` and the file-fetch responder
   to replay when no Client answers. Build 4.x replay (timestamp, matching,
   `apty_config` probe).
3. **Progress events.** Add `LocalAnswer.progress` and `tool_call_progress`
   in agent-core. Render live rows in the existing check card.
4. **Case run orchestrator.** The router returns all routes, packs run in
   parallel on one replay, aggregation, and the combined result card with
   Re-check.
5. **Ask Dapty client.** Org policy `askDapty`, the SSE client, the
   classifier, the guidance panel, and the cards gate after a give-up.
6. **Ask AI anyway.** The provider chain (A, then B), error classification,
   the deterministic quality check, and the "Not enough evidence" card.
7. **E2E** with the existing harness:
   - a fake ai-service (SSE) for the KB answer, the give-up and an error;
   - a fake content host (exists);
   - mock models for A (OpenAI shape) and B, including 401, 429 and a
     quality failure.

   Each proves the one-screen result and the fallbacks with no Client.

## 7. Risks and open decisions

| # | Item | Proposal |
|---|---|---|
| 1 | Web answers from Ask Dapty cannot be detected for certain | Use the heuristic in §4.2. Label the answer "may include web results" and never treat it as evidence. Detecting it properly needs an Apty change (out of scope). |
| 2 | The SE's question leaves the Agent for Apty's ai-service | Redact first. It goes only to the KB tenant from the org policy, and is off until the policy sets `askDapty`. |
| 3 | Someone must own the KB tenant: ingesting the Confluence/KB docs into Qdrant under it, tenant-wide | **Owner decision.** Without documents every answer is a give-up, which is safe. |
| 4 | No rate limit was found on the public chat route (NOT VERIFIED at ingress); usage is logged in ClickHouse under the KB tenant | One call per question, not per Re-check unless the question changed. |
| 5 | `gpt-6-luna` on the org's OpenAI/Azure key is NOT VERIFIED | Configurable model name. A model 400/404 falls through to B. |
| 6 | `kbToModel: off` (the policy default) means the model cannot see cards, so "Ask AI anyway" can cite only checks and code | Expected. Answers will more often end in "Not enough evidence"; the org decides. |
| 7 | Whether the Client's content-script console reaches `Runtime.consoleAPICalled` on the tab (NOT VERIFIED) | A spike in step 2. If not, logs-and-errors in Extension mode covers the page only. |
| 8 | Removing the Client record loses "loaded by the Client" | Rows say "published now". In Injected mode, page capture keeps real observation. |
| 9 | Loopback and DNS-to-private page content hosts (replay doc §3.3) | Trust only policy and known Apty origins once `aptyContentOrigins` is set. |

## 8. Both versions: 4.x (apty-assist) and 5.x (apty-dap)

Every step of the flow works for both versions. Only five things differ
between them, and each one is a field of a per-version **adapter**. The
adapter is a plain object, not a class. The orchestrator, the checks'
loader, the result card, Ask Dapty and Ask AI anyway are shared.
4.x paths are under `apty-assist:player3.0/` at `bbb4cbc`.

### 8.1 What differs, and where the code says so

| Step | 5.x (apty-dap) | 4.x (apty-assist) |
|---|---|---|
| **Find Apty on the page, Extension mode** | Page loads `chrome-extension://<id>/window-script.js`, so the Agent reads web-accessible `player-config.json` → `contentURL`, `tenantId` (`apps/player/wxt.config.ts:88-91`) | Page loads `chrome-extension://<id>/window.var.js` (`src/shared/helpers/react.element.helper.ts:7-19`; `src/main.bootstrap.ts:203-207`), so the Agent reads web-accessible `config.json` (`src/manifests/manifest.json:17-21`) → `contentURL`, `tenantKey`, `regExpUrlFlag`, `isSelfHosted` |
| **Find Apty on the page, Injected mode** | `window.__APTY_PLAYER_CONFIG__` (`apps/player/src/config/config.ts:9-16`) | `#letznav-script` attributes: `data-instanceid`, `data-content-url`, `data-app-urls`, `data-reg-exp-url`, `data-self-hosted` (`src/shared/helpers/injected.helpers.ts:344-375`) |
| **ID shapes** (to recognise IDs the SE gives) | tenant, app and env are UUIDs (`libs/shared/contracts/src/api.schema.ts:96-98`) | tenant key is a short string (`config/config.json:7`); app `id: number`; env numbers as keys (`src/shared/types/common-models.types.ts:1022-1031`) |
| **Choose the application and environment** | `app-urls.json`: `[{id, environments:[{id, order, urls[]}]}]`. Take the first app with a match, then the lowest `order`, matching the pattern as a wildcard. Regex is never used: the flags are always off (`libs/client/tool-items-schema/src/helpers/active-application.helpers.ts:3-45`) | `app-urls.json`: `[{id, environments:{[n]:{url, hostedContentUrl?}}}]`. Take apps in order, env keys sorted numerically, first `url` match. Match as a wildcard, **or as a raw regex when `feature-flag.json` `regExpUrl` is on** (`src/shared/helpers/injected.helpers.ts:18-49`; `src/shared/helpers/app.helper.ts:81-99`; `src/main.bootstrap.ts:210,300`). No match means env 1 |
| **Content URL** | The page config's `contentURL` | The same, but **self-hosted** switches to `{hostedContentUrl}/contents` of the matched env (`src/main.bootstrap.ts:138-150`) |
| **Timestamp** | Walk the tenant `content-config.json` along `[app-{a}, env-{e}, file]`, keeping the nearest `latest` (`apps/player/src/main-content-script/cdn/file-timestamp.ts:4-27`) | Fetch the tenant **and** the app `content-config.json` and merge them (`src/main.bootstrap.ts:172-178`). Then `cc[app][env][file] \|\| cc.latest \|\| now` (`src/shared/content-config.helper.ts:5-29`). `app-urls.json` uses an ISO date; `most-used-content.json` uses local midnight |
| **URL suffix** | `?timestamp=` | `?timestamp=…&token=`, always with an empty token (`src/shared/helpers/common-helpers.ts:90-95`) |
| **Not published** | 200 with a `{status:404}` body, or a real 404 (`libs/shared/axios-client/src/axios-client.ts:45-54,84-88`) | A `status: 404` payload (`src/api/http.ts:278-284`). The same detector works |
| **Content files** | `tooltip`, `workflow`, `segment`, `rule`, … `.json` at env scope; `workflow-{id}.json` | `tooltip`, `flow`, `launcher`, … at env scope; `segments`, `rules`, `langs` at **app** scope; `feature-flag.json` at tenant scope; `flow-{id}.json` (`src/shared/helpers/cdn-helpers.ts:5-36`; `src/api/backend.ts:266-290`) |
| **Checks** | `content-not-visible`, `widget-not-visible`, `element-not-found`, `dapty-conversation` | `content-not-visible-4x` (`flow`, `segments`, `rules`, `feature-flag`, `flow-{id}`) and `widget-not-visible-4x` (`app-urls`, `app-data`, `feature-flag`, `segments`); these already exist in `apty/diagnosis/` |
| **Ask Dapty in the player** | The widget chat exists | None: no `widget/chat` or `ai-service` call anywhere in `player3.0/src`. The `dapty-conversation` check does not apply |

### 8.2 The adapter

```ts
// @apty/agent-core: pure, testable; one object per version
interface AptyVersionAdapter {
  version: "4.x" | "5.x";
  files: readonly AptyFileSpec[];                                  // built: FILES_4X, FILES_5X
  looksLikeIds(ids: GivenIds): boolean;                            // UUIDs vs short key + numbers
  filePath(ctx, file, extra): PathResult;                          // built (shared builder)
  urlSuffix: "" | "&token=";                                       // built
  contentConfigFiles(ctx): readonly string[];                      // 5.x: tenant; 4.x: tenant + app
  timestamp(ctx, file, contentConfigs, now): string;               // 5.x built; 4.x merge + lookup
  matchEnvironment(appUrls, pageUrl, regexOn): Match | undefined;  // 5.x built; 4.x numeric keys + regex
  regexFlag(ctx, files): boolean;                                  // 5.x false; 4.x feature-flag.json
  contentURLFor(ctx, match): string;                               // 4.x self-hosted hostedContentUrl
  packs: Record<Symptom, PackId>;                                  // routes a symptom to the right pack
}

// @apty/browser-runtime: Chrome, one probe per version and mode
probe5x(tab): window-script.js + player-config.json | __APTY_PLAYER_CONFIG__
probe4x(tab): window.var.js + config.json           | #letznav-script attributes
```

**Choosing the adapter:**

1. If the SE names the version, use it.
2. Otherwise use the probe that found Apty on the page.
3. Otherwise infer from the IDs' shape. A UUID tenant means 5.x; a short key, numeric app and env numbers mean 4.x.
4. If none of these settles it, ask the SE.

The version is pinned with the context, so the checks pick the right
packs. `replayVersion` (built) already carries it into `playerVersionOf`.

### 8.3 What else changes for both

- **Ask Dapty** answers 4.x and 5.x questions from the same ai-service.
  Retrieval filters on `applicationId` or tenant-wide documents
  (`apps/ai-service/src/vector-store/vector-store.service.ts:175-185`).
  So the KB tenant holds **one application per version**: `askDapty.kbApplicationIds: { "4.x", "5.x" }`.
  Common documents are loaded tenant-wide, and each version's documents
  under its own application. The Agent calls with the case's version. This
  matches the Agent's own KB packs, which are already keyed `4.x | 5.x | common`.
- **Cards** are already per version (`packages/browser-runtime/src/kb/kb-version.ts`).
- **Hosts.** A 4.x self-hosted `hostedContentUrl` comes from a file on an
  allowed host, but it names another host. It is used only when its origin
  is in `aptyContentOrigins`; otherwise the row says
  `host_not_allowed` and names the host to add. (Open decision 10.)
- **Ask AI anyway** gets the version in its context, and the quality check
  rejects a claim cited only from the other version's cards.

### 8.4 State on the branch and remaining work

| Piece | 5.x | 4.x |
|---|---|---|
| File catalogue and paths | built | built (with `app/content-config.json` for the app-level one) |
| URL suffix | built | built (`&token=`) |
| Not-published detection | built | built (same detector) |
| Given IDs → fetch | built | built (needs app and env) |
| Page probe | built | **to do**: `window.var.js` + `config.json`; `#letznav-script` |
| Environment matching | built | **to do**: numeric keys, regex flag from `feature-flag.json` |
| Timestamp | built | **to do**: merge the tenant and app content-config |
| Self-hosted content URL | n/a | **to do**, behind `aptyContentOrigins` |
| Checks on replayed files | built and tested | the packs exist; to do: E2E on replayed 4.x files |
| Version inference from IDs | **to do** | **to do** |

This becomes step 2 of the build plan (§6), split into
2a (the adapter, with 5.x moved onto it unchanged) and 2b (4.x probe,
matching, timestamp, self-hosted, E2E).

| # | Open decision | Proposal |
|---|---|---|
| 10 | 4.x self-hosted `hostedContentUrl` names a host the policy may not list | Allow it only when it is in `aptyContentOrigins`; the row names the host to add |
| 11 | The 4.x Extension-mode Client's `config.json` also carries keys such as `segmentIOKey` (`config/config.json:5`) | The probe returns only `contentURL`, `tenantKey`, `regExpUrlFlag` and `isSelfHosted`; nothing else leaves the page |
