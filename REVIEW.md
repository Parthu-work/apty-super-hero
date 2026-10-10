# Review: `hardening/open-work` (checkpoints A and B)

| | |
|---|---|
| Branch | `hardening/open-work` (local only, never pushed) |
| Base | `origin/main` at `dc27e2f` |
| Code head | `d179913` (B2); the branch head is the next commit, which updates this file |
| Build zip | `apty-agent-review-B-<head>.zip`: a clean build of the branch head, the contents of `apps/browser-extension/dist` with `manifest.json` at the top |
| Git bundle | `apty-B-<head>.bundle`: refs `HEAD` and `refs/heads/hardening/open-work`, requires `dc27e2f`; it carries Phase A too |
| Checksums | `SHA256SUMS.txt` (SHA-256 of the zip and the bundle) |

This file replaces the previous round's `REVIEW.md` (the v7 WP1 review),
following that file's own convention of one review per round; that text is
in git history: `git show dc27e2f:REVIEW.md`. Checkpoint A's review is
kept below Phase B, unchanged apart from headings.

## Commits

| Commit | Work package |
|---|---|
| `79f7e66` | Spec saved as `docs/tasks/master/00-rules.md` plus one file per work package |
| `aa35083` | A1: ask before risky clicks and before opening other origins |
| `b2f58a0` | A2: apply the body deny list to Apty Client bodies |
| `d924303` | A3: a redaction mode setting, honoured by every caller |
| `d50a906` | Checkpoint A `REVIEW.md` |
| `d5fa21c` | B3: a structural summary for JSON bodies |
| `0829dbf` | B4: virtualized lists reported as partial coverage |
| `1784d54` | B5: a switch and site exclusions for the page-world script |
| `d179913` | B2: real-tenant validation bundle and threshold overrides |
| branch head | This `REVIEW.md` (checkpoint B) |

B1 was skipped: see below.

## Checkpoint B gates (clean build of `d179913`)

```
$ rm -rf apps/browser-extension/dist
$ tooling/scripts/verify-quiet.sh typecheck lint test audit build
✓ typecheck (11s)
✓ lint (1s)
✓ test (56s)
✓ audit (2s)
✓ build (21s)
```

Unit tests inside `test`:

```
packages/apty-debug-contract   Tests  72 passed (72)
packages/agent-core            Tests 260 passed (260)
packages/dom-snapshot          Tests 367 passed (367)
packages/ui                    Tests 200 passed | 10 skipped (210)   (the 10 skips are pre-existing; C4)
packages/browser-runtime       Tests 839 passed (839)
apps/browser-extension         Tests 214 passed (214)
apps/mcp-bridge                Tests  44 passed (44)
tooling/scripts (node:test)    pass 5, fail 0                         (new: npm run test:scripts)
```

```
$ npm run test:e2e        (Chromium from /opt/pw-browsers)
# tests 65
# pass 65
# fail 0
# skipped 0

$ npm run test:coverage   (CI's gate; not part of verify-quiet)
browser-runtime      Statements 90.52%  Branches 82.6%   Functions 93.15%  Lines 92.72%   (exit 0)
apty-debug-contract  Statements 91.7%   Branches 84.67%  Functions 96.42%  Lines 94.83%   (exit 0)
```

The coverage numbers equal checkpoint A's because the gate's include list
covers only a few files; widening it is C5.

The packaged manifest still has `"externally_connectable": {"ids": []}`.

Secret scan, TruffleHog 3.99.2 over every commit in `origin/main..HEAD`,
no exclude list, verification off:

```
$ trufflehog git file://. --since-commit origin/main --branch hardening/open-work --no-verification --no-update --json
"chunks":886  "bytes":861160  "verified_secrets":0  "unverified_secrets":0
```

## B1: Production Widget module (skipped)

The spec says to skip B1 when `docs/integrations/apty/reference-js/` is
missing. It is missing at `dc27e2f` and on this branch, so there is no
`producer.ts`, no paste bundle, no producer e2e and no
`VERIFY_WITH_REAL_CLIENT.md`. Nothing was claimed about a real Client.

## B2: Real-tenant validation tooling (done; the tenant run is the owner's)

What changed:

- `packages/browser-runtime/src/apty/dom-health-thresholds.ts` (new): one
  registry of the tunable thresholds (seed link count, same-URL edges and
  share, unreadable-frame share, unseen virtualized share, collector
  budget, three virtualization detector values), each with default,
  bounds, description and an `unverified` flag. Traversal, scoring, the
  frame collector and the virtualization detector read from it; the old
  exported constants are kept and equal the defaults.
- `AppSettings.domHealthThresholdOverrides`: honoured only while Developer
  tools is on (side panel card and the agent tools). Unknown names,
  non-numbers and out-of-range values are rejected with a reason; every
  active or rejected override is listed in the audit result
  (`thresholdOverrides`) and the bundle. Defaults are unchanged.
- Settings → Troubleshooting (Developer tools on): a JSON field for the
  overrides; invalid JSON is not saved and says so.
- `packages/browser-runtime/src/apty/validation-bundle.ts` (new):
  `buildValidationBundle` copies fields from an allow-list (never copies a
  result and strips it): hosts; URL templates (origin, path with ids
  masked, hash route, never a query); the frame tree with keys only from
  `top`, `data-osp-id`, `name` or `id` (a title key is kept as a hash);
  roles, reasons and failures; counts, coverage, confidence caps, overlays
  with evidence level, duplicate-id counts, virtualized lists, timings and
  `withinBudget`; application coverage, state and transition counts and
  traversal; the route probe's hashes and counts; every threshold; and
  extension and Chrome versions. The result then goes through the DOM
  Health exit redaction and strict contract redaction, whatever the
  redaction mode.
- DOM Health card: "Export validation bundle" (enabled once a page
  result, application result or finished route probe exists) opens
  "Review before sharing" with the exact JSON and Download, Copy, Cancel.
  The route probe hands its finished report to the card.
- `tooling/scripts/bundle-to-fixture.mjs` (new): a bundle becomes
  `<name>.html` (frame-tree skeleton, overlay placeholders, hosts replaced
  with `host-N.example.test`), `<name>.values.json` and a
  `<name>.fixture.test.ts` stub with one `it.todo` per check. It refuses
  other schemas, non-kebab names and overwriting.
- Docs: `docs/development/real-tenant-validation.md` (new: tenant rules,
  athenaOne and LN screens, the checks and the bundle field for each, what
  to send back), `dom-health-architecture.md` (known limitations),
  `PRIVACY.md` (exports), `docs/STATUS.md`.

Tests:

- Unit: `validation-bundle.test.ts` (5): a fixture with a name, record
  number, email, page title, input value and cookie in fields the bundle
  reads and in fields it must not read; none appears in the JSON, URL
  templates have no query, and the structure is checked field by field.
  `dom-health-thresholds.test.ts` (7, including an override changing a
  traversal decision and resetting), `tools/dom-health.test.ts` (+2:
  overrides only with Developer tools), `troubleshooting-card.test.tsx`
  (+10), `validation-bundle-export.test.tsx` (4),
  `dom-health-card.test.tsx` (+1), `bundle-to-fixture.test.mjs` (5).
- e2e, `dom-health-apps.e2e.test.mjs` (6 new): on each of the six
  application shapes, the real side panel runs Check DOM Health (Audit
  Application on the SPA), exports, and the reviewed JSON has the schema,
  the manifest's version, a Chrome version, the host, the active override,
  no URL template with a query, and none of that page's text, titles,
  tenant id or session parameter.

## B3: Structural summary for JSON bodies (done)

- `apty/json-body-summary.ts` (new): `summarizeJsonBody` returns kind, item
  count, top-level keys, the union of item keys with their types, how many
  whole items the preview holds and whether it is partial, in under 1,500
  characters (30 keys, 5 preview items at most).
- The Client resource inspector returns it as `json`; tool descriptions
  and the system prompt tell the model to read it before paging.
- Tests: `json-body-summary.test.ts`, inspector tests, `wp1-acceptance`
  (see conflicts).

## B4: Virtualized lists (done)

- `packages/dom-snapshot/src/health-virtualized.ts` (new): a list is
  virtualized on `aria-rowcount`/`aria-setsize` above the rendered rows, a
  gap in `data-index`/`aria-rowindex`, a tall empty spacer, or a scroll
  height far beyond its rendered rows; nested findings merge.
- Scoring: a confidence cap when more than half of the declared rows were
  never rendered, the risk `virtualized-list-partial-coverage`, and
  `result.virtualized`; the route probe shows rendered/declared rows.
- Tests: detector and scoring units; e2e on a 1,000-row grid with 15
  rendered (counts, signals, LOW confidence, risk, scroll position left
  alone).

## B5: Page-hook kill switch (done)

- The MAIN-world console bridge left the manifest. The service worker
  registers it with `chrome.scripting.registerContentScripts`
  (`runtime/page-hooks-registration.ts`), excludes the listed sites, and
  unregisters it when Settings → Troubleshooting → "Track client-side
  routing and capture console output from page load" is off. Settings
  changes reconcile at once.
- With the hooks off, DOM Health reports routing evidence as unavailable
  (never as "no routing"), the route probe shows unknown counts, and the
  console tool does not inject the bridge.
- `validate-manifest.mjs` checks the emitted bridge path.
- Tests: registration units; e2e on an excluded site (no bridge, routing
  reported unavailable).

## Phase B: not done, or partial

- B1 skipped (above).
- B2: the bundle has not been produced on a real athenaOne or Infor LN
  tenant; that is the owner's run. No threshold was tuned.
- B2: overrides for the collector budget and virtualization thresholds
  reach the content script through the collect message; that path is
  unit-tested, while the e2e exercises an override that the service-worker
  side reads (`sameUrlRatioForClickFirst`).
- B4: the optional scroll sample was not built; the audit never scrolls.

## Phase B: conflicts between the prompt and the repo

- B2: the spec lists the `data-*` free-text cut-off and the
  structure-only cap among the unverified values. The cut-off is in the
  collector's privacy code, not a threshold the audit reads, and the
  structure-only cap is a rule, not a number; neither is in the registry.
- B2: the spec asks for the button "in the DOM Health card and Developer
  tools". Developer tools in Settings live in `@apty/ui`, which may not
  depend on `@apty/browser-runtime`; the button is in the DOM Health card,
  where the developer route probe is, and covers its report.
- B2: the threshold overrides are a global in the service worker or side
  panel for the duration of an audit; two audits running at once in the
  same context would share the later one's overrides.
- B3: at `dc27e2f` the inspector already returned a small `json` summary
  with a 5-item `sample`. B3 replaced `sample` with the key union and
  types; `wp1-acceptance` asserted `json.sample` length, so the same bound
  is now asserted on the parsed preview and `json.inPreview`. A JSON
  object body used to be put in the preview whole, with no size cap;
  fixed.
- B5: the spec says to resolve the hashed script path from the built
  manifest. With the bridge gone from the manifest there is nothing to
  resolve, so the build emits it at `content/console-bridge.js` and the
  validator checks both sides. `match_about_blank` has no equivalent in a
  registered script; `matchOriginAsFallback` is used.
- B5: `page-hooks.test.ts` and `frame-responder.test.ts` were adapted to
  the install-time announcement and the new `historyHooksSeen` field, with
  a test added for each.
- B5 (my error, fixed): a `git checkout` while proving the validator
  reverted uncommitted `vite.config.ts` edits; they were re-applied and
  the clean build and full e2e (59/59 then) re-run before committing.

## Phase B: decisions needed from the owner

The three Phase A decisions are still open (below). No new one.

## Phase B: observed, not changed

- The application audit does not aggregate `virtualized` across states;
  each state's page result carries it.
- The coverage gate's include list is narrow, so B's new modules do not
  move its numbers (C5).
- `tooling/e2e/agent.e2e.test.mjs` line 198 has a Biome `useTemplate`
  info (string concatenation), from A1; info only, `lint` passes.

## Phase B: owner test scripts (about 5 minutes each)

Setup as for Phase A below (load the unzipped build, configure a model).

### B2: validation bundle

1. Settings → Troubleshooting: turn on **Developer tools**. **Expected:**
   a "DOM Health: threshold overrides (JSON)" field appears. Type
   `{"sameUrlRatioForClickFirst": 0.4}` and click elsewhere. Type
   `{"x": "1"` and click elsewhere. **Expected:** "Needs a JSON object
   whose values are all numbers. Not saved." Restore the first value.
2. Open any page with a form (for example
   `https://httpbin.org/forms/post`) and the side panel. Click **Check DOM
   Health** and wait for "Last checked".
3. Click **Export validation bundle**. **Expected:** "Review before
   sharing" with JSON whose `schema` is `apty-dom-health-validation/1`,
   `hosts` is `["httpbin.org"]`, `thresholdOverrides.active` lists
   `sameUrlRatioForClickFirst` 0.4 (default 0.5), `thresholds` lists nine
   entries, and no field contains the page's labels or title.
4. Click **Copy**, paste somewhere: the same JSON. Click **Download**:
   a file `apty-dom-health-validation-<time>.json`.
5. Turn Developer tools off and run step 2–3 again. **Expected:**
   `thresholdOverrides.active` is empty.
6. For the real tenants: follow `docs/development/real-tenant-validation.md`.

### B3: JSON summary

1. With the fake Client from the A2 script connected, ask: "List the
   items in segments.json from the Apty Client." **Expected:** the answer
   says 206 items and names their keys; the tool result (expand it) has
   `json.itemCount: 206`, `json.itemKeys` with types and `json.inPreview`.

### B4: virtualized lists

1. Save the `VIRTUALIZED_PAGE` markup from
   `tooling/e2e/dom-health-apps.e2e.test.mjs` as `grid.html`, serve it
   with `python3 -m http.server 8000`, open it, scroll the grid.
2. Click **Check DOM Health**. **Expected:** confidence Low with "1
   virtualized list(s) render 15 of 1000 declared rows; the other 985 were
   not audited."; the grid's scroll position does not move.

### B5: page-script switch

1. Open any page, then ask "show the apty page logs from page load".
   **Expected:** console output from load is returned.
2. Settings → Troubleshooting: add that page's host to "Sites where that
   script never runs", reload the page, ask again. **Expected:** only
   output after the request; DOM Health's routing evidence reads
   "unavailable" rather than zero.
3. Turn the switch off: the site list disappears; turn it back on.

# Phase A

### Checkpoint A gates (at `d924303`)

```
$ rm -rf apps/browser-extension/dist
$ tooling/scripts/verify-quiet.sh typecheck lint test audit build
✓ typecheck (10s)
✓ lint (1s)
✓ test (52s)
✓ audit (1s)
✓ build (20s)
```

Unit tests inside `test`:

```
packages/apty-debug-contract   Tests  72 passed (72)
packages/agent-core            Tests 260 passed (260)
packages/dom-snapshot          Tests 355 passed (355)
packages/ui                    Tests 188 passed | 10 skipped (198)   (the 10 skips are pre-existing; C4)
packages/browser-runtime       Tests 788 passed (788)
apps/browser-extension         Tests 202 passed (202)
apps/mcp-bridge                Tests  44 passed (44)
```

Audit step: manifest valid, no architecture-boundary violations, no
unreviewed branding, no duplicate tool names, MCP bridge docs consistent.

```
$ npm run test:e2e        (Chromium from /opt/pw-browsers, against the clean build)
# tests 56
# suites 10
# pass 56
# fail 0
# cancelled 0
# skipped 0

$ npm run test:coverage   (CI's gate; not part of verify-quiet)
browser-runtime  Statements 90.52%  Branches 82.6%  Functions 93.15%  Lines 92.72%   (exit 0)
apty-debug-contract  Statements 91.7%  Branches 84.67%  Functions 96.42%  Lines 94.83%   (exit 0)
```

The packaged manifest still has `"externally_connectable": {"ids": []}`.

## Secret scan of the diff

TruffleHog 3.99.2 (the version CI pins; download checked against the
release's published SHA-256), over every commit in `origin/main..HEAD`,
with no exclude list and with verification turned off so no candidate is
sent to a third party:

```
$ trufflehog git file://. --since-commit origin/main --branch hardening/open-work --no-verification --no-update --json
"chunks":707  "bytes":681296  "verified_secrets":0  "unverified_secrets":0
```

## A1: Gate state-changing clicks and new tabs (done)

What changed:

- `packages/browser-runtime/src/tools/click-risk.ts` (new):
  - `classifyClickRisk(target)` is pure. A click is risky when the target
    is a submit control (`button[type=submit]`, `input[type=submit|image]`,
    a typeless `button` inside a `<form>`), or its accessible name contains
    a word from `RISKY_CLICK_WORDS`, or it links to another origin (or a
    non-web URL), or it sits on a frame or canvas, or it cannot be found.
  - `classifyNewTabUrl(url, currentPageUrl)` decides the new-tab policy.
  - `inspectClickTargetInPage` finds the element by snapshot uid (in any
    frame, through open and closed shadow roots) or at a viewport point,
    and describes the control a click would activate.
  - `describeClickForApproval` builds the prompt text: role, accessible
    name, tag, form method and action, link and page origin.
- `click`: safe clicks run at once; risky ones go through `gateRiskyAction`.
- `computer`: the click actions and `left_click_drag` map the screenshot
  point to the element under it (both ends of a drag) and apply the same
  rules. With no screenshot to map the point, or a frame or canvas under
  it, the click asks.
- `create_new_tab`: the same origin as the current tab opens at once.
  Another origin asks, and an "Allow on this site" grant is keyed on the
  destination origin. A non-`http(s)` scheme, or a query plus fragment over
  128 characters, always asks and never offers "Allow on this site". The
  prompt shows the full URL.
- `gateRiskyAction` takes `{ rememberable: false }`: it ignores and never
  creates grants. The prompt hides "Allow on this site" for such requests.
- Every affected tool description has an `APPROVAL:` sentence and tells the
  model that a `denied` result must not be retried. MCP calls use the same
  tools and the existing relay.
- Docs: `docs/security/SECURITY_AUDIT.md` finding #18,
  `docs/security/PERMISSIONS.md` "Tools that wait for a person's click",
  `docs/STATUS.md`.

Tests:

- Unit:
  - `click-risk.test.ts` (33): the classifier table, the new-tab policy for
    same origin, cross origin, long query, long fragment, `data:`,
    `javascript:`, `chrome:` and unparseable URLs, and the inspector
    wrapper (fails closed).
  - `element.test.ts` (+5: click).
  - `computer.test.ts` (+4).
  - `tab.test.ts` (5, new).
  - `approval.test.ts` (+1: a non-rememberable request).
  - `approval-prompt.test.tsx` (+1: no remember button).
- e2e, "approval for clicks and new tabs (A1)" in `agent.e2e.test.mjs`
  (6 tests):
  - Deny on `create_new_tab` to `http://127.0.0.1:<evil port>/?d=<200-char
    secret>` leaves the evil server with **zero requests**, and the prompt
    offers no "Allow on this site".
  - "Allow once" opens it.
  - A benign click runs with no prompt.
  - A "Delete" submit button prompts (showing `Form: POST …/orders/delete`)
    and Deny leaves the page counter at 0.
  - A `computer` click at that button's coordinates prompts.
  - "Allow on this site" for `click` does not enable `create_new_tab`, and
    "Revoke all" in Options makes the click ask again.

  All existing agent tests still pass.

## A2: Deny list for Apty Client bodies (done)

What changed:

- `inspectResource` loads Settings → Data handling's deny list itself and
  checks the resource URL before `getResourceBody`. On a match:
  - it returns `status: "body_denied"`, the request metadata, `deniedBy`
    (the entry) and how to change it;
  - it never calls the Client's `get-resource-body`;
  - it records no evidence, so `get_evidence_json` cannot expose the body.
- `matchingDenyEntry` reports which entry matched (`isUrlDenied` uses it).
- Data-handling card:
  - the list stays editable when page capture is off (Client bodies don't
    depend on that switch);
  - its copy says it covers the Apty Client;
  - the placeholder shows `/users/`, `/api/me` and `/userinfo` as examples;
  - the default stays `[]`.
- `PRIVACY.md`, `docs/TROUBLESHOOTING.md`, `docs/STATUS.md` and the
  inspect tool's description explain `body_denied`.

Tests:

- Unit: `extension-network-inspector.test.ts` (+5): denied (never asks the
  Client, no evidence), a host entry, an allowed body in full, and an empty
  list or no settings. `resource-body-utils.test.ts` (+2) and
  `data-handling-card.test.tsx` (+1, 1 updated).
- e2e, `apty-client.e2e.test.mjs` (1 new):
  - the fake Client serves `/users/4815162342.json` and `segment.json`;
  - with `/users/` on the list the agent gets `body_denied`, and the
    Client's recorded `get-resource-body` calls are exactly `["r1"]` (the
    segments body), so the denied body was never requested;
  - `segment.json` returns in full;
  - clearing the list returns the preference body.

## A3: Redaction mode control (done)

What changed:

- `AppSettings.redactionMode` (default `"strict"`).
- `packages/browser-runtime/src/runtime/redaction-mode.ts` is the one
  accessor:
  - `getRedactionMode()` reads the setting once and caches it;
  - `chrome.storage.onChanged` updates the cache;
  - `currentRedactionMode()` is strict until the first read completes;
  - callers redact only through `redactText` and `redactLogEntries`.
- All 17 call sites in 10 files were moved to those wrappers. The side
  panel and the service worker read the mode at startup.
- `redaction-mode.test.ts` scans every non-test source file in
  browser-runtime, the extension app, ui, agent-core and dom-snapshot, and
  fails on any direct call to the redaction library. I proved it fails by
  adding a temporary direct call (not committed).
- Settings → General → Data handling → Redaction:
  - Strict (recommended), Standard, and Off (development only), each with a
    plain description and its own Preview of a fake sample, before and
    after;
  - Off opens a confirmation dialog that says structural secret redaction
    stays on;
  - the preview function is passed in by the options page, so `@apty/ui`
    still depends only on agent-core.
- Side panel: a persistent "Redaction is OFF" banner with a Change button.
- Exports: message Copy and Download begin with
  `Apty Agent export · redaction mode: <mode> · <ISO time>`. The response
  viewer adds that header to text bodies, and for JSON puts the mode in the
  file name and next to the buttons (see Decisions).
- `PRIVACY.md` (mode table) and `docs/STATUS.md`.

Tests:

- Unit:
  - `redaction-mode.test.ts` (16): reads, defaults, caching (one storage
    read), invalidation by change events, ignores other areas and keys,
    Strict vs Standard vs Off output, a JWT masked in Off, and the bypass
    scan.
  - `redaction-mode-control.test.tsx` (6), `export-header.test.ts` (3),
    `message-item.test.tsx` (+1), `redaction-off-banner.test.tsx` (4) and
    `redact.test.ts` (+1).
- e2e, `redaction.e2e.test.mjs` (3, new):
  - a fresh profile is strict, and the model sees neither the page title
    nor the username;
  - Standard shows the page title and still masks the username;
  - Off needs confirmation ("Keep current mode" leaves Standard), the mode
    survives an Options reload, the side panel shows "Redaction is OFF" and
    keeps it after a reload, the username is visible, and the JWT is still
    masked.

## Phase A: not done, or partial

Nothing in Phase A is partial. Not verified:

- A real model was not used; every e2e test drives the real side panel with
  a scripted model. Whether a real model retries after a `denied` click is
  up to the model; the tool tells it not to.
- No real Apty Client and no real customer tenant were used (B1 and B2 are
  the owner's runs).
- The MCP path for the new click and tab gates is covered by the existing
  relay tests and unit tests, not by a new MCP e2e test.

## Phase A: conflicts between the prompt and the repo

- The prompt says `origin/main` has 190 commits; `git rev-list --count
  origin/main` gives 107 at `dc27e2f`.
- Owner checklist:
  - the boxes were not ticked;
  - `docs/integrations/apty/reference-js/` is absent, so WP-B1 will be
    skipped and reported in Phase B;
  - `SKILLS_DECISION` was not edited, so the default KEEP applies (D1);
  - Chromium is at `/opt/pw-browsers`.
- The prompt's bundle command `git bundle create … origin/main..HEAD`
  produces a bundle with only a `HEAD` ref, which the apply command `git
  fetch <bundle> hardening/open-work:bundle-work` cannot fetch. I built the
  bundle with both `HEAD` and `refs/heads/hardening/open-work` and tested
  the apply flow in a scratch clone (fetch, "fast-forward OK", 4 commits).
- A1:
  - **"save" is not in the word list.** The spec's examples don't name it,
    and the existing core-tools e2e clicks a "Save order" button expecting
    no prompt. See Decisions.
  - **Point lookup method.** The spec offers CDP `DOM.getNodeForLocation`
    or `elementFromPoint` through the frame responder. I used
    `chrome.scripting.executeScript` with `document.elementFromPoint` in the
    top frame (no debugger attach, the same pattern the DOM locator uses).
    A frame under the point counts as unresolvable, so the click asks.
  - **A test updated to the new behaviour.** `computer.test.ts` had "left_click runs immediately with no
    approval", asserting the ungated behaviour this package reverses. It is
    kept, now with a known-safe target, alongside new risky and fail-closed
    cases. No test was deleted.
  - **Unit-test gap for the in-page inspector.** `inspectClickTargetInPage`
    has no jsdom unit test: jsdom is not a browser-runtime dependency, and
    adding it would be a new dependency. It is covered by the real-Chromium
    e2e tests.
- A2:
  - **Privacy statement location.** The spec says "the privacy statement
    under `docs/`", but the privacy statement is `PRIVACY.md` at the repo
    root. I updated that file and `docs/TROUBLESHOOTING.md`.
  - **A test updated to the new behaviour.** `data-handling-card.test.tsx`
    asserted the list is disabled while page capture is off. That would
    stop a user from protecting Client bodies, so the assertion now
    requires it to be enabled.
- A3:
  - **Call-site count.** The spec says 16 non-test callers; I found 17 call
    sites.
  - **How Standard differs from Strict.** In this codebase Standard differs
    from Strict only for page-context keys (`page_title`, `page_search`,
    `page_path`, `referrer`); usernames and other personal-data keys are
    masked in both. Off skips only the key-name pass; PEM, JWT, bearer,
    known token shapes, generic secret key/value pairs and emails are
    masked in every mode. The UI copy says exactly this.
  - **DOM Health's own privacy is unchanged.** Page titles replaced,
    identifier-shaped values and element ids masked: this is structural and
    stays on in every mode. Only its inner text-redaction call follows the
    mode.

## Phase A: decisions needed from the owner

1. **Add "save" to `RISKY_CLICK_WORDS`?** It would prompt on every Save
   button, and the existing core-tools e2e would need its approval
   answered.
2. **A header line inside JSON exports?** The response viewer's JSON
   Copy/Download currently stays valid JSON, with the mode in the file name
   and on screen. A header line would make the file invalid JSON.
3. **Right-click.** A `computer` `right_click` goes through the same
   classifier as other clicks (the spec says "click and drag actions"). It
   can't submit or follow a link, so it could be exempted if the prompts
   are a nuisance.

## Phase A: observed, not changed

- The DOM Health application audit navigates the bound tab itself
  (`apty/page-navigation.ts`, `chrome.tabs.update`) to same-origin links it
  discovered. It is not a model tool call and is not gated (also noted in
  SECURITY_AUDIT #18).
- `tooling/e2e/harness.mjs`:
  - `toolResults()` counts tool messages after the last user message. A
    screenshot sent to the model arrives as a new user message, which
    resets it, so the A1 e2e uses its own per-prompt counting.
  - `openSidePanel()` overwrites the whole settings object, wiping other
    settings.
- `RISKY_CLICK_WORDS` is English only. A destructive control with no
  telling label or form (a `div` with a click handler named "Go") still
  runs at once.
- `inspect_extension_network` returns the request URL in its metadata even
  for `body_denied` (unchanged existing behaviour; the URL goes through the
  inspector's usual handling, not the deny list).
- The response viewer's JSON Copy, and the code-block and selector Copy
  buttons, carry no export header (they copy snippets, not exports).
- `packages/ui` still has 10 skipped tests (C4 in Phase C).

## Phase A: owner test scripts (about 5 minutes each)

Setup for all three:

1. Unzip `the latest `apty-agent-review-*.zip`` into a folder. In Chromium (or
   Chrome for Testing; branded Chrome 137+ ignores `--load-extension` but
   "Load unpacked" still works), open `chrome://extensions`, turn on
   Developer mode, click **Load unpacked** and pick that folder. The ID
   should be `bpiondflhhdplemamgggcdajclmoeple`.
2. In Options → AI provider, configure your own model and key, and click
   Test connection.

### A1: clicks and new tabs

1. Save this as `a1.html`, and in that folder run `python3 -m http.server
   8000`:

   ```html
   <!doctype html><title>count 0</title><h1>Orders</h1>
   <form action="/orders/delete" method="post" onsubmit="event.preventDefault(); window.n=(window.n||0)+1; document.title='count '+window.n">
     <button type="submit">Delete</button></form>
   <button onclick="document.title='details shown'">Show details</button>
   ```

2. Open `http://localhost:8000/a1.html` and open the side panel.
3. Type: "On the current tab, click the Show details button."
   **Expected:** no approval prompt; the tab title becomes "details shown".
4. Type: "On the current tab, click the Delete button."
   **Expected:** a prompt "Allow click?" showing `Click "Delete"
   (<button type=submit>, role button)`, `Form: POST
   http://localhost:8000/orders/delete`, "Why approval is needed: it
   submits a form; its label contains "delete"". Click **Deny**.
   **Expected:** the title stays "count 0".
5. Type: "Open a new tab at https://example.org/?d=" followed by about 200
   characters of text.
   **Expected:** a prompt "Allow create_new_tab?" showing the full URL, with
   only **Allow once** and **Deny** (no "Allow on this site"). Click
   **Deny**. **Expected:** no new tab opens.
6. Type: "Open a new tab at https://example.org/".
   **Expected:** a prompt that offers "Allow on this site for 15 min".
   Click it. **Expected:** the tab opens. Ask again.
   **Expected:** it opens with no prompt.
7. Options → General → Remembered approvals shows `create_new_tab` for
   `https://example.org`. Click **Revoke all**; step 6 asks again.

### A2: deny list for Apty Client bodies

1. Create the test Client from the repo:

   ```sh
   node -e "import('./tooling/e2e/harness.mjs').then(h => h.writeFakeClient('/tmp/fake-client', 'working', 'bpiondflhhdplemamgggcdajclmoeple'))"
   ```

   Load `/tmp/fake-client` unpacked too.
2. Options → Connection → Apty Integration: paste the fake Client's ID from
   `chrome://extensions` and click **Connect**.
   **Expected:** "Answering".
3. Options → General → Data handling: leave "Capture response bodies" off.
   **Expected:** the deny-list box is still editable, and its label
   mentions the Apty Client. Type `/users/` and click elsewhere.
4. In the side panel type: "Get 4815162342.json from the Apty Client."
   **Expected:** the answer says the body was withheld because it matches
   `/users/` in the deny list; no body content (`en-GB`) appears. In
   `chrome://extensions`, open the fake Client's service worker console and
   run `bodyRequests`. **Expected:** it does not contain `"r3"`.
5. Type: "Get the data from segments.json in the Apty Client."
   **Expected:** the segments come back; **View full response** shows 206
   items.
6. Clear the deny list and repeat step 4.
   **Expected:** the preference body (`theme`, `language: en-GB`) is
   returned.

### A3: redaction mode

1. Options → General → Data handling → Redaction.
   **Expected:** **Strict (recommended)** is selected.
2. Click **Preview** next to Standard.
   **Expected:** "Before (sample data)" shows the fake chart title and
   username. "After: Standard" keeps the title, masks the username, and
   replaces the Bearer JWT with `<REDACTED>`. Preview Strict.
   **Expected:** the title is masked too.
3. Select **Standard**. **Expected:** it is saved at once (reload Options to
   check).
4. Select **Off (development only)**.
   **Expected:** a dialog "Turn redaction off?" stating "Structural secret
   redaction stays on: tokens, API keys, JWTs, bearer credentials and
   emails are still masked." Click **Keep current mode**.
   **Expected:** Standard is still selected.
5. Select **Off** again and click **Turn redaction off**. Open the side
   panel.
   **Expected:** a banner "Redaction is OFF (development only) …" with a
   **Change** button. Reload the side panel.
   **Expected:** the banner is still there.
6. Ask any question, then click **Copy** on the answer and paste it
   somewhere.
   **Expected:** the first line reads `Apty Agent export · redaction mode:
   off · <time>`.
7. Click **Change** in the banner, select **Strict**.
   **Expected:** the banner disappears from the side panel.
