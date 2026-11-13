# KB-RAG K26: automatic pack delivery, more check packs, 4.x element checks, DOM Config gaps

13 Nov 2026 · Apty Customer Success

## How to run this prompt

This is a complete, self-contained implementation prompt for a coding agent.
Do every work package below, in order, until every acceptance check passes.
Do not stop at a plan, and do not skip a package. Where a step cannot be done
in your environment (no real pack, no Confluence token, no access to the Apty
player code), do everything else, mark that step partial, and say exactly what
is left and the command that finishes it.

- **Base:** `origin/main` once K25 (`claude/kb-rag-k25-all-fixes-3jn8kf`) and
  the K25 audit fixes (`claude/kb-rag-k25-audit-fixes`, commit `ebdd69e`,
  from `k25-audit-fixes.patch`) are merged. If they are not merged yet,
  branch from the K25 branch with the audit commit on top, and say so in
  every PR body. Never start from a `main` without K25: Part D builds on
  schema 3 signed packs and the policy keys K25 added.
- **Four parts, four branches, four PRs**, in this order, each green on its
  own and each opened against `main`:
  1. Part D, `claude/kb-rag-k26-delivery`: automatic pack delivery.
  2. Part E, `claude/kb-rag-k26-4x-elements`: 4.x ports of element-not-found
     and page-readiness.
  3. Part T, `claude/kb-rag-k26-item-checks`: tooltip, launcher and
     validation check packs.
  4. Part C, `claude/kb-rag-k26-dom-config`: DOM Config gaps.
- One commit per work package (D1, D2, …), each green on its own. Never
  commit to `main`, never push to someone else's branch, never weaken a test.
- **Status:** see [Status](#status). Keep it current in every commit.
- Re-read this file, [FIXES-K25.md](FIXES-K25.md) and
  [decisions.md](decisions.md) after any context compaction; never guess
  scope.
- Code you need to read, read-only: apty-dap at 5.x commit `4c406d5`
  (Part T), apty-assist `player3.0/` (Part E). If either is not checked out
  next to this repository, clone it read-only (`aptyInc/apty-dap`,
  `aptyInc/apty-assist`). If you cannot get it, stop that part, mark it
  partial, and do not invent a file shape.

Part D comes first: it removes the last manual step between a KB edit and
every SE's extension, and it needs no Apty product code.

## Why: what exists today and what this closes

K26 closes the last manual step in the knowledge loop and widens diagnosis to
the items SEs ask about after workflows. Read against the code on 13 Nov 2026
(K25 branch at `847916a` plus audit commit `ebdd69e`), two of these four areas
are further along than the plan assumed.

| Area | What exists | What is missing |
| --- | --- | --- |
| Pack delivery | `kb:pack` builds, signs (`--sign-key` or `KB_PACK_SIGNING_KEY`), diffs (`--diff`) and self-checks a pack. SEs import it by hand in Options. Packs expire (default 60 days). | No way for the extension to fetch packs itself. No scheduled build. An SE on an expired pack gets no answer until someone sends a new file. |
| 5.x tooltip, launcher, validation | element-not-found reads their stored elements and runs the active selector in every frame. content-not-visible routes all item kinds, but its gates and card (JA 1496842241) are about the widget list. | Nothing checks why an on-page item does not appear: its trigger, page scope, display settings, or a validation rule's own conditions. Verdicts for these kinds cite the workflow widget-list card. |
| 4.x element checks | element-not-found and page-readiness exist for 5.x. Both stop at the 4.x gate (`element-not-found.ts:859`), as K14 and K21 planned. | No 4.x port. The 4.x step fixture (`flow-18515.json`) holds only ids and titles, so the 4.x stored-element shape is not yet known in this repo. |
| DOM Config | Built: crawl, rule generation, Partial Selector conditions, ignore DOM events, settings (ignore conditions, attribute priority, debounce), run diffs, Apty export, side panel page, runbook. | Results are in memory only (D12). A deep crawl does not wait for navigation after a nav click. Three open questions Apty's source does not answer. Never run on a real tenant. |

Two hard dependencies:

- **Check packs need cards.** The rule is that cards are the single source
  for check packs, and there are no mirror cards for `tooltip.json`,
  `launcher.json` or `validation.json` (End Goal §7). Part T therefore writes
  draft four-layer cards from the code, for the KB owner to publish, and its
  findings stay at "likely" with NOT VERIFIED carried through until those
  cards exist.
- **4.x and 5.x shapes come from code.** Part E reads apty-assist
  `player3.0/`; Part T reads apty-dap at `4c406d5`. No shape is guessed.

## Owner decisions this prompt proposes

Each decision below is the default the code implements; record each in
`docs/tasks/kb-rag/decisions.md` and `DECISIONS.md` as Proposed with the
date, so the owner can confirm or change it before the pilot.

| Id | Decision (default) | Alternative the owner may choose |
| --- | --- | --- |
| D-DEL1 | A managed policy names where each version's pack comes from: `kbPackSources`, an object of `"4.x"`, `"5.x"`, `"common"` to an `https://` URL. No policy source means manual import only, as today. | A single index URL listing all packs. |
| D-DEL2 | The extension fetches with `credentials: "include"`, so a host behind Apty SSO works with the SE's own session. No token is ever stored in the extension or the policy. | A per-device token in the policy (rejected by default: it would sit in every machine's policy store). |
| D-DEL3 | Scheduled builds sign with a separate CI key, held as a GitHub Actions secret and trusted only through the policy's `trustedPackKeys`, never built in. The KB owner's key stays on the KB owner's machine. Either key can be revoked with `revokedPackKeyIds`. | CI builds unsigned candidates and the KB owner signs and uploads them by hand. |
| D-DEL4 | Packs are hosted on an internal HTTPS host behind Apty SSO that IT chooses; the job uploads with an HTTP PUT and a bearer token secret. Never a public URL. The workflow keeps its own artifacts 7 days. | A private object store with signed URLs. |
| D-DEL5 | When the policy names a source for a version, that version's pack is policy-managed: Options shows it read-only and manual import for that version is off, unless the policy sets `allowManualPackImport: true`. | Manual import always allowed. |
| D-DEL6 | Never downgrade: a fetched pack replaces the stored one only if it parses, is trusted, is current and its `builtAt` is newer. Any failure keeps the stored pack and records why. | None proposed. |
| D-DEL7 | Check on browser start, every 6 hours (`kbPackCheckHours`, 1 to 168) and on Check now. Conditional requests (`If-None-Match`, `If-Modified-Since`) keep repeat checks cheap. | Daily only. |
| D-DEL8 | CI publishes a pack only if: the build succeeds, the customer-name check passes, the self-check passes, the card count has not dropped more than 10% from the last published pack, and, where a question set for that version is in the repo, the quality gate passes. A failing gate publishes nothing and fails the run. A manual run may override only the card-count rule, with a reason recorded in the job summary. | Publish on build success alone. |
| D-CHK1 | Tooltips, launchers and validations get their own pack, `item-not-showing`, for "it does not appear on the page". content-not-visible stays for the widget list, and stops citing the workflow widget-list card for these kinds. | Extend content-not-visible per kind. |
| D-CHK2 | A rule with no published card cites a draft card (`draft:<slug>`); its finding is capped at possible, shows "No KB card yet" and NOT VERIFIED. When the KB owner publishes the card and its id goes into the card map, the cap lifts to likely. | Ship no rule until its card is published. |
| D-CHK3 | 4.x element and readiness rules follow the 4.x player in apty-assist `player3.0/`, cite A4PKH cards, and keep the 5.x rules untouched. | None proposed. |
| D-DOM1 | A DOM Config capture may be kept on the device (IndexedDB, redacted as today, 30 days by default, `domConfigRetentionDays` 1 to 365) so an SE can close the panel and come back. This changes D12 (memory only). | Keep D12. |

## Hard rules

These hold in every package; break one and the package is not done.

- Follow CLAUDE.md: branch from the base above, never push to `main`, never
  weaken or skip a test, never fabricate, and label unfinished work
  "partial".
- Never invent an Apty file shape, field, setting or behaviour. Every field a
  check reads is cited in a code comment to the apty-dap or apty-assist file
  and line it comes from. A shape you cannot find in code is a partial step,
  not a guess.
- A finding is never more certain than its source: likely at most for rules
  from code, possible for rules whose card is a draft (D-CHK2), and NOT
  VERIFIED carried into every verdict.
- Checks only read. No check pack writes to the page, Studio, Admin or the
  Client. No new tool on the high-risk list.
- Nothing leaves the browser unapproved. The pack fetcher is the only new
  network call in the extension; it reaches only the policy's
  `kbPackSources` URLs, sends no page data, and is recorded in the egress
  record. A test asserts no other request is added.
- No KB text, customer data or secret in the repository, a log, a CI job
  summary, a test fixture or an artifact kept over 7 days. Job summaries show
  counts, ids and codes only. `audit:kb-pack` must stay green.
- Every new fixture is synthetic, marked FIXTURE, in the shapes the code
  shows, with no customer name, URL, id or person.
- Every user-facing string goes through i18n (`en.json` and `zh.json`), and
  `audit:i18n` stays at or below its baseline; the same for `audit:any`.
- Docs move with the code: every package updates `docs/STATUS.md`,
  `CHANGELOG.md`, the decisions files and the guide it touches, in the same
  commit.

## Part D: automatic pack delivery

After Part D, a KB edit reaches every managed SE's extension within a day
with no file passed by hand: CI builds, gates, signs and uploads the packs
nightly, and each extension fetches, verifies and stores them on its own.
Branch `claude/kb-rag-k26-delivery`.

### D1. Policy keys

In `packages/agent-core/src/config/org-policy.ts`,
`apps/browser-extension/managed-schema.json` and
`docs/security/ORG_POLICY.md`, add:

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `kbPackSources` | object: `"4.x"`, `"5.x"`, `"common"` to a URL | none | `https://` only, no credentials or fragment in the URL, at most 2,048 characters; any other key or scheme makes the policy invalid. |
| `kbPackCheckHours` | integer, 1 to 168 | 6 | How often the extension checks each source. |
| `allowManualPackImport` | boolean | false | Whether an SE may import a pack by hand for a version the policy sources. Versions with no source are always importable. |

Parser tests: a valid object, each refusal (bad version key, `http:`, a URL
with `user:pass@`, a fragment, too long, a non-string), and the default
values.

### D2. The fetcher

Add `packages/browser-runtime/src/kb/kb-pack-sync.ts` with
`createKbPackSync({ store, policy, fetch, now, record })` and one method,
`syncAll({ reason })`, that for each version with a source:

1. Sends GET with `credentials: "include"`, `cache: "no-cache"`, the stored
   ETag as `If-None-Match` and Last-Modified as `If-Modified-Since`, and a
   60-second timeout.
2. On 304, records "unchanged" and stops.
3. Refuses a response over 25 MB (the pack limit) by `Content-Length` and by
   streamed byte count, and a body that is not `application/json` or
   `text/plain`.
4. Passes the text to the existing `store.replace(text)` path, so parsing,
   the checksum, the signature, trust and expiry are checked exactly as for a
   manual import. A pack for another version than the source names is
   refused (`version_mismatch`).
5. Applies D-DEL6: not newer by `builtAt` gives "unchanged" (same sha256) or
   "older" (refused); every refusal keeps the stored pack.
6. Saves per version, in the KB database's records store under
   `sync:<version>`: last check time, last success time, ETag,
   Last-Modified, outcome code, HTTP status, and the stored pack's sha256.
   Never the body, the URL's query or a cookie.
7. Writes one row to the send record per request: time, version, origin,
   status, outcome code. No path, no body.

One sync at a time (a lock in the background), and a version whose last
attempt failed waits with backoff: 5 minutes, then doubling, capped at
`kbPackCheckHours`.

Outcome codes, each with an i18n message: `updated`, `unchanged`, `older`,
`not_modified`, `http_<status>`, `network`, `timeout`, `too_large`,
`wrong_type`, `version_mismatch`, plus every existing import refusal
(`checksum_mismatch`, `bad_signature`, `untrusted`, `revoked`, `expired`,
`not_yet_valid`, `unsigned`, …).

### D3. When it runs

In the background entrypoint
(`apps/browser-extension/src/entrypoints/background/`), using the `alarms`
permission the manifest already holds:

- On `runtime.onStartup` and `onInstalled`, run
  `syncAll({ reason: "startup" })` after a 30-second delay.
- Create the alarm `kb-pack-sync` at `kbPackCheckHours`; recreate it when the
  policy changes (`storage.managed.onChanged`).
- Check now in Options and in Preflight sends a message that runs
  `syncAll({ reason: "manual" })` and returns the outcomes.
- No policy source: no alarm, no request. A test asserts it.

### D4. What the SE sees

- Options → Knowledge base: a policy-sourced version's row says "Delivered by
  your organization" with the origin (host only), last check, last update and
  the latest outcome's message; Import pack…, Replace and Remove are hidden
  for it unless `allowManualPackImport` is true (D-DEL5). A Check now button
  sits under the rows.
- Preflight: one check, "KB packs up to date": green when every sourced
  version is current and its last check succeeded in the last
  2 × `kbPackCheckHours`; amber when a pack is expiring or the last check
  failed while the stored pack still works; red when a sourced version has no
  usable pack. Each state names the version and the reason.
- The chat's KB decision line (K25 A2) adds the reason when no pack is usable
  for a sourced version: for example "The 5.x pack expired on 2027-01-12 and
  the last update failed (HTTP 403: sign in to the pack host)."

### D5. The scheduled build job

Add `.github/workflows/kb-packs.yml`:

- Triggers: schedule daily at 01:30 UTC (07:00 IST), and `workflow_dispatch`
  with inputs `versions` (default `4.x,5.x`), `override_card_drop`
  (boolean) and `reason` (text, required when overriding).
- Permissions: `contents: read` only. Pin every action to a full commit SHA,
  as `ci.yml` does.
- Secrets: `CONFLUENCE_EMAIL`, `CONFLUENCE_TOKEN`, `KB_CI_SIGNING_KEY`
  (PKCS#8 PEM), `KB_PUBLISH_TOKEN`, and the variables `KB_PUBLISH_URL_4X`,
  `KB_PUBLISH_URL_5X`, `KB_CUSTOMER_NAMES_URL` (optional). A missing secret
  fails the run with its name, never its value.
- Steps per version: install with the lockfile; download the last published
  pack from its publish URL for `--diff` (a 404 is fine on the first run);
  run `kb:pack` with the space and root from the table below, `--sign-key`
  from the secret (written to a 0600 temp file, deleted in an `always()`
  step), `--customer-names` when given and `--diff`; run
  `kb:eval --self-check`; run `kb:eval` with the version's question file if
  `tooling/scripts/kb/questions/<version>.json` exists; apply D-DEL8; upload
  with PUT and `Authorization: Bearer`; then GET the URL back and compare its
  sha256.
- Job summary: per version, card counts by status, cards added, removed and
  changed (ids only), self-check and gate numbers, the published sha256 and
  key id, and `expiresAt`. No titles, no card text.
- Artifacts: the built packs, `retention-days: 7`, only when a gate failed,
  so the KB owner can inspect them.

| Version | Space | Root | Notes |
| --- | --- | --- | --- |
| 4.x | A4PKH | 1509720081 | Version is implied by the space. |
| 5.x | JA | 1496711169 | Needs `--version 5.x`. |

Move the space and root into `tooling/scripts/kb/sources.json`, read by the
workflow and the docs, so they live in one place.

### D6. Key and hosting setup (a runbook, not code)

Write `docs/release/KB_PACK_DELIVERY.md` for IT and the KB owner, step by
step:

1. Generate the CI key with `pnpm kb:keygen --out <dir>`; put the private key
   in the `KB_CI_SIGNING_KEY` secret; add the public key to the policy's
   `trustedPackKeys` with the name "Apty KB CI".
2. Choose the pack host (D-DEL4); create the two publish URLs and a token
   that may only PUT there; set the secrets.
3. Add `kbPackSources` to the managed policy, push it, and check one SE's
   Preflight goes green.
4. Run the workflow by hand once, and read its summary.
5. To revoke the CI key: add its id to `revokedPackKeyIds`, generate a new
   key, update the secret and `trustedPackKeys`.

### D7. Tests

- Unit: every outcome code in D2, with a fake fetch and clock; the 304 path;
  backoff timing; the lock; D-DEL5 hiding; and that a fetched pack refused
  for trust or expiry leaves the stored pack loaded.
- E2E (Chromium): a local HTTPS-less test server is not allowed by D1, so the
  E2E policy build accepts `http://127.0.0.1` sources only behind the
  existing E2E policy seam (`check:dist-policy` must still show no seam in
  the release build). Cover: first fetch loads a test-key pack; a newer pack
  replaces it; an older pack is refused with the stored one kept; a 403 shows
  the reason in Options, Preflight and the decision line; removing the source
  stops the alarm.
- Workflow: actionlint passes; a dry-run mode (`KB_PUBLISH_DRY_RUN=1`) skips
  the upload so the job can be exercised on a fork with the demo pack builder
  in place of Confluence.

## Part T: tooltip, launcher and validation check packs

After Part T, "my tooltip is not showing", "the launcher does not appear" and
"the validation never fires" each get a deterministic check that stops at the
first confirmed cause, instead of the workflow widget-list checks. Branch
`claude/kb-rag-k26-item-checks`. 5.x only; 4.x items are out of scope.

### T0. Read the player first (findings file, no code)

In apty-dap at `4c406d5`, find how the 5.x player decides to show each of the
three kinds, and write `docs/development/item-display-rules.md`: one table
per kind, a row per condition, each with the file and line, the content file
and field it reads, and whether the Agent can see it (in a content file, in
the page, or nowhere). Look at least for:

- publication in the environment and the item's own on/off or disabled
  state;
- segments and the visibility rule (`segmentIds`, `visibilityRuleId`,
  `visibilityRuleAction`, already in the fixture);
- page or URL scope, and process or tag scope (`processIds`, `tagIds`);
- the stored element and how the player resolves it (shared with
  element-not-found);
- the trigger (hover, click, page load, focus, blur, submit) and any delay;
- per-user state that hides an item after it was seen or dismissed, and where
  it is stored;
- for validations: the field rule, when it is evaluated, and what stops it
  (for example a disabled element, which the fixture already has);
- for launchers: placement and anything that hides the launcher icon.

Any condition the Agent cannot see becomes a line in the verdict's "not
checked here" list, never a guess.

### T1. Draft cards for the KB owner

Write drafts under `docs/kb-drafts/`, in the card format the cards use:
symptom title, four layers of 600 to 750 characters each and under 3,000 in
total, a Send-support list, and the line "Verified on: 5.x code at 4c406d5,
not runtime-verified":

- symptom cards: "Tooltip does not appear", "Launcher does not appear",
  "Validation does not fire";
- mirror cards: `tooltip.json`, `launcher.json`, `validation.json`, in the
  same shape as the five existing mirror cards.

Where a published card already covers a rule (search the 5.x pack and JA for
tooltip, launcher and validation cards), cite it and write no draft. List
every draft and every reused card in `docs/kb-drafts/README.md` with what the
KB owner must do.

### T2. The card map

Add `packages/browser-runtime/src/apty/diagnosis/cards-items.ts`, like
`cards-4x.ts`: one entry per rule, the published card's page id or
`draft:<slug>`. A helper caps a finding to possible and adds "No KB card
yet" while its card is a draft (D-CHK2). When the KB owner publishes a draft,
the only change needed is the id in this map; a test lists every `draft:`
entry so it shows in CI output.

### T3. The pack

Add `item-not-showing.ts` (and `.test.ts`) using `pack-kit.ts`. Gates in this
order, each from T0 only, stopping at the first confirmed cause:

1. The content file for the kind loaded, with the existing `FILE_PROBLEMS`
   handling ("no data" is not "no problem").
2. The item is found by name in the user's language; two matches ask which
   one (rule P4), none says so.
3. Published to this environment.
4. The item's own on/off or disabled state.
5. Segments and the visibility rule. Move these gates out of
   `content-not-visible.ts` into a shared module first, in a commit of its
   own that changes no behaviour and keeps every existing test green.
6. Page, URL, process or tag scope against the user's tab.
7. The element: call the resolver element-not-found uses, and report its
   outcome as this pack's finding (counts only, never the selector or page
   text).
8. Kind-specific conditions from T0 (trigger, launcher placement, validation
   rule) that a content file shows.

End with "not checked here": every T0 condition the Agent cannot see, such as
a per-user dismissed state.

Rule ids INS-00 onward. Every finding cites its rule id, its card (T2), and
the redacted evidence line, and carries NOT VERIFIED.

### T4. Routing

In `router.ts`: a tooltip, launcher or validation that does not appear, show,
display, pop up or fire routes to item-not-showing; the same kinds "not in
the widget" or "not in the list" stay with content-not-visible, which then
cites a card for that kind or a draft (D-CHK1), never JA 1496842241. Add
router tests for both, in English and Chinese, plus the near-misses already
in `router.test.ts`.

### T5. Fixtures and tests

Extend `fixtures/content-5x/` with synthetic items for every rule: one that
shows, and one per cause. Each rule gets a positive and a negative test.
Rules capped by a draft card are asserted at possible. The demo pack gains
one card per new symptom (synthetic, `.invalid` site) so the full flow can be
tried without the real KB.

## Part E: 4.x ports of element-not-found and page-readiness

After Part E, a 4.x tenant gets the same "Apty cannot find the element" and
"Apty cannot select elements on this page" diagnosis as 5.x, instead of the
version gate's "nothing was concluded". Branch
`claude/kb-rag-k26-4x-elements`. The 5.x packs and their tests do not change.

### E0. Read the 4.x player first (findings file, no code)

In apty-assist `player3.0/`, write `docs/development/4x-element-rules.md`
with file and line for each of:

- where a step's stored element lives (which content file, for example
  `flow-<id>.json`, and which fields), and its selector kinds (CSS, XPath,
  text, custom script, any others);
- how the player resolves it: order of attempts, frames, shadow roots, the
  wait and retry timing, and what it does when several elements match;
- what the player treats as a page not ready to select on, if anything
  differs from what DOM Health measures;
- which content files the 4.x Extension-mode player fetches through its
  background, so the evidence path (K15: page capture, service-worker HAR) is
  known for each.

### E1. The 4.x element model

Extend the 4.x fixtures (`fixtures/content-4x/`) with synthetic steps
carrying stored elements in the E0 shape: a picker element, a CSS and an
XPath selector, a dynamic id, a disabled element, an element in an iframe,
and one of each selector kind the 5.x pack treats as "not checked here"
(jQuery or custom script). Add an adapter that reads a 4.x step's element
into the target type element-probe already runs, and fails with a named
reason on any field it does not know.

### E2. element-not-found-4x.ts

Mirror `content-not-visible-4x.ts`: `element-not-found.ts` calls it where it
now stops at the 4.x gate (line 859), and the 4.x module owns every 4.x rule.
Rule ids E4X-00 onward. Resolve the selector in every frame the way
player3.0 does (E0), reusing element-probe where the behaviour matches and
writing the difference down in a comment where it does not. Report counts
only, never the selector or the page's text. A selector kind the 4.x player
runs as code is "not checked here", as in 5.x.

### E3. Page readiness for 4.x

Let `page-readiness.ts` run for 4.x only where E0 shows the 4.x player is
affected by the same DOM Health risk; every other risk stays out with a line
in "not checked here". Rule ids R4X-00 onward.

### E4. Cards

Extend `cards-4x.ts` with an entry per E4X and R4X rule. Find the A4PKH cards
on elements, selectors and page readiness in the 4.x pack (titles and Symptom
lines). Where none fits, write a draft under `docs/kb-drafts/4x/` and cite
`draft:<slug>`, capped at possible (D-CHK2). Keep the rule that a 4.x verdict
cites a card, never the tree's root or a routing page.

### E5. Tests

Each E4X and R4X rule gets a positive and a negative test on the E1
fixtures. Add a test that the 4.x gate no longer stops these two packs on a
4.x tenant, and that a 5.x tenant still gets exactly today's findings
(snapshot the 5.x outcomes before the change).

## Part C: DOM Config gaps

DOM Config already does what the End Goal's horizon named; Part C closes its
four recorded gaps and ties it into cases. Branch
`claude/kb-rag-k26-dom-config`. The source of truth is
`docs/development/dom-config.md`, sections "Known limits" and "Open
questions".

### C1. Keep a capture across restarts (D-DOM1)

Store the held `ApplicationCapture` in IndexedDB (a new database name in
`storage/database-names.ts`), written only after the capture's existing
redaction and identifier checks, deleted after `domConfigRetentionDays`
(policy key, 1 to 365, default 30) and by a Discard capture button. On panel
open, offer to resume it. Update D12 in the DOM Config decision record to say
what changed and why.

### C2. Deep crawl waits for navigation

After a click on a `<nav>` anchor in deep mode, wait for the navigation to
commit and the page to settle (the same settle rule the crawl uses for a
fresh visit) before the fingerprint, or skip nav anchors in deep mode if E2E
shows the wait cannot be made reliable. Either way, remove the `[state-N]`
duplicates and the state-mismatch revisits that "Known limits" describes, and
add an E2E on the existing application shapes that shows none appear.

### C3. The three open questions

For the max z-index ceiling, the unconfirmed noise entries and persistence
across restarts, look in apty-dap at `4c406d5` again. Answer each with file
and line, or record it as still open with what was searched. Do not set a
value without a source.

### C4. DOM Config in a case

When DOM Config runs while a case is open (K25 L1), add to the case record:
run id, pages, rule and warning counts, and the export's sha256. In the
support bundle (K25 L2), add a `domConfig` block with the same counts and,
only when the SE ticks it in the review dialog, the exported settings file.
No page text and no selectors are added that the export does not already
hold.

### C5. Real-tenant run

This is a manual step for the SE pilot, not code: run
`docs/development/dom-config-runbook.md` on one real 5.x tenant and record
the outcome in `docs/development/real-tenant-validation.md`. Mark it partial
in the Status until it is done.

## Acceptance checks

A part is done when every check for it passes, plus the common ones; anything
that needs people or real data is marked partial with its command.

Common to every PR: `npm run preflight` (format, lint with no new warnings,
typecheck, tests, coverage), `npm run build`, every `audit:*` script,
`npm run test:e2e` in CI, and `audit:kb-pack` showing no pack in the tree.

**Part D**

- [ ] The policy parser accepts and refuses exactly the cases in D1; the
  managed schema and ORG_POLICY.md list the three keys.
- [ ] With a source set, a newer signed pack is fetched and used without a
  reload; an older, tampered, untrusted or expired one is refused and the
  stored pack keeps answering.
- [ ] A 304, a 403, a timeout and an oversize body each give their own
  outcome code, shown in Options, Preflight and the decision line.
- [ ] With no source set, the extension makes no new request and creates no
  alarm (a test asserts both).
- [ ] Manual import is hidden for a sourced version unless
  `allowManualPackImport` is true.
- [ ] `kb-packs.yml` passes actionlint, runs in dry-run mode on a fork with
  demo packs, and its summary holds no card title or text.
- [ ] A gate failure (self-check, customer name, card drop over 10%, quality
  gate) publishes nothing and fails the run.
- [ ] KB_PACK_DELIVERY.md exists; the first real scheduled run is partial
  until IT sets the host and secrets.

**Part T**

- [ ] item-display-rules.md cites a file and line for every condition, or
  says the condition was not found.
- [ ] Every INS rule has a positive and a negative test and cites a card or a
  draft; draft-backed rules are capped at possible.
- [ ] "The tooltip is not showing" routes to item-not-showing; "the tooltip
  is not in the widget list" routes to content-not-visible, which no longer
  cites JA 1496842241 for these kinds.
- [ ] The move of shared gates changed no content-not-visible outcome (its
  tests pass unchanged).
- [ ] The draft cards exist and `docs/kb-drafts/README.md` lists them for the
  KB owner.

**Part E**

- [ ] 4x-element-rules.md cites file and line in player3.0 for the element
  shape, resolution and evidence path.
- [ ] On a 4.x fixture tenant, both packs return findings with E4X or R4X
  rule ids instead of stopping at the version gate.
- [ ] 5.x outcomes match the snapshot taken before the change.

**Part C**

- [ ] A held capture survives a browser restart, is deleted after its
  retention or on Discard capture, and holds nothing the in-memory capture
  did not.
- [ ] A deep crawl of the E2E shapes shows no `[state-N]` duplicates or
  state-mismatch revisits from nav clicks.
- [ ] Each of the three open questions is answered with a source or recorded
  as still open.
- [ ] A support bundle prepared during a DOM Config run carries the
  `domConfig` counts, and the settings file only when ticked.
- [ ] The real-tenant run is partial until done.

## How to test

Run the automated checks in each PR, then these by hand once per part; add
each to `docs/release/SMOKE_TEST.md` as new rows.

**Part D, with no real host.** Build the demo packs, serve them locally, and
point the E2E policy build at them:

```bash
pnpm kb:demo-pack && pnpm kb:demo-pack --version 4.x
```

```bash
npx http-server ~/apty-kb -p 8787
```

Load the E2E policy build, set `kbPackSources` to
`http://127.0.0.1:8787/apty-kb-DEMO-5.x.kbpack.json` with
`allowDemoPacks: true` (the K25 audit rule), open Options and press Check
now: the 5.x row says "Delivered by your organization". Rebuild the demo pack
and press Check now again: the build date changes. Stop the server: the row
keeps the pack and shows `network`.

**Part D, the workflow.** On a fork, set `KB_PUBLISH_DRY_RUN=1`, run
`kb-packs.yml` by hand, and read the job summary: counts and ids only.

**Part D, for real (IT and the KB owner).** Follow
`docs/release/KB_PACK_DELIVERY.md` end to end, then check one SE's Preflight
shows "KB packs up to date".

**Part T.** With the 5.x demo pack loaded, open the fixture page and ask "the
Save tooltip is not showing", then "the launcher does not appear", then "the
email validation never fires". Each verdict names an INS rule, its card or
"No KB card yet", and a "not checked here" list.

**Part E.** With the version set to 4.x and the 4.x fixture loaded, ask "Apty
cannot find the Submit button". The verdict names an E4X rule and an A4PKH
card or draft, not "nothing was concluded".

**Part C.** Run a DOM Config capture, close the browser, reopen it, and
resume the capture. Then open a case, run DOM Config, and prepare a support
bundle: the `domConfig` block is there, and the settings file only when
ticked.

## Out of scope

- Announcement, checklist and knowledge-content check packs, and any 4.x
  tooltip, launcher or validation pack: next prompt, once the Part T drafts
  are published and show the pattern works.
- Publishing the draft cards. The KB owner reviews and publishes them in
  Confluence, then sets the ids in `cards-items.ts` and `cards-4x.ts`.
- Choosing the pack host and creating secrets. IT does this from
  KB_PACK_DELIVERY.md.
- The Apty Client bridges that let the Agent read files without reproducing
  the problem. Apty engineering owns them.
- The 13 5.x pages in another format, real question sets, calibration, and
  the remaining security decisions: unchanged from K25.
- F2b (path segments in the support bundle): waiting for the owner's
  decision; do not change it here.

## Status

Started 13 Nov 2026.

**Base, as found.** K25 (`claude/kb-rag-k25-all-fixes-3jn8kf`, tip
`f78abbe`) is not merged into `main`, and the K25 audit commit `ebdd69e`
(`claude/kb-rag-k25-audit-fixes`, `k25-audit-fixes.patch`) is not on the
remote nor anywhere in this environment. Every K26 branch therefore starts
from the K25 branch tip **without** the audit commit; each PR body says so.
Rules that came from the audit (for example `allowDemoPacks`) are not
present and are not invented here.

**Apty code, as found.** `aptyInc/apty-dap` and `aptyInc/apty-assist` could
not be attached to this session (no access). Parts T and E, and C3, depend
on reading them; under the rule "do not invent a file shape" they are
partial: what is left, and the command that finishes it, is in each row.

| Package | Status |
| --- | --- |
| D1 Policy keys | Done |
| D2 The fetcher | Done. A 304 is recorded as `not_modified` (the code list's name for it); import refusals keep their existing codes (`untrusted_key`, `revoked_key`, …). Check now skips the backoff |
| D3 When it runs | Done. The policy watch (`watchOrgPolicy`, which listens to `storage.managed` changes) recreates the alarm |
| D4 What the SE sees | Done. "Last update" is when the stored pack was last replaced (its import time). Import pack… stays while any version is still importable; a hand import of a delivered version is refused (`policy_managed`) |
| D5 The scheduled build job | Done, two steps partial. **actionlint** could not be run here (downloading its binary was not allowed in this environment); the YAML parses, every `run:` passes `bash -n` and every action is pinned to a SHA. To finish: `actionlint .github/workflows/kb-packs.yml`. **First real run**: partial until IT sets the host, secrets and variables (KB_PACK_DELIVERY.md). Deviations, both stricter: the self-check runs inside `publish-gate.mjs` (the same `selfCheck` as `kb:eval --self-check`); a failed run's pack is kept as an artifact only when the repository is private, because this repository is public and its artifacts are visible to any GitHub user; the job never prints the pack host |
| D6 Key and hosting setup (runbook) | Done ([KB_PACK_DELIVERY.md](../../release/KB_PACK_DELIVERY.md)); carrying it out is IT's and the KB owner's (partial until then) |
| D7 Tests | Done: unit tests for every outcome code, the 304, backoff, lock, D-DEL5 and refusals; `tooling/e2e/kb-delivery.e2e.test.mjs` (5 tests, pass in Chromium); the gate and transfer in `publish-gate.test.mjs`. actionlint: partial (see D5) |
| E0 to E5 | Not started |
| T0 to T5 | Not started |
| C1 Keep a capture across restarts | Done: `capture-keeper.ts` (`apty-dom-config-db`), `domConfigRetentionDays`, Resume and Discard capture, Clear results deletes it; D12 updated. Tested in unit and component tests; no browser-restart E2E yet (partial: add one that relaunches the same profile) |
| C2 Deep crawl and nav clicks | Done, by the second option: DOM Config's deep crawl does not click a control that is itself a discovered link (it is visited by URL instead), so no `[state-N]` duplicate or state-mismatch revisit comes from a nav click. Unit test fails without the change; the deep-mode E2E asserts none appears (on those shapes the page identity check already dropped them). Audit Application unchanged |
| C3 The three open questions | Recorded as still open in `dom-config.md` ("Open questions"): apty-dap was not available, so nothing was searched and no value was set; the commands that finish it are there |
| C4 to C5 | Not started |
