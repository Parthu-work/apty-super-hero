# KB-RAG K24: application names and page places do not lower coverage

11 Nov 2026 · Apty Customer Success

**Status: IN PROGRESS** (K24-1 done; K24-2 next)

**This is a complete, self-contained implementation prompt for a coding
agent.** Do every work package below, in order, until every acceptance check
passes. Do not stop at a plan, and do not skip a package. Where a step cannot
be done in your environment, do everything else, mark that step partial, and
say exactly what is left.

- **Base:** origin/main at `239ea68` (2026-11-10) or later. It holds PR #101,
  K21 and K22.
- **Branch:** `claude/kb-rag-k24-coverage-names`; one commit per work
  package, each green on its own; one PR against main. Never commit to main.
  *As run:* the coding session was assigned the branch
  `claude/inspiring-einstein-kuwguk` and may push only there, so the work is
  on that branch; everything else is as written.
- **Independent of K23** (FIXES-K23.md, PR #105, signed packs). K24 does not
  change the pack schema, the builder's signing or import, so the two can run
  in parallel. If K23 lands first, merge main into this branch before the
  last commit and re-run every check.
- Save this prompt as `docs/tasks/kb-rag/FIXES-K24.md` in the first commit
  and keep its status line current.
- Re-read this file after any context compaction; never guess scope.

This is a small change in one function (`assess` in
`packages/agent-core/src/kb/search.ts`) plus tests, demo questions and a
recalibration.

## The bug

A question that the KB covers becomes "not covered" when the SE names the
customer's application or where on it the problem is. SEs do this in almost
every question.

**Cause.** `assess` computes `coverage = Σ idf(t)·match(t) / Σ idf(t)` over
every query term. A word the KB has never seen gets the highest weight,
`ln(1 + N)`, and matches nothing, so it drags coverage down hard. That is
right for off-topic words ("kubernetes", "saml") but wrong for application
names and page-location words. `NOT_A_SETTING` in `text.ts` already lists the
application and browser names, but only the setting-name guard uses it;
coverage does not.

Reproduction on `239ea68`, 4.x demo pack (calibrated min 0.35, minIdf 2.024):

| Question | Today | Expected |
| --- | --- | --- |
| DEMO balloon missing | ok, coverage 0.49, balloon card 4002 first | unchanged |
| DEMO balloon missing on the ServiceNow incident form | not_covered / low_coverage, 0.17 | ok, 4002 first |
| Salesforce Lightning page, DEMO balloon missing | not_covered / low_coverage, 0.29 | ok, 4002 first |
| DEMO balloon missing on the SuccessFactors page | ok, 0.38 (just above the minimum) | ok, 4002 first, coverage at least as high as "DEMO balloon missing" |
| DEMO balloon does not appear on the field in Workday | ok, 0.70 | unchanged or higher |
| kubernetes pod CrashLoopBackOff | not_covered / no_match | unchanged |
| how do I configure SAML SSO | not_covered / no_match | unchanged |
| where is the Widget Activation toggle | not_covered / unknown_setting | unchanged |

The fix must lift the first group without letting off-topic questions
through. Every "unchanged" row is a guard against that.

Three more guards, which must stay not_covered: "Salesforce licence price for
50 users" (0.16 today), "Workday payroll tax rules" (0.27) and the existing
5.x demo question d5-n9, "chrome is not opening on my laptop".

*As run:* on a fresh `239ea68` build the probe gives 0.12 and 0.19 for those
two guards (not 0.16 and 0.27); both are not_covered either way.

**Prototype result** (11 Nov 2026, on a scratch build of `239ea68`, not
committed). Skipping unmatched context words, with the K24-1 list minus
browser names, gave: the ServiceNow row 0.49 ok, the Salesforce Lightning row
0.58 ok, the SuccessFactors row 0.58 ok, the Workday row 1.00 ok; the three
guards above and kubernetes, SAML and Widget Activation unchanged; both demo
evaluations unchanged (4.x: Recall@3 100%, not-covered precision and recall
100%; 5.x: the same). With browser names in the list, d5-n9 became covered,
which is why they are excluded. Reproduce these numbers before and after your
change.

## Hard rules

1. **Context words can only help, never hurt.** A context word (K24-1)
   counts toward coverage when the card holds it, and is left out of the
   total when it does not. It must never lower a card's coverage.
2. **Off-topic stays off-topic.** Unknown words that are not context words
   keep today's full weight. Do not cap or drop unknown words in general:
   that is how "kubernetes" and "saml" are caught.
3. **No KB content in the repository.** Tests and demo questions use
   synthetic DEMO cards only; the context-word list holds product and generic
   words, never card text. `npm run audit:kb-pack` stays green.
4. **No pack schema change.** The list lives in code, so this stays
   independent of K23. A per-pack list is out of scope.
5. **Deterministic.** Same packs and query give the same coverage, status and
   ranking.
6. **Test first.** Each change starts with a test that fails on `239ea68`.
   Never skip, weaken or delete a test. Every demo question that passes today
   still passes.
7. agent-core stays platform-free and dependency-free.
8. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies`, `npm run audit:architecture`,
   `npm run audit:tools`, `npm run audit:kb-pack`, and the KB E2E files.
   Paste the results into the PR body.

## Work packages

Order: K24-1, K24-2, K24-3, K24-4, K24-5.

### K24-1. One list of context words

Files: `packages/agent-core/src/kb/text.ts` (+ test).

- Export `CONTEXT_WORDS`: a set of stemmed single terms, built with the same
  `analyze` the index uses, from two groups:
  - **Customer applications** (move `CUSTOMER_APPLICATIONS` here and extend
    it): Salesforce, Lightning, Workday, SAP, S/4HANA, Fiori, SuccessFactors,
    Ariba, Concur, ServiceNow, Oracle, NetSuite, Dynamics, D365, Coupa, Veeva,
    Jira, Confluence, Zendesk, HubSpot, Epic, Cerner, Guidewire, Kronos, UKG,
    ADP.
  - **Not browser or platform names.** Leave Chrome, Edge, Google,
    Microsoft, Windows and macOS out of this list on purpose: skipping
    "chrome" lets the off-topic test "chrome is not opening on my laptop"
    (5.x demo question d5-n9) through, which a prototype of this change
    showed. They stay in `NOT_A_SETTING` for the guard only.
  - **Page-location words:** page, screen, form, record, incident, ticket,
    case, module, view, tab, window, section, list, grid, table, tile, home,
    dashboard, portal, app, application, site, tenant, org.
- Keep `NOT_A_SETTING` working exactly as today: build it from the customer
  applications and `BROWSER_TERMS`, as today (the guard must not change), not
  from the page-location words.
- Multi-word names ("S/4HANA", "Dynamics 365") become their stemmed terms;
  check that `analyze` yields what you expect and test it.
- Tests: every listed word is in `CONTEXT_WORDS` after stemming;
  `NOT_A_SETTING` is unchanged (snapshot it before you change anything).

### K24-2. Coverage ignores context words a card does not hold

Files: `packages/agent-core/src/kb/search.ts` (`assess` in the corpus
helper), `search.test.ts`.

- In `assess`, for each query term t in `CONTEXT_WORDS`:
  - if the card holds t (exactly, by synonym or by typo, the same match logic
    as today), count it as today: `weighted += idf(t)·match`,
    `total += idf(t)`;
  - otherwise, skip it: add nothing to `weighted` or `total`, and do not
    count it in `strongQueryTerms`.
- Every other term is unchanged (hard rule 2).
- If every query term is a context word the card does not hold, coverage is
  0 and the result is `no_match`, as today for a question with no matching
  terms.
- Return the skipped terms as `contextIgnored: string[]` on the assessment,
  and pass them through `KbSearchResult` (optional field) so the eval and the
  search_kb tool can show them. In search_kb's result text, say nothing new
  to the model; the field is for diagnostics.
- Tests (synthetic): every row of "The bug" gives its "Expected" result; a
  card that does mention an application name gets credit for it (a synthetic
  card mentioning a context word ranks above an otherwise equal card that
  does not); coverage never goes down for any existing demo question (compare
  before and after per question); `contextIgnored` lists exactly the skipped
  words.

### K24-3. Demo questions for names and places

Files: `tooling/scripts/kb/fixtures/demo-questions-4x.json`,
`demo-questions-5x.json`, and the synthetic set the CI eval uses.

- Add a `names` category with at least six questions per pack:
  - four covered questions that add an application name or page-location
    words to an existing covered symptom (use the reproduction rows, and two
    more of your own);
  - two not-covered questions that include an application name, for example
    "Salesforce licence price for 50 users" and "Workday payroll tax rules".
    They must stay not_covered.
- Every existing question keeps its expected result.

### K24-4. Recalibrate

Files: `tooling/scripts/kb/build-demo-pack.mjs`.

- Rebuild both demo packs, run `kb:eval --calibrate --by-category` on each
  demo question set, and write the printed `--coverage-min` and
  `--coverage-min-idf` into `build-demo-pack.mjs` (the floor of 0.35 from K21
  still applies).
- Record before and after Recall@1, Recall@3, MRR, not-covered precision and
  recall, layer accuracy, and the names category's numbers, per pack, in the
  commit message (ids and metrics only).
- **Layer-4 check** (measure, do not change ranking): add to
  `kb:eval --by-category` the share of questions without a layer hint whose
  first hit is layer 4 (the support layer). Report it for both demo packs in
  the PR. On `239ea68`, "DEMO player freezes the page on Workday" returns 4003
  layer 4 first; this may only be a demo-text artifact, so the real-card
  evaluation decides whether ranking changes.

### K24-5. Documentation

Files: `docs/development/kb-rag.md` (the coverage section and the
troubleshooting table), `docs/STATUS.md`, `CHANGELOG.md`.

- Coverage section: the context-word rule (a word that names the customer's
  application or a place on the page counts only when the card holds it),
  the two groups, why browser names are not in the list, and that unknown
  words still count in full.
- Troubleshooting row: "A question with an application name is not covered"
  → the name is missing from `CONTEXT_WORDS` → add it in `text.ts` (product
  names only, never card text) and re-run the eval.
- STATUS and CHANGELOG entries; this file's status set to DONE.

## Acceptance checks

All must hold; paste the evidence in the PR body.

1. Every row of "The bug" and the three extra guards give their expected
   result in the probe script, with the coverage values printed.
2. Each work package has a test that failed on `239ea68` and passes now; list
   them as K24-n → test name.
3. No existing demo question changes its result, and no question's coverage
   goes down (a per-question before and after table in the PR, ids and
   numbers only).
4. Both demo evaluations after recalibration: Recall@3 100%, not-covered
   precision and recall 100%, layer accuracy unchanged or higher; the new
   `names` category passes in both packs; the printed `--coverage-min` is at
   least 0.35.
5. `NOT_A_SETTING` is unchanged (its snapshot test passes), and the
   setting-name guard behaves exactly as before: "Widget Activation" and
   "Allowed Domains" are still `unknown_setting`.
6. The layer-4 share is reported for both demo packs.
7. All unit tests pass (on `239ea68`: agent-core 541, browser-runtime 1,931,
   ui 454, browser-extension 636, KB tooling 47), plus the KB E2E files.
8. `npm run preflight`, `npm run build`, `npm run lint:dependencies`,
   `npm run audit:architecture`, `npm run audit:tools` and
   `npm run audit:kb-pack` are green.
9. No card text in the diff, commit messages or PR body.
10. `docs/tasks/kb-rag/FIXES-K24.md` status is DONE, or names what is
    partial.

## How to test

Build agent-core and browser-runtime first; the KB tooling imports them from
`dist/`.

```bash
pnpm install --frozen-lockfile && pnpm --filter @apty/agent-core run build && pnpm --filter @apty/browser-runtime run build
pnpm --filter @apty/agent-core exec vitest run src/kb
node --test tooling/scripts/kb/*.test.mjs
mkdir -p ~/apty-kb && pnpm kb:demo-pack --version 4.x --out ~/apty-kb/demo-4.x.json && pnpm kb:demo-pack --version 5.x --out ~/apty-kb/demo-5.x.json
pnpm -s kb:eval --pack ~/apty-kb/demo-4.x.json --questions tooling/scripts/kb/fixtures/demo-questions-4x.json --by-category
pnpm -s kb:eval --pack ~/apty-kb/demo-5.x.json --questions tooling/scripts/kb/fixtures/demo-questions-5x.json --by-category
node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/knowledge-base.e2e.test.mjs tooling/e2e/kb-answer.e2e.test.mjs tooling/e2e/kb-matches.e2e.test.mjs
```

**Probe script.** Run from the repository root on `239ea68` first, then after
each package (rebuild agent-core each time, and rebuild the demo packs after
K24-4).

```js
// Save as ~/apty-kb/probe-k24.mjs and run from the repo root: node ~/apty-kb/probe-k24.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const core = await import(pathToFileURL(resolve("packages/agent-core/dist/src/index.js")).href);
const sha256 = async (t) => createHash("sha256").update(t).digest("hex");
const load = async (v) => {
  const r = await core.parseKbPack(readFileSync(`${homedir()}/apty-kb/demo-${v}.json`, "utf8"), { sha256 });
  if (!r.ok) throw new Error(r.code);
  return r.pack;
};
const idx4 = core.createKbIndexSet([await load("4.x")]);
const idx5 = core.createKbIndexSet([await load("5.x")]);
const cases = [
  [idx4, "DEMO balloon missing"],
  [idx4, "DEMO balloon missing on the ServiceNow incident form"],
  [idx4, "Salesforce Lightning page, DEMO balloon missing"],
  [idx4, "DEMO balloon missing on the SuccessFactors page"],
  [idx4, "DEMO balloon does not appear on the field in Workday"],
  [idx4, "kubernetes pod CrashLoopBackOff"],
  [idx4, "how do I configure SAML SSO"],
  [idx4, "where is the Widget Activation toggle"],
  [idx4, "Salesforce licence price for 50 users"],
  [idx4, "Workday payroll tax rules"],
  [idx5, "chrome is not opening on my laptop"],
];
for (const [idx, q] of cases) {
  const r = idx.search(q, { onePerCard: true });
  const hits = r.hits.map((h) => `${h.chunk.pageId}#L${h.chunk.layer}`).join(" ");
  console.log(`${q}\n   ${r.status}${r.reason ? "/" + r.reason : ""} cov=${r.coverage.toFixed(2)} ${hits}${r.contextIgnored ? " ignored=" + JSON.stringify(r.contextIgnored) : ""}`);
}
```

## Out of scope

- A per-pack context-word list set by the KB owner. It needs a pack schema
  change; do it after K23 lands, if the real-card evaluation shows the code
  list is not enough.
- Changing layer ranking. K24-4 only measures how often layer 4 comes first;
  the real-card evaluation decides whether to change it.
- Capping or dropping unknown words in general. Off-topic detection depends
  on them (hard rule 2).
- The real-card evaluation on 4.x and 5.x packs (needs the KB owner's
  Confluence token). Leave the commands from FIXES.md 7.3 in the PR, and ask
  the KB owner to add names questions to the real question sets.
- K23 (signed packs) and the lifecycle pieces (case record, send-support
  bundle, feedback log).
