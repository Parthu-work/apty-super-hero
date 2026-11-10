# KB-RAG PR #101 fixes (K21): bugs found in review

10 Nov 2026 · Apty Customer Success

**This is a complete, self-contained implementation prompt for a coding
agent.** Fix every bug below on the PR #101 branch, in the order given, until
every acceptance check in [Acceptance checks](#acceptance-checks) passes. Do
not stop at a plan, and do not skip a fix. Where a step cannot be done in your
environment (no apty-assist access, no Confluence token), do everything else,
mark that step partial, and say exactly what is left and the command that
finishes it.

- **Branch:** `claude/charming-knuth-g0d7ab` (PR #101, head `0ba7024`).
  Commit on this branch, one commit per fix, each green on its own. Do not
  open a new PR and never commit to main.
- **Base:** `origin/main` at `11d2200`. Merge the latest `origin/main` into
  the branch first if it has moved.
- **Status:** IN PROGRESS. See [Status](#status).
- Re-read this file after any context compaction; never guess scope.

Every bug here was reproduced on 10 Nov 2026 with the PR's own synthetic demo
packs (`pnpm kb:demo-pack`), so each one can be shown failing before it is
fixed. Real card text was never used and must never be used.

## Read first

1. `CLAUDE.md`, `AGENTS.md`, `docs/STATUS.md`.
2. [`FIXES.md`](FIXES.md) (K10 to K20, the prompt PR #101 implemented),
   [`MASTER.md`](MASTER.md) and [`decisions.md`](decisions.md). Their hard
   rules still apply.
3. `docs/development/kb-rag.md` as the PR left it.
4. The code each fix names. The main files:
   - `packages/agent-core/src/kb/search.ts`, `text.ts`, `stem.ts`,
     `synonyms.ts`, `index-set.ts` and their tests
   - `packages/browser-runtime/src/storage/kb-store.ts` and its test
   - `packages/browser-runtime/src/apty/diagnosis/widget-not-visible-4x.ts`,
     `content-not-visible-4x.ts`, `card-layers.ts`, `pack-kit.ts`, `types.ts`
     and their tests
   - `tooling/scripts/kb/eval-kb.mjs`, `build-demo-pack.mjs`,
     `fixtures/demo-cards.mjs`, `fixtures/demo-questions-4x.json`,
     `fixtures/demo-questions-5x.json` and their tests
   - `docs/development/kb-rag.md`, `docs/TROUBLESHOOTING.md`
5. apty-assist `player3.0/` for fix F4, if you can read it (clone
   aptyInc/apty-assist read-only next to this repository). If you cannot, F4
   takes its "no access" path.

## The bugs

Twelve bugs, F1 to F12. F1 to F4 give an SE a wrong or missing answer and
block the merge; F5 to F12 are smaller. The demo queries below are run against
the 4.x demo pack unless marked "both" (4.x and 5.x demo packs loaded, version
unknown).

| # | Bug | Reproduction (demo pack) | Today | Expected | Severity |
| --- | --- | --- | --- | --- | --- |
| F1 | The setting-name guard refuses real product and browser terms | "DEMO balloon does not appear on the Admin Portal page"; "DEMO hint text is cropped, the Service Worker shows nothing"; "I turned on Developer Mode and the DEMO player freezes the page" | not_covered / unknown_setting, missing "Admin Portal", "Service Worker", "Developer Mode" | ok, the balloon, hint and freeze cards first | High |
| F2 | A stub wins on one generic shared word | "widgt not showing" | stub for the analytics stub (4012), coverage 0.42 | not_covered (or the widget card, once F5 lands) | High |
| F3 | 4.x causes cite the card tree's root page, not a card | Any 4.x verdict except app-urls.json | 9 of 12 causes use CARD_4X_TREE (1509720081), so no card text shows and the link opens an index | Each cause cites a 4.x card page id | High |
| F4 | 4.x rules claim "from code" though no code was read | FOUR_X_VERIFIED_ON in widget-not-visible-4x.ts | "4.x code, apty-assist player3.0 (commit not pinned…); from code, not runtime-verified" | Either checked against apty-assist with a pinned commit, or a line that says the rule is from a description, not code | High |
| F5 | Short typos never match | "balon not apearing"; "widgt not showing" | no_match (stemming shortens the typo below the 6-letter fuzzy minimum) | "DEMO baloon does not apear" and "apearing" find the balloon card | Medium |
| F6 | The -er and -est rule merges unrelated words | stem("player"), "header", "container", "trigger", "browser", "server", "filter" | play, head, contain, trig, brows, serv, filt | Unchanged, except listed comparatives (slower to slow) | Medium |
| F7 | "icon" is a launcher synonym; "again" is a repeat synonym | "the help icon is gone" | ok, beacon card (4010) | Widget card first, or not_covered if none exists | Medium |
| F8 | Pack replace and migration use two transactions | kb-store.ts replace(), migrate() | A stop between the two writes loses the SE's previous working pack | Both records written in one read-write transaction | Low |
| F9 | The version merge compares raw BM25 scores from separate indexes | "both": any query with good matches in each pack | The pack with fewer chunks (higher idf) takes the top slots | Merge by rank within each pack | Low |
| F10 | A tooling test fails with an unhelpful error when browser-runtime is not built | `node --test tooling/scripts/kb/*.test.mjs` on a clean checkout after only building agent-core | ERR_MODULE_NOT_FOUND … browser-runtime/dist/src/kb/kb-intent.js | "Build @apty/browser-runtime first", like the agent-core message | Low |
| F11 | KB docs still send how-to questions to Ask Dapty | docs/development/kb-rag.md:304, docs/TROUBLESHOOTING.md:179 | "how-tos belong to Ask Dapty" | Point to the Apty docs or the KB owner; Ask Dapty has no endpoint and failed its card test | Low |
| F12 | Code comments quote real card titles | widget-not-visible-4x.ts:36, widget-not-visible.ts:6 (and any others) | A real card title in a comment | Page id plus the topic in your own words (hard rule 1) | Low |

The Ask Dapty check (the Agent checking the widget's chat, in
TROUBLESHOOTING.md lines 153 to 167) is a separate feature. Leave it alone.

## Hard rules

1. No KB content in the repository, ever. Tests and fixtures use synthetic
   DEMO cards only. Real page ids are fine; real card titles, symptom lines
   and text are not, including in comments, commit messages and the PR body.
   `npm run audit:kb-pack` stays green.
2. Test first. Every fix starts with a test that fails on `0ba7024`; commit it
   with the fix. Name each test after its bug (`F1: …`). Never skip, weaken
   or delete an existing test. Where a fix changes intended behaviour (F4's
   version line), replace the old assertion with the new one in the same
   commit and say why in the message.
3. Deterministic. The same packs and query give the same ranking, coverage
   and status; ties by page id, then layer (P8).
4. No new permission, host, network call or runtime dependency. agent-core
   stays platform-free; `npm run audit:architecture` passes.
5. Recalibrate after ranking changes. F2, F5, F6 and F7 change scores. After
   them, rebuild both demo packs, re-run `kb:eval --calibrate --by-category`
   on the demo questions, write the new `--coverage-min` and
   `--coverage-min-idf` into `build-demo-pack.mjs`, and record before and
   after numbers (ids and metrics only) in the commit.
6. Every demo question that passes today still passes, in both demo question
   sets, unless this prompt says it should change. Add each reproduction in
   "The bugs" as a new demo question with its category.
7. New UI strings in both `en.json` and `zh.json`.
8. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies`, `npm run audit:architecture`,
   `npm run audit:tools`, `npm run audit:kb-pack`, and the E2E files you
   touched. Paste the results into the final PR comment.

## Work packages

Order: F12, F10, F3, F4, F1, F2, F5, F6, F7, then recalibrate (hard rule 5),
then F8, F9, F11. F12 and F10 come first because they are small and make the
rest safe to test.

### F12. No card titles in code comments

Files: every `.ts`, `.tsx` and `.mjs` file under `packages/`, `apps/` and
`tooling/`.

- Replace each comment that quotes a card title with the page id and a short
  description in your own words. Example:
  `/** 4.x mirror card for the app-urls.json response (A4PKH 1509786000). */`.
- Known cases: `widget-not-visible-4x.ts:36`, `widget-not-visible.ts:6`. Find
  the rest: search for comments that contain what it means, does not, is not,
  not showing or not appearing next to a page id, and read each.
- Add a check to `tooling/scripts/kb/check-no-kb-pack.mjs` (or a sibling
  audit run by `audit:kb-pack`): a comment holding a quoted phrase of 4 or
  more words on the same line as a 10-digit page id fails the audit. Test it
  with a synthetic file that fails and one that passes.

### F10. Clear error when a tooling test needs an unbuilt package

Files: `tooling/scripts/kb/build-demo-pack.test.mjs` (and any other
`.test.mjs` importing from a `dist/` folder).

- Load browser-runtime modules through a helper like `loadAgentCore` in
  `eval-kb.mjs`, which throws "Build @apty/browser-runtime first (npm run
  build)" on ERR_MODULE_NOT_FOUND.
- Test: point the helper at a missing path and assert the message.

### F3. Every 4.x cause cites a 4.x card

Files: `widget-not-visible-4x.ts`, `content-not-visible-4x.ts`,
`card-layers.ts`, their tests.

- Remove `CARD_4X_TREE` as a `cardPageId`. The tree root (1509720081) is an
  index page, not a card, and is never in a pack, so the verdict shows no
  card text.
- Confirm what each rule detects by reading its code, then map it to a card in
  space A4PKH. Use this table (ids only; the topics are descriptions, not
  titles):

  | Rule | Detects (confirm in code) | Card page id | Card topic |
  | --- | --- | --- | --- |
  | W4X-00, W4X-01 | app-urls.json missing, failed or empty | 1509786000 | app-urls.json mirror card |
  | W4X-02 | No environment pattern matches the address | 1509785878 | Widget missing on the whole application |
  | W4X-03 | An invalid regex URL pattern | 1509786000 | app-urls.json mirror card |
  | W4X-04, W4X-05 | Player or widget switched off in app-data.json | 1509785878 | Widget missing on the whole application |
  | C4X-00, C4X-01 | flow.json missing, failed or empty | 1509786022 | flow.json mirror card |
  | C4X-02, C4X-03 | Flow not published, or hidden from the widget | 1509720308 | Workflow missing from the widget list |
  | C4X-04 | Every segment the flow needs is inactive | 1509753345 | Content shown to the wrong users or missing for some |
  | C4X-05 | A rule a segment needs is missing from rules.json | 1509753805 | rules.json mirror card |
  | C4X-06 | A problem in the flow's own steps file | 1509622325 | flow-ID.json mirror card |

- If the code shows a rule detects something other than the "Detects" column,
  pick the closer card from this list and note it in the commit: 1510080515
  (environment URL too specific), 1509753369 (works in Test, not Production),
  1509785720 (widget missing for some users), 1509753154 (published in Admin,
  never reaches the player), 1509786077 (segments.json mirror), 1509753709
  (workflow starts, no balloon). Never use a "start here" routing card
  (1510080539, 1509785663) or the tree root.
- Put the ids in one exported `CARD_4X` constant map keyed by rule id, so a
  reviewer can check the mapping in one place, and set each cause's layer in
  `card-layers.ts` (layer 3 for a mirror card, layer 1 for a settings cause).
- Add `KNOWN_4X_CARD_IDS`: the 108 non-routing card page ids under 1509720081
  listed in Appendix A, as a constant (ids only). The KB owner refreshes it
  when cards are added.
- Tests: every W4X-* and C4X-* cause has a `cardPageId` in
  `KNOWN_4X_CARD_IDS`; none equals 1509720081 or a routing card; with a 4.x
  demo pack loaded that contains a card with the mapped id, the verdict shows
  that card's excerpt (unit test on the verdict builder, E2E extension of
  `visibility-check.e2e.test.mjs`).
- Ask the KB owner to confirm the mapping in the PR comment.

### F4. Say honestly where the 4.x rules come from

Files: `widget-not-visible-4x.ts`, `content-not-visible-4x.ts`, `pack-kit.ts`
(the 4.x markers), their tests, `docs/development/kb-rag.md`,
`docs/integrations/apty/README.md`.

If you can read apty-assist:

- Pin a commit. For each rule, open the file it cites, confirm the behaviour,
  and replace "to be confirmed" with the exact file and line.
- Where the code disagrees with the rule, change the rule to match the code
  and add a test with a synthetic file that shows the difference.
- Version line: "4.x code, apty-assist `<commit>` (`<player version>`); from
  code, not runtime-verified".

If you cannot (the PR's situation):

- Version line: "4.x behaviour as described in FIXES.md K14, not yet checked
  against apty-assist code; not runtime-verified". It must not say "from
  code".
- Cap every 4.x finding's confidence one step below what the same 5.x rule
  gives ("likely" becomes "possible").
- Add an open item to `docs/STATUS.md`: "4.x check packs: confirm each rule
  against apty-assist and pin the commit", with the list of rules.
- Mark F4 partial in this file's status.

Tests: the version line matches the chosen form exactly; no 4.x finding
contains the words "from code" unless a commit is pinned.

### F1. The setting-name guard only fires on setting names

Files: `packages/agent-core/src/kb/text.ts` (`namedPhrases`,
`NOT_A_SETTING`), `search.ts` (`assess`, both search paths), `index-set.ts`,
tests.

The guard exists to stop invented settings ("Widget Activation"). It must not
refuse product, browser or customer-application names.

- **When a phrase is checked.** Only a quoted phrase, or a Title Case run of
  two or more words that sits within three words of a setting cue: setting,
  settings, toggle, option, checkbox, switch, flag, field, enable, disable,
  turn on, turn off, set, configure. Other Title Case runs are not checked.
- **Where it is looked for.** In the text of every card in every pack being
  searched (title, symptom, all chunks), not only the top card. A phrase found
  anywhere is not unknown. Build this phrase lookup once per index.
- **Never a setting.** Replace the word list `NOT_A_SETTING` with
  phrase-aware lists: browser and platform terms (Developer Mode, Service
  Worker, Preserve Log, Inspect Views, Network Tab, Console, Elements,
  DevTools, Chrome, Edge, Google, Microsoft, Windows, macOS) and common
  customer applications (Salesforce, Lightning, Workday, SAP, ServiceNow,
  Oracle, Dynamics, SuccessFactors). A run made only of these is never
  checked.
- The `unknown_setting` result still lists `missingPhrases`.
- Tests (demo pack): "Admin Portal", "Service Worker" and "Developer Mode"
  questions from "The bugs" return ok with the right card first; "where is
  the Widget Activation toggle" and "turn on the Allowed Domains setting"
  still return `unknown_setting` with the phrase; a quoted invented phrase
  ("the 'Smart Sync' option") returns `unknown_setting`; a demo question
  naming a phrase that exists only in a non-top card returns ok.

### F2. A stub must match the question, not one generic word

Files: `search.ts` (`createV2Index`, the `stubFirst` choice), `index-set.ts`
(the cross-pack stub choice), `eval-kb.mjs` (calibration), tests.

"widgt not showing" returned the analytics stub because "show" matched its
symptom and the typo matched nothing. Coverage was 0.42 against a calibrated
minimum of 0.25.

- A stub wins only when all of these hold:
  1. Its score beats the top full card, as today.
  2. Its own coverage reaches `max(settings.min, 0.5)`. A stub has no layer
     text, so its title and symptom must carry the match.
  3. It matches at least two query terms with idf of at least `minIdf`, or
     every such term when the question has only one.
  4. At least one matched term is not a generic symptom word. Define
     `GENERIC_SYMPTOM_TERMS` (stemmed): show, appear, work, load, open,
     display, see, missing, not, never, error, issue, problem, page, user.
- Otherwise drop the stub and decide on the full cards alone (ok or
  not_covered).
- Apply the same rule in `index-set.ts` when the best result across packs is
  a stub.
- Calibration floor. `kb:eval --calibrate` gains `--coverage-min-floor`
  (default 0.35) and never prints a `--coverage-min` below it. Print a
  warning when the best Youden J sits below the floor.
- Tests (demo pack): "widgt not showing" is not stub; "DEMO analytics events
  missing in the dashboard" is still stub (4012); a question sharing only
  "show" with a stub's symptom is not_covered; the floor holds in
  calibration.

### F5. Short typos match

Files: `search.ts` (MiniSearch fuzzy options and `approximate` in
`corpusOf`), `text.ts`, tests.

Stemming runs before the fuzzy check, so "apearing" becomes "apear" (5
letters) and loses fuzzy matching, which starts at 6.

- Decide fuzzy eligibility on the word as typed, not on its stem: 5 to 7
  letters allow 1 edit, 8 or more allow 2. Words that exist in the vocabulary
  exactly, and words of 4 letters or fewer, are never fuzzy-matched, as
  today.
- Compare the typed word with the card's words before stemming as well as
  after: keep an unstemmed vocabulary next to the stemmed one, built once per
  index. Feed both into MiniSearch (for ranking) and `approximate` (for
  coverage) in the same way, so ranking and coverage agree.
- A fuzzy-only match still weighs 0.5 in coverage.
- Tests (demo pack): "DEMO baloon does not apear" and "the balloon is not
  apearing on the DEMO field" rank the balloon card (4002) first; "widgt not
  showing" no longer matches through "show" alone (it reaches a widget card if
  the demo pack has one, else not_covered); "kubernetes pod CrashLoopBackOff"
  and "how do I configure SAML SSO" stay not_covered; add a typo demo question
  per pack.

### F6. The stemmer leaves nouns alone

Files: `packages/agent-core/src/kb/stem.ts`, `stem.test.ts`.

- Remove the general -er and -est rule. Strip them only for words on an
  explicit list of comparatives and superlatives: slow, fast, late, early,
  large, big, small, old, new, long, short, high, low, wide, narrow, dark,
  light, quick, easy, hard (with their -er and -est forms, and doubled
  consonants such as bigger).
- Tests: add these pairs to the table: player, header, container, trigger,
  browser, server, filter, layer, marker, banner, owner, viewer, folder,
  number, user, order, error stay unchanged; slower and slowest give slow;
  bigger gives big; later gives late (or the same stem as late).

### F7. Synonym groups that do not collide

Files: `packages/agent-core/src/kb/synonyms.ts`, `search.test.ts`, demo
questions.

- Remove "icon" from the launcher group. Add a widget group: widget, help
  icon, help panel, help widget, self-help.
- Replace "again" in the repeat group with the phrases "again and again",
  "shows again", "appears again". The bare word is too common.
- Add a collision test for every group: one question that uses a member in
  its ordinary sense must not rank the group's card first. Required cases:
  "the help icon is gone" (not a launcher or beacon card), "I tried again and
  the DEMO balloon does not appear" (not a repeat card), "the DEMO button on
  the form is disabled" (not a launcher card unless the demo pack has a
  matching button card).

### Recalibrate

After F2, F5, F6 and F7: rebuild both demo packs, run
`kb:eval --calibrate --by-category` on each demo question set, update
`build-demo-pack.mjs` with the printed values, and record before and after
Recall@1, Recall@3, MRR, not-covered precision and recall, and layer accuracy
per pack in the commit message.

### F8. One transaction per pack write

Files: `packages/browser-runtime/src/storage/kb-store.ts`, `kb-store.test.ts`.

- Add `records.putAll(entries)` and `records.moveAll(puts, deletes)` that run
  in a single readwrite transaction and resolve on complete, reject on error
  or abort.
- `replace()` writes `pack:<v>` and `meta:<v>` with `putAll`. `migrate()`
  writes the 5.x pair and deletes the legacy keys with `moveAll`. `remove()`
  deletes both keys in one transaction.
- Tests with the existing fake IndexedDB: make the second write fail; the
  previous pack for that version still loads, and a failed migration leaves
  the legacy pack loadable.

### F9. Merge versions by rank, not raw score

Files: `packages/agent-core/src/kb/index-set.ts`, `index-set.test.ts`.

- BM25 scores from separate indexes are not comparable. When more than one
  pack returns ok, merge by rank: take each pack's hits in its own order and
  interleave them, round-robin. Pack order: the tab's version, then common,
  then any other version, then page id.
- Keep `mixedVersions`, and the rule that a statement from two versions is
  never merged into one instruction.
- Tests: two synthetic packs of very different sizes, each with one strongly
  matching card: both cards appear in the top 2, in pack order; the result is
  the same on every run.

### F11. KB docs no longer point to Ask Dapty for how-tos

Files: `docs/development/kb-rag.md` (line 304), `docs/TROUBLESHOOTING.md`
(line 179), and any KB-related string in `en.json` and `zh.json` that sends
how-to questions to Ask Dapty.

- Replace "how-tos belong to Ask Dapty" with: "The KB answers symptoms, not
  how-to questions (D-KB1); for how to configure something, use the Apty
  product documentation or ask the KB owner."
- Do not change the Ask Dapty check text or its strings.
- Test: an i18n parity test still passes; grep in the PR comment shows no KB
  how-to line naming Ask Dapty.

## Acceptance checks

All must hold; paste the evidence in a PR #101 comment.

1. Each of F1 to F12 has a test that failed on `0ba7024` and passes now. List
   them as `F<n> → test name`.
2. Every reproduction in "The bugs" gives its "Expected" result in the probe
   script ("How to test").
3. No 4.x cause cites 1509720081 or a routing card; every 4.x `cardPageId` is
   in `KNOWN_4X_CARD_IDS`; the KB owner has confirmed the mapping in the PR,
   or the PR comment asks them to.
4. F4 is done with a pinned apty-assist commit, or marked partial with the
   honest version line, the lowered confidence and the STATUS.md item.
5. Both demo question sets: every question that passed before still passes;
   each new F question passes; before and after metrics are recorded; the
   printed `--coverage-min` is at least the floor.
6. All existing tests still pass: agent-core KB (102 on `0ba7024`), builder
   and eval (39), browser-runtime KB, diagnosis, HAR and capture (1,113), and
   every KB, visibility, HAR and Apty Client E2E file.
7. `npm run preflight`, `npm run build`, `npm run lint:dependencies`,
   `npm run audit:architecture`, `npm run audit:tools`,
   `npm run audit:kb-pack` (with the F12 comment check) and
   `npm run report:request-size` are green; the request budget still holds.
8. No real card title, symptom or text anywhere in the diff, commit messages
   or PR comments.
9. This file's status is DONE, or names what is partial and the command or
   access that finishes it.

## How to test

Build order matters: the tooling tests import agent-core and browser-runtime
from their `dist/` folders.

```bash
git checkout claude/charming-knuth-g0d7ab && pnpm install --frozen-lockfile
pnpm --filter @apty/agent-core run build && pnpm --filter @apty/browser-runtime run build
pnpm --filter @apty/agent-core exec vitest run src/kb
pnpm --filter @apty/browser-runtime exec vitest run src/kb src/tools/kb.test.ts src/tools/tool-relevance.test.ts src/storage/kb-store.test.ts src/apty
node --test tooling/scripts/kb/*.test.mjs
node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/knowledge-base.e2e.test.mjs tooling/e2e/kb-answer.e2e.test.mjs tooling/e2e/kb-matches.e2e.test.mjs tooling/e2e/visibility-check.e2e.test.mjs tooling/e2e/har-check.e2e.test.mjs tooling/e2e/apty-client.e2e.test.mjs
```

Probe script. Builds both demo packs outside the repository and prints the
result for each reproduction. Run it on `0ba7024` first (the "Today" column),
then after each fix. Rebuild agent-core before each run.

```bash
mkdir -p ~/apty-kb && pnpm kb:demo-pack --version 4.x --out ~/apty-kb/demo-4.x.json && pnpm kb:demo-pack --version 5.x --out ~/apty-kb/demo-5.x.json
```

```js
// Save as ~/apty-kb/probe.mjs and run: node ~/apty-kb/probe.mjs <repo path>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
const repo = process.argv[2] ?? ".";
const { resolve } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const core = await import(pathToFileURL(resolve(repo, "packages/agent-core/dist/src/index.js")).href);
const sha256 = async (t) => createHash("sha256").update(t).digest("hex");
const load = async (v) => {
  const r = await core.parseKbPack(readFileSync(`${homedir()}/apty-kb/demo-${v}.json`, "utf8"), { sha256 });
  if (!r.ok) throw new Error(r.code);
  return r.pack;
};
const p4 = await load("4.x"), p5 = await load("5.x");
const one = core.createKbIndexSet([p4]), both = core.createKbIndexSet([p4, p5]);
const cases = [
  ["F1", one, "DEMO balloon does not appear on the Admin Portal page"],
  ["F1", one, "DEMO hint text is cropped, the Service Worker shows nothing"],
  ["F1", one, "I turned on Developer Mode and the DEMO player freezes the page"],
  ["F1", one, "where is the Widget Activation toggle"],
  ["F2", one, "widgt not showing"],
  ["F2", one, "DEMO analytics events missing in the dashboard"],
  ["F5", one, "DEMO baloon does not apear"],
  ["F5", one, "balon not apearing"],
  ["F5", one, "kubernetes pod CrashLoopBackOff"],
  ["F7", one, "the help icon is gone"],
  ["F7", one, "I tried again and the DEMO balloon does not appear"],
  ["F9", both, "DEMO flow skips the second step"],
];
for (const [bug, idx, q] of cases) {
  const r = idx.search(q, { onePerCard: true });
  const hits = r.hits.map((h) => `${h.chunk.pageId}#L${h.chunk.layer}(${h.aptyVersion})`).join(" ");
  console.log(`${bug} | ${q}\n     ${r.status}${r.reason ? "/" + r.reason : ""} cov=${r.coverage.toFixed(2)} ${r.missingPhrases ? JSON.stringify(r.missingPhrases) : ""} ${hits}${r.card ? " stub:" + r.card.pageId : ""}`);
}
console.log("F6", ["user", "player", "header", "container", "trigger", "browser", "slower", "bigger"].map((w) => `${w}->${core.stem(w)}`).join(" "));
```

Manual check in Chrome after all fixes: load `apps/browser-extension/dist`
unpacked, import both demo packs, and with no AI key ask the F1, F2, F5 and F7
questions in the side panel. Each must show what the "Expected" column says.
Then run a 4.x widget check on the synthetic 4.x fixture tenant and confirm
each cause shows a card excerpt (F3) and the new version line (F4).

## Out of scope

- The real-card evaluation on 4.x and 5.x packs (needs the KB owner's
  Confluence token; FIXES.md 7.3). Leave the commands in the PR comment.
- Dense vectors (K7), and a 4.x port of element-not-found and page-readiness.
- The case record, the assembled send-support bundle, the wrong-card feedback
  log, and pack signing with expiry. These come in a separate prompt.
- The 4.x Client bridge in apty-assist (K15 C).
- Any change to the Ask Dapty check.

## Appendix A: 4.x card page ids for KNOWN_4X_CARD_IDS

The 108 cards under the 4.x RAG Answer Cards root (A4PKH, 1509720081) as of
9 Nov 2026, excluding the routing ("start here") pages. Ids only.

```text
1509621894,1509621916,1509621940,1509621964,1509622016,1509622074,1509622098,1509622122,1509622146,1509622183,1509622325,1509622379,1509622403,1509622427,1509622497,1509622521,1509622545,1509622661,1509622685,1509622709,1509720182,1509720220,1509720244,1509720266,1509720308,1509720330,1509720372,1509720396,1509720420,1509720504,1509720586,1509720632,1509720727,1509720779,1509720869,1509720893,1509720943,1509752918,1509752943,1509752967,1509753013,1509753037,1509753062,1509753086,1509753130,1509753154,1509753202,1509753226,1509753297,1509753321,1509753345,1509753369,1509753415,1509753439,1509753476,1509753555,1509753579,1509753647,1509753685,1509753709,1509753734,1509753781,1509753805,1509753827,1509753849,1509753895,1509753919,1509785687,1509785720,1509785758,1509785782,1509785806,1509785830,1509785854,1509785878,1509785934,1509785978,1509786000,1509786022,1509786044,1509786077,1509786099,1509786123,1509786160,1509786206,1509786230,1509786304,1509786328,1509786396,1509786446,1509786470,1509786494,1509786532,1509786620,1509786644,1509786677,1509786701,1509786726,1509786770,1509786794,1509786847,1509786871,1510080515,1510146050,1510146074,1510244353,1510244377,1510277135
```

Routing pages, never a `cardPageId`: 1509785663, 1509752991, 1509753248,
1509786556, 1509753625, 1509622733, 1509786748, 1509622784, 1509786896,
1510080539.

## Status

IN PROGRESS: F12, F10, F3, F1, F2, F5, F6 done; F4 partial.

| Fix | State |
| --- | --- |
| F12 | done |
| F10 | done |
| F3 | done (KB owner to confirm the mapping) |
| F4 | **partial**: no read access to aptyInc/apty-assist here. Done: the honest version line, 4.x confidence capped at "possible", the STATUS.md open item. Left: pin a `player3.0` commit and confirm each W4X/C4X rule (list in docs/STATUS.md), then set `FOUR_X_VERIFIED_ON` to "4.x code, apty-assist `<commit>` (`<player version>`); from code, not runtime-verified" and `FOUR_X_CONFIDENCE` to "likely". Needs: `git clone git@github.com:aptyInc/apty-assist.git ../apty-assist` |
| F1 | done |
| F2 | done |
| F5 | done |
| F6 | done |
| F7 | not started |
| Recalibrate | not started |
| F8 | not started |
| F9 | not started |
| F11 | not started |
