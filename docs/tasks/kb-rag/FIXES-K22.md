# KB-RAG K22: KB text leaves only to an approved destination

10 Nov 2026 · Apty Customer Success

**This is a complete, self-contained implementation prompt for a coding
agent.** Do every work package below, in order, until every acceptance check
passes. Do not stop at a plan, and do not skip a package. Where a step cannot
be done in your environment, do everything else, mark that step partial, and
say exactly what is left.

- **Base:** the PR #101 branch `claude/charming-knuth-g0d7ab` at `0ba7024`
  or later. Do not wait for PR #101 to merge or for the K21 fixes, and do not
  start from main: main lacks the KB code this prompt builds on (search_kb,
  the KB matches responder, per-version packs, the demo pack's `.invalid`
  marker). Create `claude/kb-rag-k22-security` from the PR #101 branch; one
  commit per work package, each green on its own; one PR, opened against
  `claude/charming-knuth-g0d7ab`, not main. When PR #101 merges and its
  branch is deleted, GitHub moves this PR onto main. Never commit to main or
  to the PR #101 branch.
  *As run:* the coding session was assigned the branch
  `claude/gracious-wright-kftn7o`, so the work is on that branch, created
  from `claude/charming-knuth-g0d7ab` at `ffbac8e` (which contains
  `0ba7024`).
- **Status:** see [Status](#status). Keep it current.
- Re-read this file after any context compaction; never guess scope.

**Running alongside K21.** The K21 fixes ([FIXES-K21.md](FIXES-K21.md)) may
be in progress on the PR #101 branch in another session. That is expected:
K21 changes search and ranking (`search.ts`, `text.ts`, `stem.ts`,
`synonyms.ts`, `index-set.ts`), `kb-store.ts` and the 4.x checks; this prompt
changes settings, `ai-provider.ts`, `outbound-filters.ts`,
`tool-relevance.ts`, `responder.ts`, `kb.ts` and the MCP bridge. Do not edit
K21's files except where a package below names them. Before the final
commit, fetch and merge the latest PR #101 branch into this branch, resolve
the documentation conflicts (kb-rag.md, decisions.md, DECISIONS.md,
docs/STATUS.md, CHANGELOG.md) by keeping both sides' entries, and re-run
every test and acceptance check on the merged result. If K21 is not on the
PR #101 branch yet, say so in the PR body; nothing here depends on it.

**The one rule this prompt enforces:** Apty knowledge-base text leaves the
browser only to a destination Apty has approved, and the extension enforces
that, not the SE. Every package below serves that rule.

## Why: the gap

The extension masks customer data and secrets well, but nothing controls
where Apty's own knowledge goes. From PRIVACY.md,
docs/security/DATA_FLOW.md and the code on PR #101 (`0ba7024`):

| # | Gap | Where | Effect |
| --- | --- | --- | --- |
| G1 | KB card text passes the masking unchanged | `applyResultPrivacy`, `createOutboundSanitizer` | Masking targets secrets and personal data; internal card wording goes out as it is |
| G2 | KB matches excerpts reach the model too, not only search_kb | `responder.ts` keeps them in the session; they go with the next model request | Any card shown in the chat is sent once an AI key is set |
| G3 | Any of 15 providers, any custom host, and user-defined custom models | `ai-provider.ts` (`createAIProvider`), `AppSettings.aiProvider`, `aiHost`, `customModels` | Card text can go to a personal account or a provider Apty never approved |
| G4 | Redaction can be set to Off by the SE | `AppSettings` redaction mode ("off") | Even secret and personal-data masking can be removed |
| G5 | No admin control exists | No `chrome.storage.managed` and no `managed_schema` in manifest.json | IT cannot enforce any of the above |
| G6 | The local MCP bridge receives tool results, including search_kb results | `apps/mcp-bridge`; DATA_FLOW "To an MCP client" | Card text can reach an MCP client (for example Claude Code), and from there its own provider |
| G7 | No record of what was sent | Request reports keep counts only | No answer to "which cards left, and to whom" |

The Summarize earlier turns request (`ConversationCompressor`) carries check
results, including KB matches excerpts, to the same provider, so it is
covered by the same fixes.

## Owner decisions to record

Record each in [decisions.md](decisions.md) (a section each, like D-KB1 to
D-KB9) and as a row in DECISIONS.md, in the first commit. They are accepted
with this prompt; if the owner has not confirmed one, say so in the PR body.

| Id | Decision |
| --- | --- |
| D-SEC1 | KB text never reaches a model by default. Card excerpts are shown in the panel only. KB text goes to a model only when a managed policy sets `kbToModel` to `"approved"` and the request goes to a destination that policy allows. The one exception is a demo pack (its `source.site` ends in `.invalid`), so developers can still test the full path. |
| D-SEC2 | Admin policy beats user settings. A value set in `chrome.storage.managed` cannot be changed in Options; the field shows "Set by your organization". With no policy, the extension behaves as today except for D-SEC1 and D-SEC3. |
| D-SEC3 | Redaction Off needs no policy to forbid it when a KB pack is loaded: while any non-demo pack is in IndexedDB, the effective redaction mode is never weaker than Standard. A policy can raise the floor to Strict. |
| D-SEC4 | Approved destination = provider, origin and model allow-lists. A policy names the allowed provider keys, the allowed base URL origins (https only, or loopback for a local model), and optionally the allowed model ids. A request outside the lists is not sent, and the panel says why. This covers customModels, the summary model and the connection test too. |
| D-SEC5 | The MCP bridge never receives KB text unless the policy allows it (`kbToMcp: true`). Without that, KB tool results reach the bridge as "KB result withheld by policy" plus card ids. |
| D-SEC6 | Every model request that carried KB text is recorded locally: time, provider, origin, model, and the card ids and layers sent (never text), kept for the policy's retention (default 30 days) and exportable. |
| D-SEC7 | An organization gateway is the preferred destination. The extension supports it as an OpenAI-compatible origin set by policy. A key pushed by policy is visible to the user in chrome://policy, so a gateway that authenticates without a long-lived shared key is preferred; building the gateway is outside this repository. |

## Hard rules

1. **Fail closed.** When the policy cannot be read, is malformed, or a check
   throws, KB text is not sent and the request outside the allow-lists is not
   made. Never fall back to "allowed".
2. **Enforce at the last step, not only in the UI.** Locked fields in Options
   are a convenience; the real checks run in the outbound filters and in
   `createAIProvider`, on every request, including the summary request and
   the connection test.
3. **Identify KB content by tag, never by matching text.** A search_kb result
   and a KB matches excerpt carry a source tag set where they are created;
   the filters act on the tag.
4. **No KB content in the repository.** Tests use demo or synthetic packs
   only. `npm run audit:kb-pack` stays green.
5. **No new permission and no new runtime dependency.** The manifest gains
   only `storage.managed_schema` (not a permission). agent-core stays
   platform-free: put pure policy logic (merging, allow-list checks) there,
   and Chrome calls in apps/browser-extension.
6. **Test first.** Every behaviour change starts with a test that fails on
   the base commit. Anything crossing the Chrome boundary also gets an E2E in
   `tooling/e2e/` using `harness.mjs`. Never skip, weaken or delete a test.
7. **The test-only policy seam never ships.** Any way to inject a policy for
   tests exists only in E2E builds; a test asserts the production `dist/`
   does not contain it.
8. New UI strings in both en.json and zh.json; new surfaces pass axe in light
   and dark and work by keyboard alone.
9. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies`, `npm run audit:architecture`,
   `npm run audit:tools`, `npm run audit:kb-pack`,
   `npm run report:request-size`, and the E2E files you touched. Paste the
   results into the PR body.

## Work packages

Order: S1, S2, S4, S3, S5, S6, S7, S8. S4 comes before S3 because "KB text
off by default" is the most important protection and must land even if the
allow-list work stalls.

### S1. Managed policy: schema and reader

Files: `apps/browser-extension/manifest.json`, new
`apps/browser-extension/managed-schema.json`, new
`packages/agent-core/src/config/org-policy.ts` (+ test), new
`apps/browser-extension/src/services/org-policy.ts` (+ test).

- Add `"storage": { "managed_schema": "managed-schema.json" }` to the
  manifest, and make sure the build copies the schema into `dist/`.
- The schema (JSON Schema, as Chrome expects) defines, all optional:

  | Key | Type | Meaning |
  | --- | --- | --- |
  | `kbToModel` | `"off"` or `"approved"` | Whether KB text may go to an allowed model destination (D-SEC1). Absent means `"off"` |
  | `kbToMcp` | boolean | Whether KB text may reach the MCP bridge (D-SEC5). Absent means false |
  | `allowedProviders` | string array | Provider keys (`AIProviderKey`) the SE may use |
  | `allowedOrigins` | string array | Base URL origins, for example `https://ai-gateway.apty.internal`; https only, or `http://localhost` and other loopback hosts for a local model |
  | `allowedModels` | string array | Model ids; absent means any model at an allowed origin |
  | `preset` | object: `aiProvider`, `aiHost`, `aiModel`, `aiToken`, `aiWorkspaceId` | Values written into the effective settings and locked |
  | `redactionFloor` | `"strict"` or `"standard"` | The weakest redaction the SE may choose |
  | `allowCustomModels` | boolean | Whether the SE may add BYOK custom models. Absent means false when any allow-list is set |
  | `allowMcpBridge` | boolean | Whether the MCP bridge may connect at all. Absent means true |
  | `auditRetentionDays` | integer 1 to 365 | How long the KB send record is kept (S7). Absent means 30 |

- `agent-core/config/org-policy.ts`: the `OrgPolicy` type,
  `parseOrgPolicy(raw): { ok: true; policy } | { ok: false; reason }`
  (strict: unknown keys and wrong types are errors), and the constants for
  the defaults above. No Chrome calls.
- `browser-extension/services/org-policy.ts`: `loadOrgPolicy()` reads
  `chrome.storage.managed.get(null)`; `watchOrgPolicy(callback)` uses
  `chrome.storage.onChanged` for area `managed`. It returns one of three
  states: none (empty storage), active (parsed), or invalid (with the
  reason). An invalid policy behaves as the most restrictive:
  `kbToModel: "off"`, `kbToMcp: false`, no model requests at all until fixed
  (hard rule 1), and Preflight names the reason.
- Tests: every key parses; an unknown key, a non-https origin, an origin with
  a path, and a wrong type are each invalid; an empty object is none;
  invalid maps to the restrictive policy.

### S2. Effective settings and locked fields

Files: new `packages/agent-core/src/config/effective-settings.ts` (+ test);
every reader of `STORAGE_KEYS.SETTINGS`; `packages/ui/src/components/settings/`
(the AI, Data handling and Knowledge base cards); i18n.

- `effectiveSettings(local: AppSettings, policy: PolicyState): { settings:
  AppSettings; locked: Set<keyof AppSettings> }`: apply `preset`, raise
  redaction to the floor (and to Standard while a non-demo pack is loaded,
  D-SEC3), drop `customModels` when not allowed, and record which fields are
  locked. Pure function, fully unit-tested.
- Add one browser helper, `loadEffectiveSettings()`, and route every
  settings reader through it. Known readers:
  `packages/ui/src/hooks/use-chat-config.ts`,
  `packages/ui/src/components/settings/index.tsx`,
  `apps/browser-extension/src/services/preflight-browser.ts`,
  `apps/browser-extension/src/entrypoints/sidepanel/index.tsx`,
  `apps/browser-extension/src/entrypoints/background/lifecycle.ts`,
  `apps/browser-extension/src/lib/logging.ts`,
  `apps/browser-extension/src/components/investigation/dapty-evidence-export.tsx`,
  `apps/browser-extension/src/hooks/outbound-filters.ts`
  (`currentRedactionMode`). Search for any other `STORAGE_KEYS.SETTINGS`
  read and include it. Writes still go to `chrome.storage.local`; a write to
  a locked field is ignored and logged.
- Options: a locked field is read-only with "Set by your organization" and no
  edit control. A policy in invalid state shows a banner with its reason.
- Tests: the merge for each key; a write to a locked field does not change
  the effective value; an audit test (like `audit:tools`) fails if any file
  outside the helper reads `STORAGE_KEYS.SETTINGS` directly. E2E: with a test
  policy that presets the provider and redaction, Options shows both locked
  and the side panel uses them.

### S4. KB text off by default, enforced in the outbound filters

Files: `packages/browser-runtime/src/tools/kb.ts`,
`packages/browser-runtime/src/apty/diagnosis/responder.ts`,
`packages/browser-runtime/src/tools/tool-relevance.ts`,
`apps/browser-extension/src/hooks/outbound-filters.ts`,
`packages/agent-core/src/conversation/compressor.ts`, the KB matches and
verdict card components, i18n (+ tests, E2E).

- Tag KB content where it is made. A search_kb result and the KB matches
  excerpt (and the verdict card's "From the KB card" text, if it enters the
  session) carry `source: "kb"` plus the card ids and layers, in the session
  record. Define the tag in one place.
- Decide once per request with a pure function
  `kbEgressAllowed(policy, destination, packs)`: true only when `kbToModel`
  is `"approved"` and the destination passes S3's allow-lists, or when every
  loaded pack is a demo pack (D-SEC1).
- When not allowed:
  - search_kb is not offered to the model (tool relevance), and its prompt
    section is left out.
  - A new outbound filter, first in `createOutboundFilters`, replaces every
    `source: "kb"` item's text with "KB card text withheld by organization
    policy. Cards shown to the user: <ids>." before the sanitizer runs. The
    model knows which cards the SE saw, never their text.
  - The same filter runs inside `ConversationCompressor`.
- In the panel: KB matches and verdict cards still show the excerpts
  (nothing leaves). A one-line note under them: "Shown here only; not sent to
  the AI model." When allowed, the note says which destination receives it.
- Tests: with no policy and a non-demo pack, a request after a KB matches
  answer and after a forced search_kb result holds no card text; with a demo
  pack the text goes; with `kbToModel: "approved"` and an allowed destination
  the text goes; with "approved" but a destination outside the lists,
  nothing is sent at all (S3); the summary request obeys the same rule. E2E:
  extend `kb-answer.e2e.test.mjs` and `kb-matches.e2e.test.mjs` with a
  non-demo synthetic pack (its `source.site` not `.invalid`) and assert on
  the request body the fake provider receives.

### S3. Allowed destinations only

Files: `apps/browser-extension/src/services/ai-provider.ts`
(`createAIProvider`, `validateHostUrl`, the connection test), the summary
model path, custom models, Preflight (+ tests, E2E).

- `destinationOf(settings)`: provider key, normalized origin (the provider's
  default origin when `aiHost` is empty), and model id. Pure, in agent-core.
- `destinationAllowed(policy, destination)`: provider in
  `allowedProviders`, origin in `allowedOrigins`, model in `allowedModels`
  when set. A list that is absent does not restrict.
- `createAIProvider` refuses to build a provider for a destination that is
  not allowed and returns a typed error. The chat shows: "This AI provider is
  not allowed by your organization. Allowed: <list>." No request is made. The
  same check guards the connection test, the summary model and each custom
  model.
- Origin matching is exact on scheme, host and port after normalization
  (lower-case host, default port removed, no path). A loopback origin is
  allowed only if listed.
- Preflight row "AI destination": allowed, not allowed (with the reason), or
  no policy.
- Tests: allowed and refused for each list;
  `https://ai.example.com.evil.test` does not match `https://ai.example.com`;
  an http non-loopback origin is refused; a custom model to an unlisted
  origin is refused; the summary request to an unlisted model is refused.
  E2E: a test policy allowing only the fake provider's origin; changing
  `aiHost` in local settings to another origin produces the refusal and no
  network request.

### S5. Redaction floor

Files: `packages/agent-core/src/config/effective-settings.ts`,
`apps/browser-extension/src/hooks/outbound-filters.ts`
(`currentRedactionMode`), the Data handling card, i18n (+ tests).

- The effective redaction mode is the stronger of: the SE's choice, the
  policy's `redactionFloor`, and Standard while any non-demo KB pack is
  loaded (D-SEC3). Order of strength: strict, standard, off.
- The Data handling card disables the options below the floor and says why
  ("Required by your organization" or "Required while an Apty KB pack is
  loaded").
- `currentRedactionMode` reads the effective mode, never the raw stored
  value.
- Tests: the floor for each combination; with a non-demo pack loaded and the
  stored mode "off", the sanitizer runs as Standard; removing the pack
  restores the SE's choice when no policy floor applies. E2E:
  `llm-outbound.e2e.test.mjs` gains a case with redaction stored as "off", a
  synthetic non-demo pack loaded, and an email in a tool result: the request
  holds no email.

### S6. MCP bridge

Files: `apps/mcp-bridge/` (where tool results are forwarded), the browser
side that sends results to the bridge, Options' MCP section, i18n (+ tests).

- With `allowMcpBridge: false`, the bridge cannot connect; Options shows the
  switch locked off.
- Unless `kbToMcp` is true, a `source: "kb"` result reaches the bridge as "KB
  result withheld by policy" plus card ids (the same filter as S4, applied on
  the bridge path).
- Tests: a search_kb result over the bridge carries no card text by default;
  with `kbToMcp: true` it does; with `allowMcpBridge: false` no connection is
  opened.

### S7. Record of KB text sent

Files: new `apps/browser-extension/src/services/kb-egress-log.ts` (+ test),
`outbound-filters.ts`, the Data handling card, i18n (+ tests, E2E).

- When a request leaves with KB text (allowed by S4), append one record: ISO
  time, provider key, origin, model, the card ids and layers sent, the pack
  versions and sha256 values, and whether it was the chat or the summary
  request. No text, no question, no answer.
- Store in the extension's IndexedDB (a new store, not `apty-kb-db`). Delete
  records older than `auditRetentionDays` (default 30) on each write and on
  start-up.
- Data handling card: "KB text sent to AI" with the count for the last 30
  days and Export (JSON) and Clear buttons. With a policy active, Clear is
  disabled.
- Tests: a record per request with KB text, none without; no record field
  holds card text or the question (assert on a synthetic chunk's unique
  word); retention deletes old records; Clear is disabled under a policy.
  E2E: two KB-bearing requests produce two records, and Export downloads
  them through the existing download path.

### S8. Documentation and Preflight

Files: PRIVACY.md, docs/security/DATA_FLOW.md,
docs/security/SECURITY_AUDIT.md, docs/security/PERMISSIONS.md,
docs/development/kb-rag.md, README.md, new docs/security/ORG_POLICY.md,
docs/STATUS.md, CHANGELOG.md, DECISIONS.md, Preflight.

- ORG_POLICY.md: every policy key with its type, default and effect; how to
  deploy it on Windows (registry, under
  `Software\Policies\Google\Chrome\3rdparty\extensions\<id>\policy` and the
  Edge equivalent), macOS (configuration profile) and Linux (JSON file); a
  recommended Apty policy (below); how to check it (chrome://policy,
  Preflight); and the warning that a key in `preset.aiToken` is visible to
  the user in chrome://policy.
- Recommended policy, as a starting point for Apty IT:

  ```json
  {
    "kbToModel": "approved",
    "kbToMcp": false,
    "allowedProviders": ["azure"],
    "allowedOrigins": ["https://<apty-tenant>.openai.azure.com"],
    "redactionFloor": "strict",
    "allowCustomModels": false,
    "allowMcpBridge": false,
    "auditRetentionDays": 30
  }
  ```

- PRIVACY.md and DATA_FLOW.md: KB text is withheld from the model unless the
  organization policy approves a destination; the withheld message; the
  redaction floor; the MCP rule; the send record. Correct the current
  statement that KB matches excerpts go with the next request (they now go
  only when allowed).
- Preflight: rows for "Organization policy" (none, active, invalid with the
  reason), "AI destination" (S3) and "KB text to AI" (withheld, allowed to
  <origin>, or demo only).

## Acceptance checks

All must hold; paste the evidence in the PR body.

1. No policy, non-demo pack loaded, AI key set: after a KB matches answer and
   after a search_kb call, the request body the fake provider receives
   contains no card text (assert on a unique word in a synthetic chunk) and
   does contain the withheld message with the card ids. Same for the summary
   request.
2. Demo pack only: card text is sent as today.
3. Policy `kbToModel: "approved"` with an allowed destination: card text is
   sent, and one send record exists per request, with ids and no text.
4. Destination outside the allow-lists (provider, origin or model; including
   a custom model, the summary model and the connection test): no network
   request is made and the chat explains why.
5. Invalid policy: no model request at all, KB text withheld, Preflight names
   the reason (fail closed).
6. Redaction: stored "off" with a non-demo pack loaded behaves as Standard; a
   policy floor of Strict cannot be lowered in Options or in storage.
7. MCP: KB text never reaches the bridge unless `kbToMcp` is true; with
   `allowMcpBridge: false` the bridge cannot connect.
8. Locked fields: every policy-set field is read-only in Options, and a
   direct write to `chrome.storage.local` does not change the effective
   value.
9. No settings reader bypasses `loadEffectiveSettings()` (the audit from S2
   passes).
10. The production `dist/` contains no test-policy seam (a test greps the
    built files for its key).
11. All existing unit and E2E tests still pass; `npm run preflight`,
    `npm run build`, `npm run lint:dependencies`,
    `npm run audit:architecture`, `npm run audit:tools`,
    `npm run audit:kb-pack` and `npm run report:request-size` are green.
12. A manual run with a real Chrome policy file ("How to test") shows the
    locked fields, the Preflight rows and the withheld message.
13. docs/security/ORG_POLICY.md exists and every command and file path in it
    was checked; PRIVACY.md and DATA_FLOW.md describe the new behaviour.

## How to test

### Unit and E2E

```bash
pnpm install --frozen-lockfile && pnpm build
pnpm --filter @apty/agent-core exec vitest run src/config src/kb src/conversation
pnpm --filter @apty/browser-runtime exec vitest run src/kb src/tools src/apty/diagnosis
pnpm --filter @apty/browser-extension exec vitest run src/services src/hooks
node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/kb-answer.e2e.test.mjs tooling/e2e/kb-matches.e2e.test.mjs tooling/e2e/llm-outbound.e2e.test.mjs tooling/e2e/knowledge-base.e2e.test.mjs
```

Plus the new E2E files this prompt adds (one per package that crosses the
Chrome boundary). The MCP bridge package is `apty-mcp-bridge`.

**Test policies in E2E.** Playwright cannot set Chrome's managed storage.
Add a seam that exists only in the E2E build (for example a build flag the
E2E harness already uses): when set, `loadOrgPolicy()` reads the policy from
a fixed `chrome.storage.local` key the test writes. Never in production (hard
rule 7).

**Non-demo synthetic pack.** For the "withheld" cases, build a synthetic pack
whose `source.site` is not `.invalid` (for example
`synthetic.atlassian.example`), from the same demo cards. It must still
contain only invented text.

### With a real Chrome policy (manual)

1. Load `apps/browser-extension/dist` unpacked and copy its ID from
   chrome://extensions.
2. Write a policy for that ID. Start with the recommended policy in S8,
   pointing `allowedOrigins` at a test endpoint.
   - Linux, Google Chrome: `/etc/opt/chrome/policies/managed/apty-agent.json`
     (Chromium: `/etc/chromium/policies/managed/`):

     ```json
     { "3rdparty": { "extensions": { "<extension-id>": { "kbToModel": "off", "redactionFloor": "strict", "allowedProviders": ["openai"], "allowedOrigins": ["https://api.openai.com"] } } } }
     ```

   - Windows, Chrome: values under
     `HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<extension-id>\policy`
     (lists as JSON strings or sub-keys, per Chrome's policy documentation).
     Edge: the same under
     `HKEY_LOCAL_MACHINE\Software\Policies\Microsoft\Edge\3rdparty\extensions\<extension-id>\policy`.
3. Open chrome://policy, click Reload policies, and check the extension's
   policy appears without errors.
4. In the extension: Options shows the locked fields; Preflight shows
   "Organization policy: active", the AI destination row and "KB text to AI:
   withheld".
5. Import a non-demo synthetic pack, ask a covered symptom with an AI key
   set, and confirm in the side panel's DevTools (Network) that the request
   body holds the withheld message, not card text.
6. Change the policy to `"kbToModel": "approved"`, reload policies, ask
   again: the card text is sent, and Data handling shows one record in "KB
   text sent to AI".
7. Point `aiHost` at another origin in Options (if not locked) and confirm
   the refusal and that no request is made.
8. Break the policy (add an unknown key), reload: Preflight shows "invalid"
   with the reason and no model request is made.

## Out of scope

- Building the organization gateway. Apty IT owns it; this prompt only makes
  the extension able to use one through `allowedOrigins` and `preset`
  (D-SEC7).
- Encrypting the KB pack, keys or conversation history at rest. A key stored
  next to the data adds little; a key from the SE's SSO login is a separate
  project.
- Pack signing and expiry, a per-card "never send" flag, the case record, the
  send-support bundle and the wrong-card feedback log. These come in a
  separate prompt.
- Locking screenshot sending, skills or network body capture by policy. Add
  them to the same schema later if IT asks; the policy reader from S1 makes
  that a small change.
- Distributing packs or installing the extension by policy. Both are IT
  deployment steps; docs/security/ORG_POLICY.md can link to them.

## Status

DONE, except acceptance check 12 (partial): the manual run with a real
Chrome policy file. In the coding container the bundled Chromium reads
`/etc/chromium/policies/managed/` (its other policies show in
chrome://policy) but does not deliver a 3rd party policy to an extension
loaded with `--load-extension`, so `chrome.storage.managed` stayed empty.
What is left: on a machine with Chrome, follow "With a real Chrome policy
(manual)" above with `apps/browser-extension/dist`. Every other check is
automated, through the E2E-only policy build.

Where the code differs from the file list above, and why:

- **S1:** the reader (`loadOrgPolicy`, `watchOrgPolicy`) is in
  `packages/browser-runtime/src/runtime/org-policy.ts`, because
  browser-runtime's own settings readers need it and cannot import the app.
  `apps/browser-extension/src/services/org-policy.ts` re-exports it and holds
  the E2E-only seam (`installOrgPolicySource`, called at the start of the
  service worker, the side panel and Options).
- **S2:** `loadEffectiveSettings()` is in
  `packages/browser-runtime/src/runtime/effective-settings.ts` for the same
  reason. `@apty/ui` reads the settings through the `KeyValueStorage` the
  extension injects (`settingsStorageAdapter`), which serves the effective
  settings and drops writes to locked fields; `npm run
  audit:settings-readers` (also a `test:scripts` test) fails on any other
  reader. The redaction floor's UI (S5) landed with the Data handling card
  in S2, since the S2 E2E asserts it.
- **S4:** the tag is `source: "kb"` plus `cards` (page id and layer) on
  every `KbToolResult` (`kbToolResult`, `localKbMatches`), defined in
  `packages/agent-core/src/kb/egress.ts`; the filter is
  `createKbEgressFilter` (`packages/browser-runtime/src/runtime/kb-egress.ts`),
  first in `createOutboundFilters` and marked `onSummarySource`, so
  `ConversationCompressor` runs it over a summary's source before the
  conversation becomes text. The verdict card's "From the KB card" excerpt
  never enters the session (it is read from the pack in the panel), so its
  note is the fixed "Shown here only" line. The E2E fixture packs now sit on
  `fixture.atlassian.invalid` (demo packs, so the earlier suites keep
  checking the full path) and the new withheld cases build theirs on
  `synthetic.atlassian.example`. The summary request's withholding is
  covered by unit tests (`compressor.test.ts`, `kb-egress.test.ts`), not an
  E2E.
- **S3:** `createAIProvider` checks the destination when it is built and
  for each model id it builds (the summary model, a custom model), and its
  `fetch` (`policyGuardedFetch`) checks every request against the policy as
  read at that moment: the URL's origin, the provider and the body's model.
  A refused chat model is replaced by one that fails every call with
  `ErrorCode.DESTINATION_REFUSED`, so local answers still work and the chat
  shows the refusal with the allowed list; a refused summary model makes the
  summary fail (the chat is kept whole, as for any summary failure). Fetch
  models sends the key nowhere the policy refuses, and lists
  `allowedModels` itself when the policy sets them. The agent is now also
  rebuilt when `aiHost` changes. The Preflight "AI destination" row lands
  with the other Preflight rows in S8.
- **S5:** the floor itself, the Data handling card's disabled modes and
  `currentRedactionMode` reading the effective mode landed with S2; S5 adds
  the proof. The E2E witness is a typed form value, not an email: Off masks
  an email by its shape too, so an email could not show the floor.
- **S6:** the policy is only known in the browser, so both rules are on the
  browser side of the bridge (`packages/browser-runtime/src/ws-bridge/ws-mcp-server.ts`),
  not in `apps/mcp-bridge`: `resultForMcp` withholds a tagged KB result's
  text unless `kbToMcp` is true, and `connect` opens no socket while
  `allowMcpBridge` is false (the service worker also disconnects when the
  policy turns it off). `search_kb` is not among the tools the bridge
  publishes today (`mcp-tool-names.ts`), so no KB result reaches an MCP
  client now; the filter covers any tool that returns tagged KB content
  later.
- **S7:** the record is one list in its own IndexedDB database,
  `apty-kb-egress-db`. It is written by the KB egress filter's `onSent`, so
  a request is recorded as it leaves; if the record cannot be written, the
  request goes without the KB text. `clear()` itself refuses under a policy,
  not only the disabled button. The record is not part of Settings' purge.
- **S8:** the three Preflight rows (organization policy, AI destination, KB
  text to AI) come first in Preflight; `runPreflight` treats a policy it
  cannot read as invalid.

| Package | Status |
| --- | --- |
| S1 Managed policy: schema and reader | Done |
| S2 Effective settings and locked fields | Done |
| S4 KB text off by default | Done |
| S3 Allowed destinations only | Done (Preflight row with S8) |
| S5 Redaction floor | Done |
| S6 MCP bridge | Done |
| S7 Record of KB text sent | Done |
| S8 Documentation and Preflight | Done |
