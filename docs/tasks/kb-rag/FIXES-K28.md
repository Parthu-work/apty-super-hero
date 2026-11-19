# KB-RAG K28: audit fixes and rollout automation

19 Nov 2026 · Apty Customer Success

## Status

**IN PROGRESS.** Part F (audit fixes) on `claude/kb-rag-k28-fixes`; Part A (rollout automation) on `claude/kb-rag-k28-automation`.

## How to run this prompt

This is a complete, self-contained implementation prompt for a coding agent.
Do every work package in order until every acceptance check passes. Do not
stop at a plan and do not skip a package. Where a step cannot be done in
your environment (no browser, no GitHub secrets, no Web Store account), do
everything else, mark that step partial, and say exactly what is left and
the command that finishes it.

- **Base:** `origin/main` at `387f81cc` (19 Nov 2026) or later. It holds K10
  to K27.
- **Two parts, two PRs:** Part F (audit fixes) on `claude/kb-rag-k28-fixes`,
  then Part A (rollout automation) on `claude/kb-rag-k28-automation`. One
  commit per package, each green on its own. Never commit to `main`.
- Save this prompt as `docs/tasks/kb-rag/FIXES-K28.md` in the first commit
  and keep its status line current. Re-read it after any context
  compaction; never guess scope.
- **Evidence base:** an end-to-end audit of `387f81cc` on 19 Nov 2026:
  install and build pass; 4,348 unit tests pass (agent-core 695,
  browser-runtime 2,087, browser-extension 751, ui 511, MCP bridge 72,
  scripts and KB tooling 232); 16 audits pass; demo evaluations 100%.
  Behaviour was probed with temporary tests against `routeLookup`,
  `answerLookup` and `selectRelevantTools`. The E2E suite was not run in the
  audit environment, and the regression grid on real packs is the KB
  owner's.

## What the audit found

K27 is complete and green, but its lookup router accepts very few
phrasings, and a handful of smaller gaps remain. Part A then removes the
manual work the rollout plan listed.

| # | Gap | Evidence | Fixed in |
|---|-----|----------|----------|
| 1 | The lookup router misses most natural phrasings. | `routeLookup` routed 1 of 23 natural questions. It misses "belong to", "assigned to", "include", "contain", "part of"; questions without the word "workflow"; lists ("which workflows are in X", "which segments is X in"); "show me X"; "what environment am I on"; "list hidden workflows"; and any phrasing that names a file, including the tester's own "from flows.json check if … in segments.json". All of these go to the model. | F1 |
| 2 | Duplicate names give choices that look the same. | Two segments named "Managers" produce "Ask the user which segment: Managers, Managers." | F2 |
| 3 | Unknown version and missing data read as a failed file. | With only shared files observed, `answerLookup` assumes 5.x and says "workflow.json could not be read (not_observed)", even when 4.x files are present. | F3 |
| 4 | `search_kb` is offered unevenly. | `selectRelevantTools` offers it for "the tooltip balloon flickers" and "the widget is not showing", but not for "widget is missing" or "workflow not working". | F4 |
| 5 | "One question at a time" is a prompt line only. | `constants.ts` has the rule; `constants.test.ts` checks the text, not the behaviour. The first real test saw the model ask three questions in one turn. | F5 |
| 6 | Nine K27 E2E files have no accessibility check. | No axe run in lookup, kb-unknown-setting, kb-absent, kb-freshness, kb-learning, get-evidence, cases, feedback, case-host. | F6 |
| 7 | The Skills Export button does nothing. | `SkillList.tsx` `handleExport` only logs (`// TODO: Implement skill export functionality`), yet the button is shown. | F7 |
| 8 | Release housekeeping. | `CHANGELOG.md` still holds the 0.2.0 content under "Unreleased"; the release dry run's format check fails on any stray file in the tree without saying so up front. | F8 |
| 9 | The demo packs cannot show the routing choices. | The demo routing card has no options, so E3's "which one?" is only visible in the E2E or on real packs. | F9 |
| 10 | The quality gate is not active in the nightly job. | It reads `tooling/scripts/kb/questions/<version>.json`, a folder that does not exist (real questions stay out of the public repo). | A2 |
| 11 | Manual rollout steps remain. | Policies are written by hand; nothing watches the nightly job (a public repository's schedules stop after 60 days without activity); feedback is merged by hand; the extension is loaded by hand. | A1, A3, A4, A5 |

## Hard rules

1. No KB content in the repository. Tests and fixtures use synthetic cards,
   invented workflow and segment names, and the demo packs. Real page ids
   are fine; real titles and card text are not.
2. No security regression. K22 and K27 hold: the KB egress filter runs
   first; card text reaches a model only through an approving policy;
   cases, feedback and send records stay on the device; nothing new is sent
   to a provider; the model never states an Apty fact it was not given.
3. No new permission, host or network call in the extension. Part A's
   automation runs in the repository's tooling and GitHub workflows, never
   in the extension. The optional feedback upload is out of scope.
4. Secrets never enter the repository, logs or job summaries. Workflows
   print ids, counts, hashes and key ids only; question files are read from
   the pack host and never written to disk or the public repository.
5. Deterministic. The same packs, files and question give the same route,
   lookup answer and decision record.
6. Test first. Each package starts with a test that fails on `387f81cc`.
   Anything crossing the Chrome boundary gets an E2E using `harness.mjs`.
   Never skip, weaken or delete a test.
7. New UI strings in `en.json` and `zh.json`; every new or changed surface
   passes axe in light and dark and works by keyboard alone.
8. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies` (after
   `pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace`),
   every `audit:*` script, `npm run report:request-size`, and the E2E files
   you touched. Paste the results into the PR body.

## Part F: fixes from the audit

Order: F1, F3, F2, F4, F5, F9, F6, F7, F8.

### F1. A lookup router that understands how SEs ask (gap 1)

Files: `packages/browser-runtime/src/apty/diagnosis/lookup.ts`
(`routeLookup`), `lookup.test.ts`, `responder.ts` where lookups are routed,
`tooling/e2e/lookup.e2e.test.mjs`.

- Replace the fixed regular expressions with a small deterministic parser:
  take quoted names first; drop filler ("please", "check if", "can you") and
  content-file names in either version's spelling (flow.json, flows.json,
  workflow.json, segments.json, segment.json); then match a verb family and
  split the names around it.
- Precision first. A question that does not parse cleanly is not routed and
  goes on as today. Every negative row below must stay unrouted.
- Add two kinds: `segmentMembers` (the workflows in a segment) and
  `itemSegments` (the segments a workflow is in). `hidden` takes an
  optional item.
- Tests (invented names only). Each row must give the result shown:

| Question | Route |
|---|---|
| is Alpha Ledger Page in All Users segment | membership |
| is Alpha Ledger Page workflow in All Users | membership |
| does the Alpha Ledger Page workflow belong to the All Users segment | membership |
| is the Alpha Ledger Page workflow assigned to All Users | membership |
| is Alpha Ledger Page part of the All Users segment | membership |
| does the All Users segment include Alpha Ledger Page | membership |
| does All Users segment contain the Alpha Ledger Page workflow | membership |
| is workflow Alpha Ledger Page visible to the All Users segment | membership |
| check if Alpha Ledger Page is present in the all users segment | membership |
| from flows.json check if Alpha Ledger Page is present in All Users Segment in segments.json | membership |
| which workflows are in All Users / list the workflows in the All Users segment | segmentMembers |
| which segments is Alpha Ledger Page workflow in | itemSegments |
| show me the Alpha Ledger Page workflow / show Alpha Ledger Page / get the Alpha Ledger Page workflow entry | show |
| what environment am I on / which environment is the Apty client using | environment |
| list hidden workflows / which workflows are not visible in the widget | hidden |
| is the workflow Alpha Ledger Page hidden from the widget | hidden (one item) |
| what does flow.json mean | not routed |
| get flow.json | not routed (file fetch) |
| workflow not working | not routed |
| how do I add a workflow to a segment | not routed |
| the tooltip balloon flickers | not routed |
| workflow is published but not showing in the widget | not routed (check pack) |
| is the widget visible to all users in the segment | not routed |
| where is the Widget Activation toggle | not routed |

- Names containing "in" ("Sign in", "Order in Progress") keep working, as
  today.
- E2E: three of the new phrasings answer with a table and zero model
  requests on the fake 4.x and 5.x clients.

### F3. Say what is really missing (gap 3)

Files: `lookup.ts` (`answerLookup`), `lookup-card.tsx`, i18n, tests.

- When the version is unknown, use whichever version's files are present;
  if both or neither are, ask one question ("Which Apty version does this
  tenant run?") instead of assuming 5.x.
- When the Client is not connected, or a file was never observed, say that
  in words ("The Apty Client has not reported flow.json yet"), and offer Get
  the evidence (E8) and a tab reload. Keep "could not be read" for a real
  failed request, with its status.
- Tests: unknown version with 4.x files present answers from them; no files
  and no Client says so and offers the evidence route.

### F2. Choices the SE can tell apart (gap 2)

Files: `lookup.ts`, `lookup-card.tsx`, i18n, tests.

- When two segments or workflows share a name, each choice shows what tells
  them apart: its id, whether it is active or hidden, and how many workflows
  a segment holds ("Managers (s-2, inactive, 1 workflow)"). A choice can be
  picked with one click.
- Tests: two segments named the same give two distinct labels; picking one
  answers for that one.

### F4. search_kb offered on every symptom (gap 4)

Files: `packages/browser-runtime/src/tools/tool-relevance.ts`,
`kb/kb-matches.ts` (its symptom detector), tests.

- Use one shared list of symptom words for the KB matches detector and the
  tool selection, so any message the KB treats as a symptom also offers
  `search_kb`, within F1 of K27's budget (12 tools for a symptom).
- Tests: "widget is missing", "workflow not working", "the tooltip balloon
  flickers" and "the widget is not showing" all offer `search_kb`; a how-to
  and a casual message do not.

### F5. One question per turn, enforced (gap 5)

Files: a new `packages/ui/src/lib/one-question.ts` (+ test), the assistant
message renderer, i18n.

- After a model reply, find the questions it asks the user in its last
  paragraph or list. If there is more than one, show the first as the
  question and put the others under a collapsed More questions disclosure.
  Never delete text. No model call.
- Tests: a reply with three questions shows one and folds two; a reply with
  one is unchanged; questions inside code or quotes are ignored. E2E with a
  fake provider that returns three questions.

### F9. Demo packs that show the routing choices (gap 9)

Files: `tooling/scripts/kb/fixtures/` (the demo cards),
`build-demo-pack.mjs`, demo questions, tests.

- Give each demo version's routing card invented options that point at its
  own demo cards, so a broad demo question ("DEMO workflow not working")
  shows E3's choices with the demo packs. Add a broad category to the demo
  questions and keep the evaluations at 100%.

### F6. Accessibility checks on the new surfaces (gap 6)

Add an axe run in light and dark to lookup, kb-unknown-setting, kb-absent,
kb-freshness, kb-learning, get-evidence, cases, feedback and case-host, with
each surface in its data-filled state (a lookup table, a case list with
rows, a feedback list with rows). Fix what they find.

### F7. The Skills Export button (gap 7)

Files: `apps/browser-extension/src/components/skill/SkillList.tsx`, the
skills storage, tests.

- Implement it: download the skill as one file through the existing
  download path, in a format the skills Import accepts, so an export imports
  back unchanged. If the skills storage cannot produce that simply, remove
  the button and its handler instead, and say why in the PR.
- Test: export then import round-trips one synthetic skill; or the button is
  absent.

### F8. Release housekeeping (gap 8)

- `tooling/scripts/release-dry-run.sh` checks `git status --porcelain` first
  and stops with "Uncommitted or untracked files: … (the format check reads
  the whole tree)" when the tree is not clean, unless `--allow-dirty` is
  passed. Test it next to `ci-local.test.mjs`.
- `docs/development/RELEASING.md` gains the line: move the "Unreleased"
  CHANGELOG entries under `## 0.2.0 — <date>` in the release commit. Do not
  move them in this PR.

## Part A: rollout automation

Order: A1, A2, A3, A4, A5. These are the small builds from the rollout plan.
They live in the repository's tooling and workflows, never in the extension.

### A1. Policy generator and checker

Files: new `tooling/scripts/policy/generate-policy.mjs` and
`check-policy.mjs` (+ tests), `package.json` scripts `policy:generate` and
`policy:check`, `docs/security/ORG_POLICY.md`.

- `pnpm policy:generate --config <file> --out <dir>` takes one small JSON
  config (pack source URLs, trusted key ids and SPKIs, `kbPackCheckHours`,
  allowed providers, origins and models, `kbToModel`, `redactionFloor`,
  `allowMcpBridge`, `caseRetentionDays`, and the force-install extension ID
  with its update URL) and writes, for Chrome and Edge: a Windows `.reg`, a
  macOS `.mobileconfig`, and the Linux JSON. It follows `ORG_POLICY.md` for
  paths and list encoding.
- `pnpm policy:check <file>` validates a policy JSON with the same
  `parseOrgPolicy` the extension uses, and prints each key and its effect.
  It warns that `preset.aiToken` is visible in `chrome://policy`.
- Tests: every generated output parses back to the same policy; an unknown
  key, a non-https source and a malformed key fail with a clear message;
  snapshots of the three formats with synthetic values.

### A2. The quality gate reads its questions from the pack host

Files: `.github/workflows/kb-packs.yml`, `tooling/scripts/kb/eval-kb.mjs`,
`publish-gate.mjs` (+ tests), `docs/release/KB_PACK_DELIVERY.md`.

- New repository variables `KB_QUESTIONS_URL_4X` and `KB_QUESTIONS_URL_5X`.
  The job downloads each with the publish token and pipes it to
  `kb:eval --questions -` (a new stdin option), so the file never touches
  disk or the repository. The D-KB8 thresholds decide the gate.
- When no URL is set, the gate is skipped visibly: the job summary says
  "Quality gate not active for 4.x: no question set", instead of silently
  passing.
- The summary shows metrics only: counts, Recall@1, Recall@3, "not covered"
  precision and recall, layer accuracy; never a question.
- Tests: a fake host serving a question set; the gate passes and fails on
  synthetic packs; the summary holds no question text; a missing URL gives
  the visible skip line.

### A3. Pipeline health

Files: `.github/workflows/kb-packs.yml`, new
`.github/workflows/kb-pack-health.yml`, `tooling/scripts/kb/pack-age.mjs`
(+ test), `KB_PACK_DELIVERY.md`.

- Failure alert. When the nightly job fails, open or update one GitHub issue
  labelled `kb-pipeline` with the run link and the failing step (no card
  text), using the workflow's own token with `issues: write`.
- Pack age. A second scheduled job reads each published pack's `builtAt`
  (via the publish token) and fails, with the same issue, when it is older
  than 48 hours.
- The 60-day rule. GitHub disables scheduled workflows in a public
  repository after 60 days without activity, and a schedule cannot keep
  itself alive. Document it, and recommend that the KB jobs run from a
  private repository that checks out this one (or from IT's scheduler); the
  SE-side "KB packs up to date" Preflight row stays as the second signal.
  This choice is the owner's.
- Tests: `pack-age.mjs` against fixtures (fresh, 49 hours old, unreadable);
  actionlint on both workflows.

### A4. Merging feedback for the KB owner

Files: new `tooling/scripts/kb/feedback-merge.mjs` (+ test), `package.json`
script `kb:feedback-merge`, `docs/development/kb-rag.md`.

- `pnpm kb:feedback-merge --in <folder> --out <folder>` reads every exported
  tracking-sheet CSV and questions file in a folder, removes duplicates
  (same case and card, or the same question), and writes one tracking sheet
  and one question set per version, with stable ids, plus a summary of
  counts by version and outcome.
- It never adds question text that the SE did not include, and writes
  nowhere inside the repository.
- Tests: overlapping exports from two synthetic SEs merge to the expected
  rows; question sets pass `kb:eval`.

### A5. Packaging and the update channel

Files: `.github/workflows/release.yml`, new
`tooling/scripts/publish-webstore.mjs` (+ test),
`docs/development/RELEASING.md`, `docs/security/ORG_POLICY.md`.

- An optional release step uploads the `-webstore` zip to the Chrome Web
  Store through its API and publishes it to the private audience. It runs
  only when the repository variable `CWS_PUBLISH` is `1` and the secrets
  (client id, client secret, refresh token) and the store ID are set;
  otherwise it is skipped with a visible note. Test it against a fake API.
- `ORG_POLICY.md` gains the force-install steps for Chrome and Edge
  (`ExtensionInstallForcelist` with the store's update URL), the self-hosted
  alternative for the pinned-ID zip, and the reminder that the Client and
  Studio teams must add the store ID to `externally_connectable.ids`.
- Without a Web Store account this package is partial: the step and docs
  ship, the first upload is the owner's.

## Acceptance checks

All must hold; paste the evidence in each PR body.

1. Every gap has a test that failed on `387f81cc` and passes now. List them
   as gap → test name.
2. Lookup routing (F1): every row of F1's table gives its result; the three
   E2E phrasings answer with a table and zero model requests on the fake
   4.x and 5.x clients.
3. Lookup messages and choices (F2, F3): duplicate names show distinct
   labels; an unknown version answers from the files present or asks once;
   a missing Client or unobserved file is said in words with Get the
   evidence.
4. Tool offering (F4): the four symptom phrasings offer `search_kb` within
   the 12-tool symptom budget; a how-to and a casual message do not.
5. One question (F5): a three-question reply shows one and folds two, with
   no text lost.
6. Demo routing choices (F9): the broad demo question shows E3's choices;
   both demo evaluations stay at 100%.
7. Accessibility (F6): axe passes in light and dark in the nine files, on
   data-filled surfaces.
8. Skills Export (F7): an export imports back unchanged, or the button is
   gone.
9. Release housekeeping (F8): the dry run stops on a dirty tree with the
   clear message; `RELEASING.md` has the CHANGELOG line.
10. Policy (A1): generated `.reg`, `.mobileconfig` and Linux JSON parse back
    to the same policy; `policy:check` catches the three bad cases.
11. Gate (A2): the gate runs from the pack host in the fake-host test; the
    summary shows metrics only; a missing URL is a visible skip.
12. Health (A3): a failed run opens or updates one `kb-pipeline` issue; a
    49-hour-old pack fails the age check; the 60-day rule is documented with
    the owner's choice listed.
13. Feedback merge (A4): overlapping exports merge to the expected rows and
    the merged questions pass `kb:eval`.
14. Packaging (A5): the upload step runs against the fake API and skips
    visibly without secrets; the force-install docs are in `ORG_POLICY.md`.
15. No regressions: every existing unit test and E2E passes (on `387f81cc`:
    4,348 unit tests; 77 E2E files); all `audit:*` scripts,
    `npm run preflight`, `npm run build` and the release dry run are green;
    no card text, question text or secret in any diff, log or job summary.

## How to test

```bash
pnpm install --frozen-lockfile && pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace && pnpm build
```

```bash
pnpm --filter @apty/browser-runtime exec vitest run src/apty/diagnosis/lookup.test.ts src/tools/tool-relevance.test.ts src/kb
```

```bash
pnpm --filter @apty/ui exec vitest run src/lib
```

```bash
npm run test:scripts
```

```bash
node node_modules/puppeteer/install.mjs && node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/lookup.e2e.test.mjs tooling/e2e/kb-unknown-setting.e2e.test.mjs tooling/e2e/kb-absent.e2e.test.mjs tooling/e2e/kb-freshness.e2e.test.mjs tooling/e2e/kb-learning.e2e.test.mjs tooling/e2e/get-evidence.e2e.test.mjs tooling/e2e/cases.e2e.test.mjs tooling/e2e/feedback.e2e.test.mjs tooling/e2e/case-host.e2e.test.mjs tooling/e2e/kb-choices.e2e.test.mjs
```

```bash
npm run test:e2e
```

```bash
npm run release:dry-run
```

Part A by hand, with synthetic values:

```bash
pnpm policy:generate --config tooling/scripts/policy/fixtures/example-config.json --out /tmp/apty-policy && pnpm policy:check /tmp/apty-policy/linux/apty-agent.json
```

```bash
pnpm kb:feedback-merge --in tooling/scripts/kb/fixtures/feedback-exports --out /tmp/apty-feedback
```

## Out of scope and owner items

Out of scope: dense vectors (E10's gate decides, on real packs); the
optional feedback upload to the pack host (it adds a network call, so the
owner must approve it first); K26 Parts T and E (they wait on read access to
apty-dap and apty-assist); changes to the Apty Client or Studio.

Owner and people items this prompt cannot do:

- Choose where the KB jobs run (a private repository or IT's scheduler)
  because of the 60-day rule.
- Add the production KB owner key to `KB_OWNER_PACK_KEYS`, or ship it by
  policy.
- Get the Chrome Web Store ID (W8) and the first upload; ask the Client and
  Studio teams to allow-list it.
- Host the packs and the question sets; set the repository secrets and
  variables.
- Rewrite the 13 skipped 5.x pages; write and calibrate the real question
  sets; run the real-pack regression grid.
- Run the Edge E2E and the SMOKE_TEST rows by hand; the 4.29.13 Client diff
  for `4X-BRIDGE.md`.
