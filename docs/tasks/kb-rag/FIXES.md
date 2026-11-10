# KB-RAG fixes (K10–K20): a RAG that answers from the cards, for 4.x and 5.x

**This is a complete, self-contained implementation prompt for a coding
agent.** Do every work package below, in order, until every acceptance check
in section 6 passes. Do not stop at a plan. Do not skip a package. Where a
step cannot be done in your environment (for example, no Confluence token for
the real-card evaluation), do everything else, mark that one step
**partial**, and say exactly what is left and the command that finishes it.

Base: `origin/main` at `11d2200` (2026-11-09) or later. Status: see
[Status](#status) at the end. Re-read this file after any context compaction;
never guess scope.

Sources named by the owner: the Apty 4.x Product Knowledge Hub
(<https://apty.atlassian.net/wiki/x/iIGOWQ>) and the RAG Answer Cards
(<https://apty.atlassian.net/wiki/x/oYLLV>).

---

## 0. Read first

1. `CLAUDE.md`, `AGENTS.md`, `docs/STATUS.md`.
2. [`MASTER.md`](MASTER.md) (K0–K9, done) and [`decisions.md`](decisions.md):
   their hard rules still apply (MASTER.md §2).
3. `docs/development/kb-rag.md`: the current design, lifecycle and tests.
4. The code you will change (each package names its files):
   - `packages/agent-core/src/kb/pack.ts`, `search.ts` (exported from `packages/agent-core/src/index.ts`)
   - `packages/browser-runtime/src/kb/kb-index.ts`, `kb-matches.ts`
   - `packages/browser-runtime/src/tools/kb.ts`, `tool-relevance.ts`
   - `packages/browser-runtime/src/storage/kb-store.ts`
   - `packages/browser-runtime/src/apty/diagnosis/` (`pack-kit.ts`,
     `widget-not-visible.ts`, `content-not-visible.ts`, `element-not-found.ts`,
     `responder.ts`, `har.ts`, `har-check.ts`, `card-layers.ts`, `types.ts`)
   - `packages/ui/src/components/settings/knowledge-base-card.tsx`,
     `packages/ui/src/lib/kb-citations.ts`,
     `packages/ui/src/components/chatbot/constants.ts`,
     `packages/ui/src/i18n/locales/en.json`, `zh.json`
   - `apps/browser-extension/src/components/investigation/kb-matches-card.tsx`,
     `kb-card-excerpt.tsx`
   - `tooling/scripts/kb/build-kb-pack.mjs`, `eval-kb.mjs`, their tests and
     `fixtures/`
   - `tooling/e2e/harness.mjs`, `kb-fixture.mjs`, the `kb-*.e2e.test.mjs`
     files, `fixtures/fake-5x-client/`
5. The 4.x player code in apty-assist (`player3.0/`), when you port 4.x
   checks (K14). If apty-assist is not checked out, clone
   `aptyInc/apty-assist` read-only next to this repository.

## 1. Why: what the 2026-11-09 audit measured

A pack was built from the real **Apty 4.x Product Knowledge Hub** (space
`A4PKH`, root page `1509720081` "RAG Answer Cards") with this repository's
own `buildPack`, and scored with `eval-kb.mjs` on 60 edge-case questions (51
the KB should cover, 9 it should not). The pack and the questions stayed
outside the repository.

| Measure | Result |
| --- | --- |
| Pages under the root / cards packed / chunks | 118 / 90 / 360. 28 skipped: 23 "4.x version not yet written" stubs and the "start here" routing pages, reported only as "has 0 layers". |
| Recall@1 / Recall@3 / MRR | 0.667 / 0.804 / 0.749 |
| "Not covered" precision / recall, no threshold | 0.50 / 0.11 |
| Same at the best calibrated BM25 threshold (22.96) | 0.67 / 0.44 |
| Same at threshold 150 | 0.31 / 1.00, but Recall@3 falls to 0.51 |
| Network-response questions (`app-urls.json`, `flow.json`, `segments.json`) | Right card every time; layer 3 first when the question names a status code or the Network tab |

Existing tests before any change, all passing: 413 runtime tests (KB,
diagnosis, network), 18 agent-core KB tests, 24 builder and eval tests.

## 2. The bugs (every one must be fixed)

| # | Bug | Evidence | Fixed in |
| --- | --- | --- | --- |
| B1 | "Not covered" is a raw BM25 score threshold. BM25 sums over query terms, so a long off-topic question outscores a short covered one; no threshold separates them. | "where is the Widget Activation toggle and Allowed Domains list" (the invented settings MASTER.md §0 was written against) returned 3 cards as `ok`; so did SAML SSO, licence price, iOS support, "kubernetes pod CrashLoopBackOff", "chrome is not opening". | K10 |
| B2 | Fuzzy matching (0.2 from 5 characters) and prefix matching make almost any English word hit some card. | "kubernetes CrashLoopBackOff" scored 2.9 on three unrelated cards. | K10 |
| B3 | The card's `Symptom:` line (the sentence in the user's words) is never indexed; only the title is. | Paraphrases rank the right card 2nd or lower. | K11 |
| B4 | Title boost 3 lets one shared title word win; no stemming; no synonyms. | "every user sees it" ranks a "one user cannot see it" card first; "French users see English" finds no language card in the top 3; "flickering" vs "flickers", "refresh" vs "reload" differ. | K11 |
| B5 | File names are split into parts; `flow-123.json` does not find the `flow-ID.json` card. | net questions on ids. | K11 |
| B6 | Packs are 5.x only: `aptyVersion: z.literal("5.x")` (`pack.ts:54`), the builder always writes `"5.x"` (`build-kb-pack.mjs`, `buildPack`). | A pack built from `A4PKH` is labelled 5.x. | K12 |
| B7 | The store holds one pack (`kb-store.ts`, keys `pack` / `meta`). | An SE with 4.x and 5.x customers can load only one. | K12 |
| B8 | Card links are hard-coded to space JA (`pack.ts:248`, `KB_CARD_PAGE_BASE`), ignoring `card.url`. | 4.x card links point at JA. | K12 |
| B9 | Nothing knows the tenant's Apty version when searching; wrong-version cards come back silently. | — | K12 |
| B10 | `playerVersionOf` treats `app-urls.json` and `app-data.json` as 5.x markers (`pack-kit.ts:174`). The 4.x player reads both (apty-assist `player3.0/src/shared/helpers/cdn-helpers.ts:17,23`). | A 4.x tenant seen before `flow.json` loads is called 5.x, so regex URL flags are assumed off (`widget-not-visible.ts:210`). | K13 |
| B11 | A 4.x tenant gets no diagnosis: every check stops at the `CNV-V5` gate ("nothing was concluded") in `widget-not-visible.ts:583`, `content-not-visible.ts:691`, `element-not-found.ts:859`. | — | K14 |
| B12 | The Agent cannot see a 4.x Extension-mode player's calls: it fetches every content file through `chrome.runtime.sendMessage` to its own background (`player3.0/src/api/http.ts:249`), which tab-level CDP capture never sees; its manifest has no `externally_connectable`; the CDN fallback is 5.x only (`apty-files.ts`). | — | K15 |
| B13 | Page network capture is not used as evidence for the checks (only the Client's record, the CDN, or a HAR). | A 4.x Injected-mode tenant, whose calls the page makes, still gets nothing. | K15 |
| B14 | The no-key KB matches card only fires on a symptom regex (`kb-matches.ts:15`). 38 of the 102 real 4.x card titles do not pass it. | Missed: flickers, jumps, slow/slower, freezes, hangs, repeats, "again and again", invisible, cropped, duplicates, "does nothing", "still shows", "no balloon appears", rejected, skips, differ, every "`<file>`.json response, what it means". | K16 |
| B15 | A non-English question returns nothing, silently (the cards are English). | "小部件没有显示" → nothing. | K16 |
| B16 | `search_kb` is offered to the model only when the message contains "how do i", "setting", "kb card" and similar, or the diagnosis group matched (`tool-relevance.ts:201`, `:248`). A plain symptom ("tooltip flickers") or "what does flow.json mean" reaches the model **without** the KB tool, so the model answers from general knowledge. "how do I" offering the tool also contradicts D-KB1. | — | K16 |
| B17 | Stub and routing cards vanish from the pack, so a question that only a stub covers gets the nearest wrong card. | "bulk publish over 10 workflows", "analytics events missing in Admin", "on-prem ClickHouse migration", "`rules.json` response", "`flow-ID.json` response" returned unrelated cards as `ok`. | K17 |
| B18 | The builder reports a stub as "has 0 layers, not 4", indistinguishable from a broken card. | — | K17 |
| B19 | Nothing checks the model's answer against the cited chunks; the guard is the prompt only. | `constants.ts`, "Never name an Apty setting… not in a returned chunk". | K18 |
| B20 | `layerAccuracy` is 0 on the real set: a file question returns the card's layer 4 first unless it names a status code. | "what does the app-urls.json response tell me" → L4, L1, L3, L2. | K11 |
| B21 | READMEs and `docs/development/kb-rag.md` describe 5.x only, no local test path with a pack, no 4.x path. | — | K19 |
| B22 | No local end-to-end path to try the RAG without a real pack (a synthetic demo pack is only inside E2E tests). | — | K20 |

## 3. Owner decisions (accepted with this prompt, 2026-11-09)

Record each in `docs/tasks/kb-rag/decisions.md` (a section per decision, like
D-KB1–D-KB5) and a row each in `DECISIONS.md`, in the first PR.

| Id | Decision |
| --- | --- |
| D-KB6 | Amends D-KB4 and MASTER.md §6: **4.x cards are in scope.** Sources: Apty 4.x Product Knowledge Hub (`A4PKH`, root `1509720081`); Apty 5.x cards (JA root `1496711169` until the restructure moves them to the 5.x hub, then that root); Apty KB - Common for cards the same in both versions (`--version common`). |
| D-KB7 | Amends MASTER.md §6 for the check packs: **the Agent diagnoses 4.x tenants**, starting with "widget not showing" and "content not showing", from 4.x code (apty-assist) with file and line citations, not runtime-verified until tested on a tenant. |
| D-KB8 | Quality gate, per version, on the real question sets (≥ 60 questions each, ≥ 9 not covered): **Recall@3 ≥ 0.90, "not covered" precision ≥ 0.90, "not covered" recall ≥ 0.80**, layer accuracy ≥ 0.70. On the synthetic CI set: every question passes. |
| D-KB9 | **4.x evidence:** the guided HAR path and page capture ship in this repository now (K15 A, B). The 4.x Client bridge (K15 C) is a separate PR to `aptyInc/apty-assist`; do it if you have access to that repository, otherwise write the change as a ready-to-apply patch file description in `docs/integrations/apty/4X-BRIDGE.md` (no apty-assist code is copied here). |

## 4. Hard rules

1. **No KB content in the repository, ever** (MASTER.md §2.2). Tests use
   synthetic cards with invented titles, symptoms and settings. Never copy a
   real card's title, symptom line or text into code, tests, fixtures, docs,
   commit messages or PR bodies. Real page ids are fine (the code already
   holds them). `npm run audit:kb-pack` must stay green.
2. No new permission, host or network call from the extension. Keep
   `externally_connectable: {"ids": []}`. No Confluence credential in the
   extension.
3. `agent-core` stays platform-free (no `chrome`, DOM or IndexedDB); `ui`
   depends on `agent-core` only; `npm run audit:architecture` passes.
4. Deterministic: the same pack and query give the same ranking, coverage
   and status, ties broken by page id then layer (P8).
5. Every chunk shown or sent cites its card (page id, title, layer,
   "Verified on"); NOT VERIFIED is carried to the UI and the model (P1, P2).
6. Schema v2 imports v1 packs unchanged (read as `aptyVersion: "5.x"`, no
   symptom, no status, no coverage settings, the v1 `threshold` honoured).
7. Every behaviour change gets a unit test that fails on the old code first
   (write the test, see it fail, then fix). Anything crossing the Chrome
   boundary also gets an E2E in `tooling/e2e/` using `harness.mjs`. Never
   skip, weaken or delete a test to get green.
8. New UI strings in both `en.json` and `zh.json`; new surfaces pass axe in
   light and dark and work by keyboard alone.
9. No new runtime dependency in `agent-core` (write the stemmer, about 100
   lines). If any dependency is unavoidable elsewhere, run `npm run
   check:dist-licences` and justify it in the PR.
10. Every 4.x check-pack rule cites the apty-assist file and line it comes
    from in a code comment, and its finding says "4.x code, apty-assist
    `<commit>`, not runtime-verified".
11. One branch and one PR per work package from the latest `origin/main`
    (or one stacked branch if the environment gives you a single branch:
    then one commit per package, each green on its own). Never commit to
    `main`.
12. Before each PR or package commit, run and paste in the PR body:
    `npm run preflight`, `npm run build`, the E2E files you touched,
    `npm run lint:dependencies`, `npm run audit:architecture`,
    `npm run audit:tools`, `npm run audit:kb-pack`, and
    `npm run report:request-size` when a prompt section or tool schema
    changed (update `tooling/e2e/request-budgets.json` and
    `docs/development/REQUEST_ANATOMY.md` if the budget moves, within its limit).

## 5. Work packages

Order: K13, K10, K11, K17, K16, K12, K18, K14, K15, K20, K19.
After K10, K11, K17 and K12, re-run the evaluation (section 7.3) and record
the numbers (ids only, never question text) in the commit or PR.

### K13. Tell 4.x from 5.x correctly (B10)

Files: `packages/browser-runtime/src/apty/diagnosis/pack-kit.ts` (+ test).

- Remove `app-urls.json` and `app-data.json` from `FIVE_X_MARKERS`: both
  players read them.
- 5.x-only markers: `workflow.json`, `segment.json`, `rule.json`. 4.x-only
  markers: `flow.json`, `segments.json`, `rules.json`, `feature-flag.json`
  and a `flow-<id>.json` name. Confirm each against apty-assist
  `player3.0/src/shared/helpers/cdn-helpers.ts` (4.x) and apty-dap's player
  CDN service (5.x) before adding it, and cite both in the comment. Check
  whether `config.json` ever appears in a tenant's calls (the 4.x Studio
  reads it from its own extension); keep it only if it does.
- Only shared files observed → `"unknown"`; `widget-not-visible` keeps
  treating unknown as "regex flags may be on".
- `looks4x` uses the same marker lists.
- Tests: only `app-urls.json` + `app-data.json` → `unknown`; plus
  `flow.json` → `4.x`; plus `workflow.json` → `5.x`; both → `unknown`.

### K10. A "not covered" decision that does not depend on query length (B1, B2)

Files: `packages/agent-core/src/kb/search.ts`, `pack.ts` (+ tests);
`tooling/scripts/kb/eval-kb.mjs`, `build-kb-pack.mjs` (+ tests).

- Keep MiniSearch BM25 for **ranking**. Decide **coverage** on the top
  card with a length-independent measure:
  - Query terms: the distinct processed terms (stop words removed, stemmed
    per K11). Synonym expansions (K11) are not separate query terms; they
    are alternative ways to match a term.
  - `idf(t) = ln(1 + N / (1 + df(t)))`, N = number of chunks, df = chunks
    containing t. A term in **no** chunk gets `ln(1 + N)`: the highest
    weight, because it is a word the KB has never seen ("saml",
    "kubernetes", "ios", "licence").
  - Match weight of a term against the top card (its title, symptom and
    all its chunks): exact or stemmed 1.0, synonym 0.8, fuzzy-only 0.5,
    none 0.
  - `coverage = Σ idf(t)·match(t) / Σ idf(t)`, in [0, 1].
  - Covered when `coverage ≥ coverage.min` **and** at least
    `coverage.minTerms` (default 1) matched terms have
    `idf ≥ coverage.minIdf` (so "apty", "user" or "widget" alone never make
    a question covered).
  - **Setting-name guard:** each quoted phrase and each Title Case phrase of
    two or more words in the query ("Widget Activation", "Allowed
    Domains"), ignoring the sentence's first word, must appear
    (case-insensitive, stemmed) in the top card's text. If any is missing:
    `status: "not_covered"`, `reason: "unknown_setting"`,
    `missingPhrases: [...]`.
- Fuzzy: off for a term that exists exactly in the vocabulary, and for
  terms shorter than 6 characters. Prefix: from 4 characters (was 3).
- `KbSearchResult` gains `coverage: number`, `reason?: "no_match" |
  "low_coverage" | "unknown_setting"`, `missingPhrases?: string[]`.
- Pack v2 `retrieval.coverage: { min: number; minIdf: number; minTerms:
  number }`. Defaults when absent in a v2 pack: `{ min: 0.5, minIdf: 1.5,
  minTerms: 1 }`, and the defaults are replaced by calibrated values.
  A v1 pack keeps its `threshold` behaviour exactly.
- `search_kb` (`tools/kb.ts`) passes `reason` and `missingPhrases` to the
  model; its description says what they mean.
- `eval-kb.mjs --calibrate`: grid-search `min` (0.05 to 0.95, step 0.05)
  and `minIdf` (the 10th to 90th percentiles of the vocabulary's idf, step
  10) for the best Youden J (covered recall + not-covered recall − 1),
  subject to Recall@3 dropping at most 0.02 from the uncapped ranking. Print
  `--coverage-min <x> --coverage-min-idf <y>` for `kb:pack`. The builder
  accepts both flags and writes them into `retrieval.coverage`.
- Tests (synthetic): a 25-word off-topic question is `not_covered` while
  a 2-word covered one is `ok`; an invented Title Case setting gives
  `unknown_setting` with the phrase; "apty widget" alone is not covered;
  coverage is identical across runs to the last digit; a v1 pack with
  `threshold` gives exactly today's results (snapshot the existing
  `search.test.ts` cases).

### K11. Index what the user says (B3, B4, B5, B20)

Files: `build-kb-pack.mjs`, `pack.ts`, `search.ts`, new
`packages/agent-core/src/kb/stem.ts`, `synonyms.ts` (+ tests).

- Builder: read the card's `Symptom:` line from the intro (before Layer 1),
  the way it reads `Verified on:`. Store `card.symptom: string | null`
  (at most 300 characters, trimmed). Report the cards with no symptom line
  (ids and titles only).
- Index: fields `title` (boost 2, was 3), `symptom` (2.5), `heading` (1.5),
  `text` (1). The symptom is indexed once per card, on its lowest layer's
  chunk only.
- `stem.ts`: a deterministic light English stemmer used by `processTerm` at
  index and query time: strip `'s`; plural `-ies→-y`, `-es`, `-s` (not
  `-ss`); `-ing`, `-ed` (with double-consonant undoubling, e.g.
  "stopped"→"stop"); `-er`/`-est` on adjectives of 4+ letters
  ("slower"→"slow"); `-ly`. Never stem tokens with digits or dots.
  Tests: a table of 40 word pairs.
- File names: keep `name.json`, `name-id.json` and `name.js` as whole tokens
  **and** their parts. Normalize `flow-<digits or uuid>.json` to
  `flow-id.json` (and the same for any `<name>-<id>.json`) on both sides.
- `synonyms.ts`: a generic Apty vocabulary (no card text), each group
  matched at weight 0.8: balloon / tooltip / popup / bubble / hint;
  workflow / walkthrough / guide / flow / tour; reload / refresh / F5;
  production / prod / live; test / UAT / staging / QA / sandbox;
  freeze / hang / unresponsive / stuck; crash / tab crashed / out of memory;
  slow / sluggish / lag / laggy / performance; disappear / vanish /
  missing / gone; repeat / again / "keeps coming back" / "every time" /
  "each login"; language / translated / translation / locale / any
  language name (French, German, Spanish, Italian, Portuguese, Dutch,
  Japanese, Chinese, Korean, Arabic, Hindi); split step / decision step /
  branch / condition; launcher / button / icon / beacon; segment /
  audience / user group / targeting; publish / release / go live / deploy
  content; selector / XPath / CSS / locator; CSP / Content-Security-Policy /
  nonce; CORS / cross-origin; iframe / frame / embedded; shadow DOM / shadow
  root / LWC; skip / jump / "starts at step". A pack may extend it with
  `retrieval.synonyms: string[][]` from the KB owner's local file
  (`kb:pack --synonyms <file>`, one group per line, comma-separated).
- Layer hint (a ×1.3 boost to that layer's chunks, never a filter):
  Network tab, status, `\b[1-5]\d\d\b`, response, request, payload, `.json`,
  HAR, "what it means", "returned" → layer 3; Console, Elements, DevTools,
  selector, XPath, DOM, "inspect" → layer 2; Studio, Admin, setting,
  configure, publish, toggle → layer 1; support, ticket, escalate, contact,
  "send to" → layer 4. With no hint, a symptom question prefers layer 1
  and a file question layer 3.
- Tests (synthetic): a paraphrase only the symptom line answers ranks its
  card first; a title-word collision no longer wins; "flickering" and
  "flickers" find the same card; "refresh" finds a "reload" card;
  "flow-123.json" finds the `flow-ID.json` card; a status-code question and
  a "what does X.json mean" question both rank layer 3 first.

### K17. Stubs and routing cards are first-class (B17, B18)

Files: `build-kb-pack.mjs`, `pack.ts`, `search.ts`, `tools/kb.ts`,
`kb-matches-card.tsx`, `knowledge-base-card.tsx`, i18n (+ tests).

- Builder classifies each "RAG Card:" page:
  - `full`: exactly layers 1–4 in order;
  - `stub`: no layers and the intro says the version is "not yet written"
    (match `/\b(?:4|5)\.x version not yet written\b/i`, plus a generic
    `/not yet written/i`);
  - `routing`: title starts with "start here" (case-insensitive), no layers;
  - `malformed`: anything else (still skipped and reported with its reason).
    Report the counts per class. `stub` and `routing` cards go in the pack
    with `status`, title and symptom, and no chunks.
- Pack v2 `card.status: "full" | "stub" | "routing"` (v1 cards read as
  `full`). The integrity check allows stub and routing cards with no chunks
  and rejects chunks on them.
- Search indexes stubs and routing cards on title and symptom. If the best
  covered match is a stub: `status: "stub"`, one hit with the card's title,
  link and version, no text. A routing card is never returned as a hit; it
  only takes part in ranking (it can push the user's words toward a full
  card's vocabulary through shared terms) and is dropped from the results.
- UI: the KB matches card and the `search_kb` result say "The KB has a card
  for this, but its `<version>` text is not written yet" with the link.
  Options shows "N cards, M not yet written".
- Eval: a stub counts as a hit when it is the expected card.
- Tests: a question only a stub covers returns `stub`, never another card;
  routing cards never appear in hits; the builder classifies a synthetic
  stub, routing page and malformed page correctly.

### K16. Search for every symptom, offer the tool every time (B14, B15, B16)

Files: `packages/browser-runtime/src/kb/kb-matches.ts`,
`apty/diagnosis/responder.ts`, `tools/tool-relevance.ts`,
`packages/ui/src/components/chatbot/constants.ts`, i18n (+ tests, E2E).

- **KB matches card (no model):** run the local KB search for every message
  that no check pack claims. Show the card when K10 says covered (or K17
  says stub), unless the message is a bare how-to with no symptom (D-KB1).
  Replace the symptom gate with a how-to detector: the message starts with
  or is mainly "how do I / how to / how can I / can I / where is the setting
  / where do I configure / what is the setting for", and contains no symptom
  word.
- Symptom words (stemmed by K11), used by the how-to detector: the existing
  list plus flicker, jump, slow, lag, freeze, hang, repeat, again,
  invisible, unreadable, crop, duplicate, "nothing happens", "does
  nothing", "still show", late, inconsistent, differ, reject, skip,
  "no \w+ (appears|shows)", "every user", "for everyone", "only some".
- **search_kb offering (B16):** offer `search_kb` (and its prompt section)
  whenever a KB pack is loaded and the message is about Apty or a symptom:
  add a `kb` implication from the `apty`, `extensionNetwork`, `devtools`,
  `selector` and `diagnosis` groups, and from any symptom word. Keep it off
  for casual messages and for `RETRIEVAL_REQUEST` messages that only ask to
  fetch data ("give me segments.json") — but a "what does X.json mean"
  question gets it. Remove "how do i", "how can i", "how to" from the `kb`
  group's phrases so a bare how-to no longer pulls the tool in (D-KB1); keep
  "turn off", "setting", "in studio", "in admin", "kb card", "knowledge
  base", "contact support", "send support" (they follow a finding).
  Check the request-size budget.
- **Non-English (B15):** when more than half the message's letters are
  non-Latin and the loaded packs are English, show no KB card, show the
  notice "The KB cards are in English. Ask in English, or send the question
  to the model." (en and zh), and with an AI key let the model call
  `search_kb` with an English query (say so in the tool description).
- Prompt section (`constants.ts`, the "APTY PRODUCT FACTS COME FROM THE KB
  CARDS" section): add "On `unknown_setting`, say the KB has no setting
  with that name, name the missing phrase, and do not suggest a similar
  one. On `stub`, say the card exists but its text is not written yet and
  give the link. State the Apty version the answer is for (K12)."
- Tests: each new symptom word fires; a pure how-to does not; a check pack
  still wins; the non-English notice; `tool-relevance.test.ts` cases for a
  bare symptom, a "what does flow.json mean" question, a "give me
  segments.json" request and a bare how-to. E2E (no AI key): one symptom
  question per new word family shows the KB matches card and no model
  request is made.

### K12. Version-aware packs (B6, B7, B8, B9)

Files: `pack.ts` (schema v2), `build-kb-pack.mjs`, `kb-store.ts`,
`kb-index.ts`, `kb-matches.ts`, `tools/kb.ts`, `knowledge-base-card.tsx`,
`kb-citations.ts`, `kb-matches-card.tsx`, `kb-card-excerpt.tsx`, the
preflight row, i18n (+ tests, E2E).

- **Schema v2** (`schemaVersion: 2`): `aptyVersion: "4.x" | "5.x" |
  "common"`; `card.symptom`, `card.status`; `retrieval.coverage`,
  `retrieval.synonyms`. `parseKbPack` accepts v1 and v2 and returns a v2
  shape (v1 → `aptyVersion: "5.x"`, `status: "full"`, `symptom: null`).
- **Links:** every link uses `card.url`. `kbCardUrl(pageId)` takes the
  index (or the card) and falls back to the JA base only for a v1 pack.
  `kb://<pageId>#L<n>` stays the cite format (page ids are unique across
  spaces).
- **Builder:** `--version 4.x|5.x|common`. Known spaces default it
  (`A4PKH` → 4.x); for `JA` and unknown spaces the flag is required and the
  builder says so. Default output name
  `~/apty-kb/apty-kb-<space>-<version>-<yyyymmdd>.kbpack.json`.
- **Store:** one active pack per version. IndexedDB records
  `pack:<version>` / `meta:<version>`; on first open, migrate a stored v1
  `pack` / `meta` to `pack:5.x` / `meta:5.x` (keep the sha256 check across
  the two writes). API: `info(): KbPackInfo[]`, `load(version)`,
  `replace(text)` (stores under the pack's own version),
  `remove(version)`.
- **Index source:** `current(version: "4.x" | "5.x" | "unknown")` returns an
  index over `<version> + common`, or over every loaded pack for
  `unknown`; cached by the set of sha256 values.
- **Tab version:** from the check's evidence (`playerVersionOf`, K13) when
  present; else the user's choice. Add a small control in the KB matches
  card and on the verdict card, "Apty version: 4.x / 5.x / Not sure",
  remembered per site host for the conversation (in the conversation's
  state, not `chrome.storage`). `search_kb` gains an optional
  `aptyVersion` parameter the model may set when the user said it.
- **Unknown version:** search all packs, label each hit with its version,
  and when the top two hits come from different versions show both with
  their labels and the line "These cards are for different Apty versions;
  which does this tenant run?" Never merge statements from two versions
  into one instruction (prompt rule).
- **Options → Knowledge base:** one row per loaded pack (version, space,
  cards, stubs, built date, imported date, mode, age warning over 30 days)
  with Import / Replace / Remove; Import reads the version from the file.
  Preflight: one row per version.
- Tests: v1 import migrates to 5.x and searches as before; a 4.x and a 5.x
  pack load side by side; a 4.x tab never gets a 5.x-only hit; unknown
  labels both and asks; links use `card.url` (an `A4PKH` URL for a 4.x
  card); removing 4.x leaves 5.x. E2E: import two synthetic packs (one 4.x,
  one 5.x), reload the extension, both listed; remove one; axe light and
  dark; keyboard only.

### K18. Check the answer against the cited chunks (B19)

Files: new `packages/ui/src/lib/kb-grounding.ts` (+ test), the assistant
message renderer that calls `linkKbCitations`, i18n.

- After an answer in a turn where `search_kb` returned results: collect
  the chunks returned in that turn. In the answer (outside code spans),
  find quoted phrases and Title Case phrases of two or more words (ignore a
  sentence's first word and words in a short stop list such as "Apty",
  "Chrome", "Google", "Microsoft", "Salesforce", "Network", "Console",
  "Elements", "DevTools"). A phrase in none of the returned chunks gets a
  dotted underline and the tooltip "Not found in the cited KB cards". A
  `kb://` cite not returned in this turn renders as "unknown citation",
  not a link.
- Deterministic, no model call, never rewrites the text, en and zh.
- Tests: an invented setting name is flagged; a setting present in the
  chunk is not; code spans are ignored; an unreturned cite is not linked.

### K14. 4.x check packs: widget not showing, content not showing (B11)

Files: `packages/browser-runtime/src/apty/diagnosis/`: new
`widget-not-visible-4x.ts`, `content-not-visible-4x.ts`, shared helpers in
`pack-kit.ts`, new rule ids in `types.ts`, `card-layers.ts`, synthetic
fixtures `fixtures/content-4x/` (+ tests, E2E).

- Replace the `CNV-V5` gate in the three checks: files that are 4.x run the
  4.x pack; keep the gate (with its current text) only for `unknown` when
  no 4.x evidence can be read. `element-not-found` keeps the gate for 4.x
  in this package (no 4.x port yet) but its text names K14 as future work.
- **Widget not showing (4.x)**, rule family `W4X`:
  - `app-urls.json`: missing, failed (report the status code; the 4.x
    player turns a failed request into `[]`, so a failure looks like an
    empty list to the user), `[]` (no application published), or no
    environment matching.
  - Matching the 4.x way (confirm in apty-assist `player3.0`, cite file and
    line): each environment's URL pattern against the full top-window
    address; `*` matches any run of characters; other characters match
    exactly; the pattern may match anywhere in the address; applications
    tried in file order and the first application with a matching
    environment wins. With the tenant's regex URL feature flag on (read
    `feature-flag.json`), patterns are also tried as regular expressions;
    an invalid one is reported, not thrown.
  - `app-data.json` for the chosen environment: player switched off
    (`enablePlayer`), widget setting off (`widgetConfig`), with the
    environment named.
  - Each cause: `cardPageId` of the matching **4.x** card (constants in the
    file, ids only; look them up in the `A4PKH` tree, e.g. the
    `app-urls.json` mirror card `1509786000`), layer per `card-layers.ts`.
- **Content not showing (4.x)**, rule family `C4X`: `flow.json` (the flow
  is present, published, in this environment), `flow-<id>.json` (its
  steps), `segments.json` and `rules.json` against what the page shows of
  the user, mirroring the 5.x pack's logic for its files, each rule from
  4.x code.
- Version line on every 4.x finding: "4.x code, apty-assist `<commit>`
  (`<version>`, `<date>`); from code, not runtime-verified".
- Tests: one unit test per rule with synthetic 4.x files; routing
  (4.x → 4.x pack, 5.x → 5.x pack, unknown → gate); the 5.x tests unchanged.
  E2E: extend `visibility-check.e2e.test.mjs` with a synthetic 4.x tenant.

### K15. 4.x evidence: get the network calls (B12, B13)

Files: `apty-files.ts`, `network-capture-session.ts`, `har.ts`,
`har-check.ts`, the verdict card component, i18n; new
`tooling/e2e/fixtures/fake-4x-client/` (+ tests, E2E).

- **A. Page capture as evidence (Injected mode).** The 4.x injected player
  fetches from the page, so `start_network_capture` sees its calls. When a
  check runs and the conversation has a capture (active or just stopped)
  with Apty content calls, read the files from it the way `har.ts` reads a
  HAR (same tenant-path matching, same deny list and redaction), and label
  the source "read from the page's network capture". When no capture
  exists and the page looks like Injected mode, the verdict card offers
  **Capture and reload**: start a capture, reload the tab, wait for the
  network to go quiet (2 s with no new Apty call, at most 20 s), stop, run
  the check.
- **B. Guided HAR from the 4.x service worker (Extension mode).** When the
  tab looks like a 4.x tenant (or the user said 4.x) and no Apty files
  were observed, the verdict card shows numbered steps, each with a copy
  button where text is involved:
  1. Open `chrome://extensions`, turn on **Developer mode**.
  2. Find the Apty extension (the 4.x Client) and click **service worker**
     under "Inspect views".
  3. In that DevTools window open **Network** and tick **Preserve log**.
  4. Reload the application tab and reproduce the problem.
  5. In the service worker's Network panel, right-click → **Save all as HAR
     with content**.
  6. Drop the HAR on the side panel (the existing HAR import).
     A service-worker HAR has no page entry: use the bound tab's URL as the
     page, shown to the user to confirm before the check runs.
- **C. 4.x Client bridge** (D-KB9). In apty-assist (separate PR) or as
  `docs/integrations/apty/4X-BRIDGE.md`: add
  `"externally_connectable": { "ids": [<both Agent IDs from
  docs/integrations/apty/README.md>] }` to the 4.x player manifests; in
  `player3.0/src/background-scripts/` record each `GetDataFromCDN` call (URL
  with tokens removed, status, time, body capped at the bridge contract's
  size and passed through the same deny list) in a ring buffer, and answer
  `chrome.runtime.onMessageExternal` with the existing `apty-debug-agent:*`
  contract (`docs/integrations/apty/README.md`), checking `sender.id`
  against the allow-list. Then `inspect_extension_network` and the checks
  work for 4.x with no change here.
- E2E: `fake-4x-client/` (like `fake-5x-client/`) serving synthetic 4.x
  files from a test page in Injected mode, for A; a synthetic
  service-worker-shaped HAR (no page entry), for B.

### K20. A local demo pack so anyone can try the RAG (B22)

Files: `tooling/scripts/kb/build-demo-pack.mjs` (+ test), `package.json`.

- `pnpm kb:demo-pack [--version 4.x|5.x] [--out <file>]` builds a v2 pack
  from the synthetic cards in `tooling/scripts/kb/fixtures/` (invented
  titles and settings, marked as fixtures in every card's text) and writes
  it **outside the repository** (default
  `~/apty-kb/apty-kb-DEMO-<version>.kbpack.json`). It uses the same
  `buildPack` as the real builder, with a fake fetch.
- The synthetic cards cover every category in section 7.2, so a person can
  import the demo pack and try every scenario in section 7.4.
- `check-no-kb-pack` still catches a demo pack written inside the tree.

### K19. Documentation: how to run and test everything locally (B21)

Update every file below. Commands must be copy-pasteable, each in its own
fenced `bash` block, tested by you in a clean checkout. No card text.

1. **`README.md` (root)** — a **"Knowledge base (KB-RAG)"** section with:
   what it does in four lines; links to the sections below; and a
   **"Try it locally in 10 minutes"** quickstart:
   prerequisites (Node `^20.19.0 || >=22.12.0`, pnpm 10.33, Chrome or
   Chromium); `pnpm install --frozen-lockfile`; `pnpm build`;
   load `apps/browser-extension/dist` unpacked (exact clicks);
   `pnpm kb:demo-pack --version 4.x` and `--version 5.x`; Options →
   Settings → General → Knowledge base → Import (both); open the side
   panel and ask the three demo questions (one covered symptom, one
   not-covered, one stub) with what each must show; Preflight's row.
2. **`docs/development/kb-rag.md`** — rewrite for v2: design diagram with
   versions; pack schema v2 table (every field); retrieval (BM25 ranking,
   coverage formula with the idf definition, setting-name guard, symptom
   field, stemmer, synonyms, layer hints, stubs and routing); the version
   model (packs per version, tab version, unknown); where it shows (KB
   matches card, verdict card, `search_kb`, grounding check); lifecycle for
   the KB owner (sections 7.3 commands for 4.x, 5.x and common, calibrate,
   rebuild, share); lifecycle for each SE (import per version, replace,
   remove, the 30-day warning); evaluation (questions file format with
   `category`, every metric, `--by-category`, `--calibrate`, the D-KB8
   gate); troubleshooting (table: symptom → cause → fix, covering: import
   refused for each error code, "not covered" for everything (coverage too
   high or wrong version loaded), wrong-version cards, no KB card with no
   key (how-to detector), model not calling `search_kb`, links opening the
   wrong space, stale pack); the tests table updated; "Not done" updated
   honestly.
3. **`apps/browser-extension/README.md`** — build, load unpacked, reload
   after a rebuild, where the KB lives (IndexedDB `apty-kb-db`, per
   version), how to inspect or clear it (DevTools → Application →
   IndexedDB), and the side-panel and Options surfaces.
4. **`packages/agent-core/README.md`** — the KB API: `parseKbPack`,
   `createKbIndex`, `search` options and result (status, reason, coverage,
   hits), `cardChunks`, versions; a short code example on a synthetic pack.
5. **`packages/browser-runtime/README.md`** — `search_kb` (parameters,
   result, statuses), the KB store API, the KB matches responder, the 4.x
   check packs, evidence sources (Client, CDN, page capture, HAR) and when
   each is used.
6. **`tooling/e2e/README.md`** — rows for every new or changed KB E2E file;
   how to run one file, the KB set, and all of them; the fake 4.x client
   fixture; how to debug a failing E2E (headed run, trace on).
7. **`docs/integrations/apty/README.md`** — 4.x section: why the Agent
   cannot reach a 4.x Client today, the Injected-mode capture path, the
   service-worker HAR steps, and the bridge (link `4X-BRIDGE.md` or the
   apty-assist PR).
8. **`docs/TROUBLESHOOTING.md`** — a "Knowledge base" section linking the
   kb-rag.md table, and a "4.x tenant" section.
9. **`docs/release/SMOKE_TEST.md`** — rows for: import the demo packs,
   one covered, not-covered and stub question each, a 4.x Injected-mode
   capture, a 4.x HAR import.
10. **`PRIVACY.md`, `docs/security/DATA_FLOW.md`,
    `docs/security/SECURITY_AUDIT.md`** — card text per version stored on
    the SE's machine; what goes to the provider and when (now also for
    plain symptom messages, B16); the HAR from the 4.x service worker (what
    it holds, that it stays local, redaction); the 4.x bridge's allow-list.
11. **`docs/STATUS.md`, `CHANGELOG.md`, `DECISIONS.md`,
    `docs/tasks/README.md`** — KB-RAG status and test counts, the changes,
    D-KB6–D-KB9, and this file's status (DONE, or what is partial).

## 6. Acceptance (definition of done)

All must hold; paste the evidence in the final PR or commit.

1. Every bug B1–B22 has a test that failed before its fix and passes now
   (list `bug → test name`).
2. Synthetic CI set (section 7.2): every question passes; `pnpm kb:eval`
   on it reports Recall@3 1.0 and "not covered" precision and recall 1.0.
3. The specific audit failures pass on synthetic stand-ins: the
   invented-settings question is `unknown_setting`; SSO, pricing, mobile,
   infrastructure and "chrome is not opening" stand-ins are `not_covered`;
   each paraphrase category ranks its card in the top 3; a stub-only
   question returns `stub`; a file question ranks layer 3 first.
4. Real cards (section 7.3): with a Confluence token, the D-KB8 numbers hold
   for 4.x and 5.x and are recorded (ids only). Without a token: mark
   **partial**, and list the exact commands for the KB owner.
5. A 4.x Injected-mode tenant gets a 4.x verdict from a page capture, and a
   4.x Extension-mode tenant from a service-worker HAR, in E2E; neither
   cites a 5.x card. 5.x verdicts are unchanged (existing E2E green).
6. A v1 pack imports, migrates to 5.x and searches exactly as before.
7. `search_kb` is offered for a plain symptom and a file-meaning question,
   not for a bare how-to or a casual message (unit tests), and the request
   budget holds.
8. Every README and doc in K19 is updated and every command in them was run
   in a clean checkout.
9. `npm run preflight`, `npm run build`, `npm run test:e2e` (or every KB,
   visibility, HAR and Apty Client E2E file), `npm run lint:dependencies`,
   `npm run audit:architecture`, `npm run audit:tools`,
   `npm run audit:kb-pack`, `npm run report:request-size` all green.
10. No card text anywhere in the repository, CI logs or artifacts.

## 7. How to test

### 7.1 Unit and E2E (synthetic, in the repository)

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm build
```

```bash
pnpm --filter @apty/agent-core exec vitest run src/kb
```

```bash
pnpm --filter @apty/browser-runtime exec vitest run src/kb src/tools/kb.test.ts src/tools/tool-relevance.test.ts src/storage/kb-store.test.ts src/apty/diagnosis
```

```bash
node --test tooling/scripts/kb/*.test.mjs
```

```bash
node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/knowledge-base.e2e.test.mjs tooling/e2e/kb-answer.e2e.test.mjs tooling/e2e/kb-matches.e2e.test.mjs tooling/e2e/visibility-check.e2e.test.mjs tooling/e2e/har-check.e2e.test.mjs tooling/e2e/apty-client.e2e.test.mjs
```

```bash
npm run preflight
```

### 7.2 Synthetic edge-case set (CI)

Extend `tooling/scripts/kb/fixtures/synthetic-cards.mjs` and
`synthetic-questions.json` (each question gains `category`; the eval's
`--by-category` prints metrics per category) with at least two invented
cards and questions per category, for both a 4.x and a 5.x synthetic pack:

| Category | What it checks | Expected |
| --- | --- | --- |
| paraphrase | the user's words, not the title's | card in top 3 |
| symptom-line | answered only by a card's symptom line | card first |
| collision | a shared title word must not win | right card first |
| stem | "flickering" vs "flickers", "slower" vs "slow" | same card |
| synonym | "refresh" for "reload", "walkthrough" for "workflow" | card in top 3 |
| typo | one or two letters off | card in top 3 |
| short | one or two words | card in top 3 |
| multi | two symptoms in one question | both cards in top 3 |
| network-file | a file name, a status code, an empty `[]`, `flow-123.json` | mirror card, layer 3 first |
| layer | settings vs Console vs network vs support | the hinted layer first |
| stub | only a stub covers it | `stub` |
| version | the same title in a 4.x and a 5.x card | the tab's version only; unknown → both, labelled |
| not-covered-long | a 25-word off-topic question | `not_covered` |
| not-covered-setting | an invented Title Case setting | `unknown_setting` |
| not-covered-domain | SSO, billing, mobile, infrastructure, generic browser | `not_covered` |
| how-to | a bare "how do I configure X" | no KB matches card; tool not offered |
| non-english | a question in Chinese | the English-cards notice |

### 7.3 Real cards (KB owner, outside the repository)

Needs a read-only service account's **classic** Confluence API token.

```bash
mkdir -p ~/apty-kb
```

```bash
export CONFLUENCE_EMAIL=<service-account-email> CONFLUENCE_TOKEN=<classic-read-only-token>
```

```bash
pnpm --dir ~/apty-super-hero kb:pack --space A4PKH --root 1509720081 --version 4.x
```

```bash
pnpm --dir ~/apty-super-hero kb:pack --space JA --root 1496711169 --version 5.x
```

```bash
pnpm --dir ~/apty-super-hero kb:eval --pack ~/apty-kb/apty-kb-A4PKH-4.x-<yyyymmdd>.kbpack.json --questions ~/apty-kb/questions-4x.json --calibrate --by-category
```

```bash
pnpm --dir ~/apty-super-hero kb:eval --pack ~/apty-kb/apty-kb-JA-5.x-<yyyymmdd>.kbpack.json --questions ~/apty-kb/questions-5x.json --calibrate --by-category
```

Rebuild each pack with the printed `--coverage-min` and
`--coverage-min-idf`, run `kb:eval` again without `--calibrate`, and record
the numbers (ids only) in the PR and on the handbook page F15. Each
questions file (kept in `~/apty-kb/`, never in the repository) has 60 or
more questions with at least 9 not covered and every category in 7.2; write
them in your own words from the cards, not copied. When the 5.x tree moves
to the 5.x hub, change `--space` and `--root`.

### 7.4 Manual run in Chrome

Load `apps/browser-extension/dist` unpacked, import the demo packs (K20) or
the real ones, then:

| # | Do | Expect |
| --- | --- | --- |
| 1 | No AI key. Ask a covered symptom in your own words | KB matches card, top 3, one excerpt each, version label, "Verified on", NOT VERIFIED badge where marked; no model request (DevTools → Network on the side panel shows none) |
| 2 | No AI key. Ask "how do I configure X" with no symptom | No KB card (D-KB1) |
| 3 | AI key. Ask a follow-up on a finding | `search_kb` called (tool card); answer cites `kb://…`; links open the card in its own space; no phrase flagged by K18 |
| 4 | Ask "where is the Widget Activation toggle" | "The KB has no setting called Widget Activation"; no card presented as the answer |
| 5 | Ask about SSO, pricing or mobile | "Not covered", suggests Ask Dapty |
| 6 | Ask something only a stub covers | "The card exists, its text is not written yet", with its link |
| 7 | Ask "what does segments.json returning 403 mean" | The mirror card, layer 3 first |
| 8 | 4.x tenant in Injected mode: "widget not showing" | Capture and reload, 4.x verdict, 4.x card text under each cause |
| 9 | 4.x tenant in Extension mode: same | The six HAR steps; after the HAR import, 4.x verdict |
| 10 | 5.x tenant with the Apty Client connected: same | 5.x verdict as today, 5.x card text |
| 11 | Both packs loaded, version unknown | Hits labelled by version, the "which version" question, no mixed instruction |
| 12 | Ask in Chinese | The English-cards notice |
| 13 | Options → Knowledge base: remove 4.x, reload | 5.x still loaded; 4.x questions now "not covered" or asks to import 4.x |

## 8. Connecting the RAG and the Apty Client to the extension

This is what K19 puts in the docs; it is also the manual setup for 7.4.

1. **Build and load the extension.** `pnpm install --frozen-lockfile`,
   `pnpm build`; `chrome://extensions` → Developer mode on → **Load
   unpacked** → `apps/browser-extension/dist`. After every rebuild click the
   reload icon on the extension's card.
2. **Get a pack.** Real: the KB owner runs section 7.3 and shares the files
   on a restricted internal page. Demo: `pnpm kb:demo-pack --version 4.x`
   and `--version 5.x`.
3. **Import it.** Options (right-click the toolbar icon → Options) →
   Settings → General → **Knowledge base** → **Import pack…**, once per
   version. Check the rows and the Preflight rows.
4. **AI provider (optional).** Options → AI: provider, key, model; **Test**.
   Without a key the KB matches card and the verdict card still work.
5. **Apty Client, 5.x.** Options → Connection → **Apty Client** →
   **Detect** (or paste its extension ID) → **Connect**. The Client must
   list this extension's IDs in `externally_connectable.ids` and include
   the Agent bridge module (`docs/integrations/apty/README.md`); Preflight
   names the exact fix if not. Without it, the content CDN fallback reads
   the same public files (Settings → Apty Integration).
6. **Apty Client, 4.x.** Not connectable until the bridge (K15 C) ships.
   Injected mode: the checks read the page's network capture. Extension
   mode: the service-worker HAR steps (K15 B).

## 9. Out of scope

- A hosted vector database, Confluence calls from the extension, indexing
  Ask Dapty answers (MASTER.md §6).
- K7 dense vectors: decide again only after this file is done, on the real
  sets, with the D-KB8 gate.
- Writing the missing 4.x cards: KB work; K17 makes their absence visible.
- A 4.x port of `element-not-found` and `page-readiness` (next prompt).

## Status

**DONE, with three steps partial** (2026-11-09). Every package K10–K20
landed on `claude/charming-knuth-g0d7ab`, one commit per package, each
green; the synthetic set passes every question for 4.x and 5.x.

Partial, and what finishes each:

1. **Real cards (section 7.3, acceptance 4).** No classic Confluence token
   was available, so no real pack was built or evaluated here. The KB owner
   runs the commands in section 7.3 (and in
   `docs/development/kb-rag.md`, "Lifecycle: the KB owner"), rebuilds with
   the printed coverage flags and records the D-KB8 numbers (ids only) on
   F15.
2. **4.x check packs from a checkout (K14).** apty-assist was not readable
   from this environment, so the 4.x rules follow the behaviour this file
   states, citing the files it names with their lines to be confirmed;
   causes other than `app-urls.json` cite the A4PKH tree (1509720081) until
   the KB owner names their cards. Finish: check each `W4X`/`C4X` rule
   against `player3.0` at a pinned commit, put the commit in
   `FOUR_X_VERIFIED_ON`, and replace `CARD_4X_TREE` with each cause's card.
3. **4.x Client bridge (K15 C).** Written as a change description in
   `docs/integrations/apty/4X-BRIDGE.md`; the apty-assist PR is not made
   (no access).
