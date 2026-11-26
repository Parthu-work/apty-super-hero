# Replay: the Agent reads Apty's published content itself

Status: **partial**. The 5.x slice is built and tested: the interface, the
service-worker source, the three tools, the check packs reading replayed
files, and per-row sources. The gate order with Ask Dapty and "Ask AI
anyway" (§5.4) is designed here but not built. For 4.x, only URL building is
done; the timestamp and environment matching are not replayed yet.

Source commits read (read only, never changed):

| Repository | Commit |
|---|---|
| aptyInc/apty-dap (5.x) | `3f3adba84862ac031d219881441fbd2a15746d71` |
| aptyInc/apty-assist (4.x) | `bbb4cbc518a9b1c84055d33ba56822aa7d58ca17` |
| Parthu-work/apty-super-hero (base) | `7d6e9ef674409e7b800e635cbbf1fb9f99089a1a` |

Every claim about Apty below cites `repo:path:line` at those commits.
5.x paths are under `apty-dap:packages/`, and 4.x paths are under
`apty-assist:player3.0/`. Anything this document could not confirm is
marked **NOT VERIFIED**.

## 1. The question

In Extension mode the Apty Client loads its files in its own service worker,
and Chrome does not show that traffic to any other extension. Today the Agent
can see those calls only if the Client reports them, which needs a Client
change.

The idea tested here: the Agent makes the same public GETs itself, for a
tenant, application and environment, and runs its checks on the answers.

## 2. Request catalogue

### 2.1 5.x (apty-dap)

**How the player sends requests**

- **Config.** In Extension mode the player reads a web-accessible
  `player-config.json` (`apps/player/src/config/config.ts:25-27`). In
  Injected mode it reads `window.__APTY_PLAYER_CONFIG__` (`config.ts:9-16`).
  Both give `contentURL` and `tenantId`. The schema is at
  `libs/shared/contracts/src/dap/asset-downloads/asset-downloads.schema.ts:64-74`.
- **Path.** `tenant-{t}[/app-{a}[/env-{e}]]/{file}`
  (`libs/shared/cdn-api/src/cdn-path.builder.ts:26-31`). Every request is
  `{contentURL}/{path}?timestamp={ts}`
  (`libs/shared/cdn-api/src/cdn-reader-api.ts:69,82,96,105,120,132`).
- **Client.** A plain `axios.create()`: no headers, no `withCredentials`,
  no Authorization header (`libs/shared/axios-client/src/axios-client.ts:34`).
- **Where the request runs.** In Extension mode, the background service
  worker makes it over IPC
  (`apps/player/src/background/messaging/background-script-ipc.service.ts:98-169`).
  In Injected mode, the page makes it
  (`apps/player/src/main-content-script/cdn/cdn-reader-api.service.ts:40,74-80`).
- **Unpublished files.** CloudFront answers a missing file with **HTTP 200**
  and a body of `{status: 404}`; MinIO answers with a real 404. The player
  treats both as `FILE_NOT_FOUND` and silently uses a fallback
  (`axios-client.ts:45-54,84-88`).

**Timestamp**

- `content-config.json` uses `Date.now()`
  (`apps/player/src/main-content-script/cdn/cdn.service.ts:147`).
- Every other file uses `getFileTimestamp`
  (`apps/player/src/main-content-script/cdn/file-timestamp.ts:4-27`). It walks
  `[app-{a}, env-{e}, file]` through content-config.json, keeping the nearest
  `latest`, and falls back to `Date.now()`.
- **The Agent reproduces this exactly** (`fileTimestamp` in
  `content-source.ts`). Since the timestamp is the CloudFront cache key
  (comment at `cdn-reader-api.ts:129-130`), the Agent asks for the same cached
  object the player asks for. Whether the server rejects other timestamps is
  **NOT VERIFIED**.

**Choosing the application and environment**

- The player takes the first application in file order that has a matching
  environment. Within it, environments are sorted by `order` and the first
  match wins
  (`libs/client/tool-items-schema/src/helpers/active-application.helpers.ts:20-45`).
- A pattern is matched as an unanchored wildcard: regex characters are
  escaped and `*` becomes `.*` (`:3-7`).
- Matching as a raw regular expression happens only when the feature flag
  is on, and the player never fetches flags
  (`cdn.service.ts:937-939`; `libs/shared/cdn-api/src/types/feature-flags.ts:25-39`).

**Files**

| File | Scope | Path after `{contentURL}/` | Purpose | Schema (5.x) | Replayable |
|---|---|---|---|---|---|
| content-config.json | tenant | `tenant-{t}/content-config.json?timestamp=now` | publish timestamps | `cdn-api/src/types/content-config.ts:34-57` | yes |
| app-urls.json | tenant | `tenant-{t}/app-urls.json` | apps, envs, URL patterns | `contracts/.../application.schema.ts:279-282` | yes |
| app-targets.json | tenant | `tenant-{t}/app-targets.json` | desktop only, not fetched by the player | `application.schema.ts:300-309` | n/a |
| app-data.json | application | `tenant-{t}/app-{a}/app-data.json` | widget config, user identification | `application.schema.ts:150-190` | yes |
| application-locales.json | application | `tenant-{t}/app-{a}/application-locales.json` | languages | `application-locale.schema.ts:17-30` | yes |
| users/{userId}.json | application | `tenant-{t}/app-{a}/users/{u}.json?timestamp=now` | favorites, progress | `user-preference.schema.ts:106-110` | needs userId |
| users/{u}/widget-chat/chat-list.json, {chatId}.json | application | `…/users/{u}/widget-chat/…` | stored Ask Dapty chats | `widget-chat-storage.service.ts:68-80,110,138` | needs userId and chatId |
| tooltip, workflow, launcher, announcement, validation, checklist, knowledge-content, segment, rule, tag, application-script, validation-disable-element, theme, baseline-journey, popup, labels, most-used-content `.json` | environment | `tenant-{t}/app-{a}/env-{e}/{file}` | content and audience | `application-environment-files.ts:172-206` | yes |
| workflow-{id}.json | environment | `…/env-{e}/workflow-{id}.json` | one workflow's steps | `application-environment-files.ts:210-214`; `cdn.service.ts:807-829` | yes, needs the id from workflow.json |
| locales/{code}.json | root | `locales/{code}.json?timestamp={playerVersion}` | UI strings | `application-environment-files.ts:270-276` | yes, not in the catalogue |
| themes/default-themes.json | root | `themes/default-themes.json` (no query) | default themes | `:279-283` | yes, not in the catalogue |

**Not replayable**

- **Writes.** User-preference and chat saves POST to `{storageURL}`
  (`libs/shared/storage-api/src/storage-api.ts:18-35`). Analytics POSTs to
  `{eventGatewayURL}/…/ingest` with an `X-API-Key`
  (`apps/player/src/main-content-script/analytics/analytics.service.ts:136-141`).
- **Ask Dapty.** `POST {aiBackendURL}/ai-service/api/v1/ai/{t}/widget/chat[/stream]`,
  a public guard with CORS checked per request
  (`apps/ai-service/src/api/ai-chat-widget/ai-chat-widget.controller.ts:13,49-50`).
  The Agent does not replay it.
- **Same-origin session calls.** The Workday `home.htmld` call and the
  Salesforce iframe
  (`user-tracking/workday-user-data.service.ts:84-94`; `salesforce-user-data.service.ts:22-47`).
- **Runtime state.**
  - The Apty user ID: a uuid in extension or iframe storage
    (`user-tracking.service.ts:153-162`; `local-storage.service.ts:84-112`).
  - Which segments are active (`segments.service.ts:38-55`).
  - Rule results, whether an element was found, `widgetRestricted`, and the
    chosen locale (`locale.service.ts:30-53`).

### 2.2 4.x (apty-assist)

**How the player sends requests**

- **Config.** In Extension mode the player reads `config.json` from its own
  extension (`src/shared/helpers/app.helper.ts:32-41`). In Injected mode it
  reads `localStorage['apty_config']`, filled from the `#letznav-script`
  attributes (`src/inject/config.ts:113-121`;
  `src/shared/helpers/injected.helpers.ts:344-375`).
- **URL.** `{contentUrl}/{path}` with an empty `token=` appended
  (`src/api/http.ts:231-247`; `src/shared/helpers/common-helpers.ts:90-95`).
  The Agent appends it too.
- **Where the request runs.** In Extension mode, the background makes it via
  `GetDataFromCDN`, sending the header `AptyCustomHeaderKey`
  (`src/background-scripts/send-request.ts:9-34`). In Injected mode, axios
  makes it with no custom header (`src/api/requests/send-request.ts:85-100`).
- **Unpublished files.** A `status: 404` payload means the fallback is used
  (`http.ts:278-284`). The body `{"message":"No data found","status":404}`
  appears in a code comment (`window.var.js:20`); the server side is
  **NOT VERIFIED**.

**Timestamp**

- `getFileTimeStamp(cc, file, app, env)`: `cc[app][env][file] || cc.latest || now`
  (`src/shared/content-config.helper.ts:5-29`). Unlike 5.x, it does not walk
  nested `latest` values.
- The tenant content-config uses `Date.now()`, or `config.contentConfig` when
  that is within 1 s (`src/main.bootstrap.ts:133-136`).
- `app-urls.json` uses an ISO date (`main.bootstrap.ts:276-285`).
- `most-used-content.json` uses local midnight (`src/api/backend.ts:373-377`).
- **The Agent does not reproduce the 4.x timestamp yet; it sends `now`**
  (partial).

**Choosing the application and environment**

- The player walks `app-urls.json` apps in order, and within each app the
  env keys sorted numerically. The first `url` that matches as a wildcard
  wins (`src/shared/helpers/injected.helpers.ts:24-49`;
  `src/shared/helpers/url-helpers.ts:81-105`).
- The env number is then confirmed from `app-data.json`, defaulting to 1
  (`app.helper.ts:89-99`).
- The Agent asks for the IDs on 4.x (partial).

**Files** (names from `src/shared/helpers/cdn-helpers.ts:5-36`; paths from `src/api/backend.ts:266-290`)

| Scope | Files | Path after `{contentUrl}/` |
|---|---|---|
| tenant | content-config.json, feature-flag.json, properties.json, app-urls.json, tenant-config.json | `tenant-{key}/{file}` (`backend.ts:266-268,292-300,460-467,615-622`) |
| application | content-config.json, app-data.json, segments.json, rules.json, langs.json, tags.json, keywords.json, styles.json, themes.json | `tenant-{key}/app-{a}/{file}` (`backend.ts:286-290`) |
| environment | tooltip, flow, launcher, validation, announcement, form, onboarding, knowledge-content, smart-canvas-templates, activities `.json`; segment-js.js, custom-js.js, custom-css.css | `tenant-{key}/app-{a}/env-{n}/{file}` (`backend.ts:274-284`) |
| flow steps | flow-{id}.json | environment (`flows.effects.ts:168`) |
| user | users/{userId}.json | application (`user-identification.effects.ts:422`) |
| root | system-config.json, config.json, langs.json, locales/{code}.json | `{file}` (`main.bootstrap.ts:200-222`; `i18n.effects.ts:40-77`) |

**Not replayable**

- **Writes.** User-preference saves POST to `{storageURL}`
  (`backend.ts:389-398`). The event gateway POSTs with a secret header
  (`event-gateway.helpers.ts:28-48`). Third-party analytics
  (`analytics.effects.ts:39-56`).
- **Legacy authenticated backend calls.** `/assist/api/...`, used only when
  `publishingSystem` is off (`backend.ts:52-240`).
- **The SSO check** (`sso.helpers.ts:120-128`).
- **Runtime state.**
  - The Apty user ID in `localStorage['apty-user-id']`
    (`aptyId.helper.ts:5-18`).
  - Segment results from segment-js (`segments.helpers.ts:23-53`).
  - Frame matching, element `checkState`, and rule `visibilityResult`.

## 3. Feasibility

### 3.1 Per request

| Request | Replayable | Extra input |
|---|---|---|
| 5.x tenant files (content-config, app-urls) | yes | contentURL, tenantId |
| 5.x app files (app-data, application-locales) | yes | applicationId (from app-urls.json and the page URL, or given) |
| 5.x environment files and workflow steps | yes | environmentId; for steps, the id from workflow.json |
| 5.x user preferences and stored chats | with extra input | userId (a page value per `userIdentificationConfig`, or the Apty ID only the Client holds); chatId from chat-list.json |
| 5.x locales and default themes | yes | the player version (locales only) |
| 4.x tenant, app and environment files | yes | app and env number (given in this slice) |
| 4.x users/{id}.json | with extra input | user id |
| 4.x segment-js.js, custom-js.js | readable, but they are code: never run by the Agent | |
| Every POST, Ask Dapty chat, analytics, storage, SSO, `/assist/api` | **no** | write, authenticated, or the Client's own conversation |
| Same-origin session calls (Workday, Salesforce) | **no** | the user's session |

### 3.2 Per check pack (`packages/browser-runtime/src/apty/diagnosis/`)

| Pack | Runnable from replayed files alone | Needs the page | Still needs the Client |
|---|---|---|---|
| content-not-visible (5.x) | data, environment, published, segments, segment-consistency, widget-audience, visibility-rule (its definition), language | the page URL for environment match when no IDs are given | membership (segment rule results), runtime rule results; marked `notChecked` |
| widget-not-visible (5.x) | environment, widget audience, restriction patterns | the page URL | whether the widget actually rendered; `widgetRestricted` as computed |
| element-not-found | the stored selectors (from files) | the element probe in every frame (`element-probe.ts`) | element timing as the player saw it |
| logs-and-errors | none (it is about what the Client experienced) | the page console | the Client's logs and its calls' outcomes |
| page-readiness | not relevant (DOM Health) | everything | none |
| dapty-conversation | the files suggestions point at (workflow, knowledge-content, rule) | page capture of the chat in Injected mode | the stored chat when the user is known only by the Apty ID |
| content-not-visible-4x, widget-not-visible-4x | the same file gates, with given IDs | the page URL | segment-js results, frames, `checkState` |

**Verdict.** Replay removes the need for the Client to report its calls for
every check that reads **published content**: the content and widget file
gates, the selector half of element-not-found, and the file half of the Ask
Dapty check. These are all proven here with no Client record (§6).

It does not replace the Client for **what the Client experienced**: its
logs, its calls' real outcomes on the user's network, the user's Apty ID,
segment and rule results, and what it actually rendered.

### 3.3 Risks of replaying instead of observing

| Risk | Handling |
|---|---|
| A later publish, or a stale CDN/client cache, means "published now" differs from what the Client loaded | The player's own timestamp key is reproduced, so the same CloudFront object is asked for. Results and the UI say "published file, fetched by the Agent" and "what is published now, not proof of what the Apty Client loaded" (`filesFromReplay`). Re-check asks again (`fresh`) |
| The user's network (proxy, VPN, CSP) blocks what the Agent's network allows | A successful replay never passes the logs-and-errors pack; the source label stops a replay row being read as the Client's outcome |
| Per-user files need the user ID, which in Extension mode may exist only in Client storage | `users/*` files need an explicit `userId`; `ids_missing` otherwise. The existing CDN source already reports `apty-id` for this case (`apty-cdn-source.ts`) |
| Load on Apty's CDN | Per-case in-memory cache, with `not_published` cached too; conditional requests (`If-None-Match`/`If-Modified-Since`, 304 reuses the copy); at most 20 open cases |
| A hostile page names an internal host as its content URL (SSRF from the Agent's service worker, which has `<all_urls>` and no CORS) | A page-named URL on a private or link-local IP is refused unless `aptyContentOrigins` lists it; only catalogue GET paths, no credentials or redirects. **Open decision**: loopback is still allowed (as in the existing `apty-cdn-source.ts` fallback, and for the E2E harness); and a host name that resolves to a private address is not caught |
| A prompt-injected page makes the model pin another tenant's IDs | The host never comes from the model (page config or policy only), and only public GETs are made. A pinned result says `idsFrom: given` and every row names its source. **Open decision**: require the SE's confirmation before pinning IDs that differ from the page's tenant |

## 4. Design (built)

- **Interface** (`@apty/agent-core`, `src/apty/content-source.ts`):
  - `AptyContentSource` with `resolveContext`, `listFiles` and `fetchFile`.
  - `AptyFetchFailure` names every failure: `not_published`, `http_<code>`,
    `network`, `timeout`, `schema_mismatch`, `host_not_allowed`,
    `ids_missing`, `body_denied`, `too_large`, `unparsable`, `unknown_file`.
- **Policy.** `aptyContentOrigins` in the organization policy
  (`org-policy.ts`, `managed-schema.json`) lists content hosts besides the
  page's own.
- **Implementation** (`@apty/browser-runtime`, `src/apty/replay/`):
  - `catalogue.ts`: the file catalogue for both versions and `filePath`. A
    file outside the catalogue, or an ID that is not a plain path segment, is
    never requested.
  - `schemas.ts`: minimal loose zod schemas written in the Agent.
  - `content-source.ts`: `createReplaySource`.
    - The host is the page's `contentURL` or a policy origin, and only bases
      a context was resolved for are fetched.
    - Requests are GET with `credentials: "omit"`, `redirect: "error"` and a
      10 s timeout.
    - The deny list is checked **before** any request; redaction goes through
      `readResourceBody`, the Client record's own path.
    - CloudFront's 200 not-found page is read as `not_published`.
    - Bodies are cached in memory per case.
  - `case-replay.ts`: one source per conversation, plus the pinned context.
    `replayResourceSource` hands replayed files to the existing loader, so the
    packs read them exactly like the Client's record. The cache is forgotten
    with the case's evidence (`clear_investigation_evidence`) and past 20 cases.
- **Gates.** `apty-files.ts` reads in this order:
  1. the Client's record;
  2. the page capture;
  3. **the replay for a pinned context**;
  4. the page-probed CDN (the existing fallback).

  The packs call the same functions; the model is never on this path.
  Replayed evidence carries the pinned context's version (`replayVersion`),
  so a pinned 4.x context is judged by the 4.x packs. Before this, any
  content-CDN evidence was assumed to be 5.x (`pack-kit.ts` `playerVersionOf`).
- **Tools** (`src/tools/apty-content.ts`, group `aptyContent`, read-only,
  behind the same privacy wrapper):
  - `resolve_apty_context`: pins IDs the SE gave for the case.
  - `list_apty_files`: the catalogue, with `inContentConfig`.
  - `fetch_apty_file`: a structural summary plus an `evidenceId` that
    `get_evidence_json` pages.
  - No tool takes a URL.
  - The tools are offered on the file route (budget raised from 8 to 11)
    when the message names Apty IDs or the content host. They are trimmed
    from the symptom route, where the gates replay without the model.
- **Rows name their source.** Every content-file gate carries
  `source: "client" | "capture" | "agent"`, and the card shows "(Client
  record)" or "(published file, fetched by the Agent)". `filesFromReplay`
  shows the "published now" caveat.
- **Shared fix.** The loader now reads a 200 not-found page as HTTP 404, for
  the Client's record too. Before, it was read as a published file.

## 5. Design (not built in this slice)

1. **Explicit-IDs-only mode.** The owner asked for requests only when tenant
   and environment IDs are given. The tools do this, but the gates still use
   the existing page-probe CDN fallback (Settings → Apty Integration). **Open
   decision**: a setting so that only pinned IDs trigger requests.
2. **4.x replay.** Reproduce `getFileTimeStamp` over the merged tenant and
   app content-config, match environments from `app-urls.json`
   (`injected.helpers.ts:24-49`), and probe the injected `apty_config`.
3. **Ask Dapty in parallel.** Start Ask Dapty's public `widget/chat/stream`
   in a dedicated KB tenant together with the gates. If it gives up (exact
   text at `apps/ai-service/src/api/ai-chat-widget/ai-chat-widget.service.ts:23-24`),
   run the Agent's card logic.
   - **Open decision**: the brief's "answered from the web (a `web_search`
     stream event)" cannot be detected. The stream has only `token`,
     `tool_start`, `tool_end`, `done`, `title` and `error`
     (`libs/shared/contracts/src/ai/ai-chat-widget/ai-chat-widget.schema.ts:37-44`).
     Web search runs provider-side (`apps/ai-service/src/llm/llm.service.ts:140-147`).
     Whether it ever surfaces as `tool_start` is **NOT VERIFIED**.
4. **Ask AI anyway.** Use the existing `kbMatches.askAiAnyway` button,
   answered with these tools and a quality check: no Apty claim without a
   card, check or code citation.
5. **Stored chats via replay.** Move `createCdnResourceSource`'s stored-chat
   path onto `fetchFile` with `users/{userId}/widget-chat/*`, leaving one
   request implementation.

## 6. Proof

- **Unit tests**, next to the code:
  - `catalogue.test.ts` builds every catalogue file for both versions and
    covers the refusals.
  - `content-source.test.ts` covers the timestamp algorithm, resolution,
    every named failure, the deny list before any request, redaction,
    schemas, the cache, 304s and the 4.x token.
  - `case-replay.test.ts` runs the real check packs on replayed synthetic
    files with no Client: hidden workflow (CNV-03), unpublished workflow
    (CNV-02), tooltip not published, tooltip found with `source: "agent"`.
  - `apty-content.test.ts` covers the tools.
  - Plus `loader.test.ts`, `org-policy.test.ts` and `tool-relevance.test.ts`.
- **E2E.** `tooling/e2e/replay-source.e2e.test.mjs` uses an Injected-mode
  page with no Client extension and a CloudFront-like local content host.
  The SE gives the IDs; the workflow check finds "Hide from widget" and the
  tooltip check finds the file not published. Each run makes no model
  request, every file row names the Agent's fetch, and every request is a
  credential-free GET with a numeric player timestamp.
- **Live smoke: not run.** No test tenant was given. It needs a tenant from
  the owner and the content host allowed by the environment's network
  policy. It should record status and shape only.

## 7. NOT VERIFIED

- Whether Apty's CDN accepts any `timestamp` value, or only the published one.
- The server side of the 404 bodies (5.x CloudFront `default_response.json`,
  4.x `window.var.js:20`).
- Whether 4.x `token=` is ever filled or checked at the edge, and whether a
  CDN checks `Referer` or `x-referer`.
- Whether provider-side web search ever appears in Ask Dapty's stream.
- That content-config.json lists every published file. `list_apty_files`
  therefore says `inContentConfig`, not "published".
