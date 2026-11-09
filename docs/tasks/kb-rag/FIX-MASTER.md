# KB-RAG fixes (K10–K18): answer from the cards, for 4.x and 5.x

Owner prompt for making KB retrieval answer correctly from the RAG Answer
Cards in both Apty versions, saying "not covered" when the cards do not cover
a question, and diagnosing a 4.x tenant from its network calls. It builds on
[`MASTER.md`](MASTER.md) (K0–K9, done) and keeps all of its hard rules
(section 2): no KB text in the repository, no new permission or host, no
Confluence credential in the extension, `agent-core` platform-free,
deterministic ranking, every chunk cited, NOT VERIFIED carried through.

Base: `origin/main` at `11d2200` (2026-11-09). Status: NOT STARTED. Re-read
this file after a context compaction; never guess scope.

## 0. Why: what the 2026-11-09 audit measured

A pack was built from the real Apty 4.x Product Knowledge Hub (space `A4PKH`,
root page `1509720081`, "RAG Answer Cards") with this repository's own
`buildPack`, and scored with `eval-kb.mjs` on 60 edge-case questions (51 the
KB should cover, 9 it should not). The pack and the questions stayed outside
the repository.

| Measure | Result |
|---|---|
| Pages under the root / cards packed / chunks | 118 / 90 / 360 (28 skipped: 23 "4.x version not yet written" stubs and the "start here" routing pages, correctly, but reported only as "has 0 layers") |
| Recall@1 / Recall@3 / MRR | 0.667 / 0.804 / 0.749 |
| "Not covered" precision / recall, no threshold | 0.50 / 0.11 |
| Same, best calibrated threshold (22.96) | 0.67 / 0.44 |
| Same, threshold 150 | 0.31 / 1.00, but Recall@3 falls to 0.51 |
| Network-response questions (`app-urls.json`, `flow.json`, `segments.json`) | Right card every time; layer 3 first when the question names a status code or the Network tab |

The defects, each with the work package that fixes it:

| # | Defect | Evidence | Fix |
|---|---|---|---|
| D1 | "Not covered" is a raw BM25 score threshold. BM25 sums over query terms, so a long off-topic question outscores a short covered one; no threshold separates them. | "where is the Widget Activation toggle and Allowed Domains list" (the invented settings MASTER.md §0 was written against) returned 3 cards as `ok`; so did SAML SSO, licence price, iOS support, "kubernetes CrashLoopBackOff". | K10 |
| D2 | The card's `Symptom:` line (the sentence written in the user's words) is never indexed; the title boost (3) lets one shared title word ("user", "tooltip") win; no stemming or synonyms. | Paraphrases miss: "every user sees it" ranks a "one user cannot see it" card first; "French users see English" finds no language card in the top 3; "guide jumps to step 4", "keeps coming back every login", "Content-Security-Policy refused" rank the right card 2nd or lower. | K11 |
| D3 | Packs are 5.x only: `aptyVersion: z.literal("5.x")`, the builder always writes `"5.x"`, the store holds one pack, `KB_CARD_PAGE_BASE` is hard-coded to space JA, nothing knows the tenant's version. | A pack built from `A4PKH` is labelled 5.x. An SE with 4.x and 5.x customers can load only one, and gets the other version's cards silently. | K12 |
| D4 | `playerVersionOf` treats `app-urls.json` and `app-data.json` as 5.x markers. The 4.x player reads both (apty-assist `player3.0/src/shared/helpers/cdn-helpers.ts:17,23`). | A 4.x tenant seen before `flow.json` loads is called 5.x, so the regex URL flags are assumed off (`widget-not-visible.ts:210`). | K13 |
| D5 | A 4.x tenant gets no diagnosis. Every check stops at the version gate (`CNV-V5`, "nothing was concluded"). In Extension mode the 4.x player fetches every content file through `chrome.runtime.sendMessage` to its own background (`player3.0/src/api/http.ts:249`), which tab-level CDP capture never sees, and its manifest has no `externally_connectable`, so the Agent cannot ask it. The CDN fallback is 5.x only. | A 4.x "widget not showing" question gets no evidence and no answer. | K14, K15 |
| D6 | The no-key KB matches card only fires on a symptom regex (`kb-matches.ts:15`). 38 of the 102 real 4.x card titles do not pass it. | Missed words: flickers, jumps, slow/slower, freezes, hangs, repeats, "again and again", invisible, cropped, duplicates, "does nothing", "still shows", "no balloon appears", rejected, skips, differ, and every "`<file>`.json response, what it means" question. A Chinese question returns nothing (the cards are English). | K16 |
| D7 | Stub cards and routing cards vanish from the pack, so a question that only a stub covers gets the nearest wrong card. | "bulk publish over 10 workflows", "analytics events missing in Admin", "on-prem ClickHouse migration", "`rules.json` response", "`flow-ID.json` response" all returned unrelated cards as `ok`. | K17 |
| D8 | The model can still name a setting no chunk contains; nothing checks the answer. | Prompt-only guard (`constants.ts`, "Never name an Apty setting… not in a returned chunk"). | K18 |

## 1. Owner decisions needed before K12 (record in `decisions.md` and `DECISIONS.md`)

| Id | Decision | Default proposed |
|---|---|---|
| D-KB6 | Amend D-KB4 and MASTER.md §6: 4.x cards are in scope. Sources: Apty 4.x Product Knowledge Hub (`A4PKH`, root `1509720081`), Apty 5.x Product Knowledge Hub (its RAG Answer Cards root once moved; until then JA `1496711169`), Apty KB - Common for cards the same in both. | Accept |
| D-KB7 | Amend MASTER.md §6 ("4.x cards out of scope") for the check packs too: the Agent diagnoses 4.x tenants, starting with "widget not showing" and "content not showing", from 4.x code (apty-assist) with file and line citations. | Accept |
| D-KB8 | Quality gate on the real question set (now that a baseline exists, End goal §9): Recall@3 ≥ 0.90, "not covered" precision ≥ 0.90 and recall ≥ 0.80, per version. | Accept, or name other numbers |
| D-KB9 | The 4.x Client bridge (K15 option C) needs a change in apty-assist (`player3.0` background). Ship it, or rely on the guided HAR path only. | HAR path now, bridge as a follow-up ticket |

## 2. Hard rules (in addition to MASTER.md §2)

1. Every behaviour change gets a unit test that fails on the old code first.
   Anything that crosses the Chrome boundary also gets an E2E in `tooling/e2e/`.
2. Test cards stay synthetic. Write synthetic cards that reproduce each defect
   in section 0 (a long off-topic question, a paraphrase that needs the
   symptom line, a title-word collision, a stub card, a 4.x and a 5.x card
   with the same title). Never copy a real card's text, title or symptom
   line into the repository; page ids are fine.
3. Schema v2 must still import v1 packs (read as `aptyVersion: "5.x"`,
   no `symptom`, no `status`, no coverage settings, behaving exactly as today).
4. Search stays deterministic (P8) and platform-free. No new runtime
   dependency in `agent-core` without a licence check (`npm run
   check:dist-licences`); a stemmer is about 100 lines, so write it.
5. Every 4.x check-pack rule cites the apty-assist file and line it comes
   from, like the 5.x rules cite apty-dap; anything not confirmed in code is
   marked not runtime-verified, like today.
6. After each work package: `npm run preflight`, `npm run build`, the E2E
   files you touched, `npm run lint:dependencies`, `npm run audit:architecture`,
   `npm run audit:tools`, `npm run audit:kb-pack`. Paste results and counts
   in the PR.

## 3. Work packages

Order: K13 (small, independent), K10, K11, K17, K16, K12, K18, K14, K15.
One branch and one PR each. Run the real-pack evaluation (section 5.3) after
K10, K11, K17 and K12 and paste the before and after numbers, ids only.

### K10. A "not covered" decision that does not depend on query length

`packages/agent-core/src/kb/search.ts`, `pack.ts`; `tooling/scripts/kb/eval-kb.mjs`.

- Keep BM25 for **ranking**. Decide **coverage** on the top hit with a
  length-independent measure:
  - Query terms: the processed terms (stop words removed, stemmed by K11),
    distinct.
  - `idf(t) = ln(1 + N / (1 + df(t)))` over the chunks; a term that appears
    in no chunk gets `ln(1 + N)` (the highest weight: it is the term the KB
    has never heard of, like "saml", "kubernetes", "ios", "licence").
  - `coverage = Σ idf(t) for t matched in the top card (title, symptom, its
    chunks) / Σ idf(t) for all query terms`. An exact or stemmed match counts
    1, a fuzzy-only match 0.5, a synonym (K11) 0.8.
  - Covered when `coverage ≥ retrieval.coverage.min` **and** at least
    `retrieval.coverage.minTerms` (default 1) matched terms have
    `idf ≥ retrieval.coverage.minIdf` (so "apty" or "user" alone never
    covers anything).
  - A quoted or Title Case phrase of two or more words in the query
    ("Widget Activation", "Allowed Domains") counts as covered only when that
    phrase appears in the top card's text; if any such phrase is missing,
    the result is `not_covered` with `reason: "unknown_setting"`, and the
    missing phrase is returned so the answer can say "the KB has no setting
    called …".
- `KbSearchResult` gains `coverage: number` and `reason?: "no_match" |
  "low_coverage" | "unknown_setting"`. `search_kb` passes `reason` and
  `missingPhrases` to the model.
- Keep `retrieval.threshold` (v1) working; v2 packs carry
  `retrieval.coverage: { min, minIdf, minTerms }` instead.
- Disable fuzzy matching for a term that exists exactly in the vocabulary,
  and for terms shorter than 6 characters ("rules" must not fuzz to
  "roles").
- `eval-kb.mjs --calibrate` searches `min` (0.05 steps) and `minIdf`
  (quantiles of the vocabulary's idf) for the best Youden J
  (not-covered recall + covered recall − 1) under the constraint Recall@3
  does not drop more than 0.02. It prints the chosen values for
  `kb:pack --coverage-min … --coverage-min-idf …`.
- Tests: the long off-topic synthetic question is `not_covered` whatever its
  length; a two-word covered question is `ok`; a Title Case setting absent
  from the cards gives `unknown_setting`; the same pack and query give the
  same coverage to the last digit; a v1 pack with `threshold` behaves as
  today.

### K11. Index what the user says: symptom line, stemming, synonyms, layer hints

`build-kb-pack.mjs`, `pack.ts`, `search.ts`.

- Builder: read the card's `Symptom:` line from the intro (before Layer 1),
  as it reads `Verified on:`; store it as `card.symptom` (string or null, at
  most 300 characters). Report cards with no symptom line.
- Index a per-card **symptom** field: boost title 2 (was 3), symptom 2.5,
  heading 1.5, text 1. The symptom is indexed once per card, on its layer 1
  chunk only, so it does not count four times.
- Light English stemmer in `processTerm` (plural, -ing, -ed, -er/-est,
  -ly; "flickering"→"flicker", "repeats"→"repeat", "slower"→"slow") applied
  at index and query time. File names (`app-urls.json`, `flow-ID.json`,
  `segments.json`) stay whole tokens as well as their parts, so a file
  question matches its mirror card exactly; `flow-123.json` normalizes to
  `flow-ID.json`.
- Synonyms: `packages/agent-core/src/kb/synonyms.ts`, a generic Apty
  vocabulary list (no card text), expanded at query time with weight 0.8:
  balloon / tooltip / popup / bubble; workflow / walkthrough / guide / flow;
  reload / refresh; production / prod / live; test / UAT / staging / QA;
  freeze / hang / unresponsive / crash; slow / sluggish / lag; disappear /
  vanish / missing; repeat / again / "keeps coming back" / every time;
  language / translated / translation / locale / French / German / Spanish /
  Japanese / Chinese (any language name); split step / decision step /
  branch; launcher / button / icon; segment / audience / user group;
  publish / release / go live; selector / XPath / CSS; CSP /
  Content-Security-Policy / nonce. A pack may extend it with
  `retrieval.synonyms` (the KB owner's local file, `kb:pack --synonyms`).
- Layer hint, a ranking boost (×1.3), never a filter: Network tab, status,
  `\b[1-5]\d\d\b`, response, request, `.json`, HAR → layer 3; Console,
  Elements, DevTools, selector, XPath, DOM → layer 2; Studio, Admin,
  setting, configure, publish → layer 1; support, ticket, escalate, contact
  → layer 4.
- Tests: the paraphrase that only the symptom line answers ranks its card
  first; a title-word collision no longer outranks the symptom match;
  "flickering"/"flickers" and "refresh"/"reload" match the same card; a
  status-code question ranks layer 3 first; `flow-123.json` finds the
  `flow-ID.json` card.

### K12. Version-aware packs (needs D-KB6)

`pack.ts` (schema v2), `build-kb-pack.mjs`, `kb-store.ts`, `kb-index.ts`,
`tools/kb.ts`, `knowledge-base-card.tsx`, `kb-citations.ts`,
`kb-matches-card.tsx`, i18n en and zh.

- Schema v2: `aptyVersion: "4.x" | "5.x" | "common"`; `card.url` is used
  for every link (drop the hard-coded `KB_CARD_PAGE_BASE`, keep it only as
  the v1 fallback); `card.symptom`, `card.status` (K17), `retrieval.coverage`
  (K10).
- Builder: `--version 4.x|5.x|common` is required when `--space` is not
  one it knows (`A4PKH` → 4.x, the 5.x hub's key → 5.x, `JA` → ask). The
  file name gains the version: `apty-kb-<space>-<version>-<yyyymmdd>.kbpack.json`.
- Store: one active pack **per version** (keys `4.x`, `5.x`, `common`);
  `info()` lists them; replacing one leaves the others. IndexedDB schema
  upgrade keeps a stored v1 pack as `5.x`.
- The tab's version comes from the evidence (`playerVersionOf`, fixed in
  K13), else the user's choice in the chat ("This tenant runs Apty 4.x /
  5.x"), remembered per site host for the conversation. Search reads
  `<that version> + common`. Unknown version: search both, label every hit
  with its version, and if the top hits come from different versions say so
  instead of merging them.
- `search_kb` results carry `aptyVersion`; the prompt section says: "State
  the Apty version the answer is for. Never combine statements from 4.x and
  5.x chunks into one instruction."
- Options → Knowledge base lists each loaded pack (version, space, cards,
  stubs, built date, age warning) with Import / Replace / Remove per
  version. Preflight reports each.
- Tests: v1 import still works; a 4.x and a 5.x pack load side by side; a
  4.x tab never gets a 5.x-only hit; unknown version labels both; links use
  `card.url` (space `A4PKH` for a 4.x card); E2E: import two packs, reload,
  both still loaded; axe in both themes.

### K13. Tell 4.x from 5.x correctly

`packages/browser-runtime/src/apty/diagnosis/pack-kit.ts`.

- `app-urls.json` and `app-data.json` are read by both players: remove them
  from `FIVE_X_MARKERS`. 5.x-only: `workflow.json`, `segment.json`,
  `rule.json`. 4.x-only: `flow.json`, `segments.json`, `rules.json`,
  `feature-flag.json`, and a `flow-<id>.json` name (check each against
  apty-assist `cdn-helpers.ts` and apty-dap's CDN service before adding it;
  `config.json` too, which the 4.x Studio reads from its own extension, not
  the CDN, so confirm it ever appears in a tenant's calls or drop it).
- Shared files only → `"unknown"`, and `widget-not-visible` treats unknown
  as "regex flags may be on", as today.
- Tests: evidence with only `app-urls.json` + `app-data.json` is
  `unknown`; with `flow.json` it is `4.x`; with `workflow.json` it is `5.x`.

### K14. 4.x check packs: widget not showing, content not showing (needs D-KB7)

`packages/browser-runtime/src/apty/diagnosis/` (new `*-4x.ts` beside the 5.x
files, shared helpers in `pack-kit.ts`).

- Replace the `CNV-V5` gate: when the files are 4.x, run the 4.x pack;
  keep the gate only for `unknown` with no 4.x pack loaded.
- Widget not showing (4.x): read `app-urls.json`; match environments the
  4.x way (apty-assist player code: `*` matches anything, other characters
  exactly, the pattern may match anywhere in the full top-window address;
  applications tried in file order, first match wins; patterns also tried as
  regular expressions when the tenant's regex URL feature flag is on, read
  from `feature-flag.json`); an empty list or a failed request (the 4.x
  player turns a failure into `[]`, so report the status code); then
  `app-data.json`'s environment (player on, widget setting).
- Content not showing (4.x): `flow.json` (published, environment),
  `flow-<id>.json` steps, `segments.json` and `rules.json` against the
  user, the same way the 5.x pack does for its files.
- Each 4.x rule: its own id family (`W4X-…`, `C4X-…`), a cause cites the
  **4.x** card page id (constants in the file, ids only) and the layer
  (`card-layers.ts`), the apty-assist file and line in a comment, and the
  "4.x code, apty-assist `<commit>`, not runtime-verified" line.
- Fixtures: synthetic 4.x files under `diagnosis/fixtures/content-4x/`.
- Tests: one per rule, plus the version routing; extend
  `visibility-check.e2e.test.mjs` with a 4.x tenant fixture.

### K15. 4.x evidence: get the network calls

The Agent cannot see a 4.x Extension-mode player's calls on its own (D5).
Three paths, in this order:

- **A. Injected mode (works today, wire it up):** the 4.x injected player
  fetches from the page, so `start_network_capture` sees the calls. Make the
  4.x checks read a capture's matching requests as evidence (as
  `har-check.ts` reads a HAR), and say in the result "read from the page's
  network capture".
- **B. Guided HAR from the 4.x service worker (Extension mode):** when the
  tab looks like a 4.x tenant and no files were observed, the verdict card
  shows numbered steps with copy buttons:
  1. `chrome://extensions` → Developer mode on → Apty (the 4.x Client) →
     **Inspect views: service worker**;
  2. in that DevTools window: Network → tick **Preserve log**;
  3. reload the application tab and reproduce the problem;
  4. Network → right-click → **Save all as HAR with content**;
  5. drop the HAR on the side panel (the existing HAR import), which runs
     the 4.x checks on it.
  The HAR's page URL comes from the tab when the HAR has none (a
  service-worker HAR has no page entry), with the user's confirmation.
- **C. 4.x Client bridge (needs D-KB9; apty-assist, separate PR):** add
  `externally_connectable: { ids: [<Agent IDs>] }` to the 4.x player
  manifest and a `chrome.runtime.onMessageExternal` handler in
  `player3.0/src/background-scripts/` that records its `GetDataFromCDN`
  calls (URL, status, time, body capped and passed through the same deny
  list) and answers the existing `apty-debug-agent:*` contract
  (`docs/integrations/apty/README.md`). Then the Agent's
  `inspect_extension_network` works for 4.x unchanged.
- Tests: A with a synthetic page serving 4.x files in the E2E harness; B
  with a synthetic service-worker-shaped HAR (no page entry); C is tested in
  apty-assist.

### K16. Show KB matches for every symptom, and say why when nothing shows

`packages/browser-runtime/src/kb/kb-matches.ts`, `responder.ts`.

- Invert the gate: run the local KB search for **every** message that no
  check pack claims, and show the KB matches card when K10 says `covered`,
  unless the message is a bare how-to with no symptom (D-KB1). Detect the
  how-to instead of the symptom: starts with or is mainly "how do I / how
  to / how can I / can I configure / where is the setting / what is the
  setting", with no symptom word.
- Widen the symptom list as a second signal for the how-to check: flicker,
  jump, slow, lag, freeze, hang, repeat, again, invisible, unreadable,
  cropped, duplicate, nothing happens, does nothing, still shows, late,
  inconsistent, differ, rejected, skip, "no <noun> appears", every user,
  wrong, plus the existing words (stemmed by K11).
- A message mostly in a non-Latin script when the pack is English: no KB
  card, and a one-line notice "The KB cards are in English; ask in English
  or send the question to the model" (both strings in en and zh).
- A file question ("what does `segments.json` mean", "`app-urls.json`
  returned []") is answered by its mirror card, with layer 3 first.
- Tests: each new word fires; a pure how-to does not; a check pack still
  wins; the Chinese notice; E2E with no AI key for one of each.

### K17. Stubs and routing cards are first-class

`build-kb-pack.mjs`, `pack.ts`, `search.ts`, `kb-matches-card.tsx`,
`tools/kb.ts`.

- Builder: classify each page: `full` (exactly layers 1–4), `stub` (the
  intro says the version is not yet written, no layers), `routing` ("start
  here" pages), `malformed` (anything else, still skipped). Report counts per
  class. Stubs and routing cards go in the pack with title and symptom only
  and no chunks.
- Search: stubs and routing cards are indexed on title and symptom. When a
  stub is the best covered match, the result is
  `status: "stub"` with the card's title and link: "The KB has a card for
  this, but its `<version>` text is not written yet", never the next full
  card. A routing card is never returned as an answer; its symptom only
  helps ranking.
- Options shows "N cards, M not yet written". Eval counts a stub as a hit
  when it is the expected card.
- Tests: a question only a stub covers returns `stub`, not another card;
  routing cards never appear in hits.

### K18. Check the answer against the cited chunks

`packages/ui/src/lib/kb-citations.ts` (or a new `kb-grounding.ts`),
message rendering.

- After an answer that used `search_kb`, find each quoted phrase and each
  Title Case phrase of two or more words (and every `kb://` cite). A phrase
  that appears in none of the cited chunks gets a dotted underline and a
  tooltip "Not found in the cited KB cards"; a cite id that was not returned
  in this turn is shown as "unknown citation" and not linked.
- Deterministic, no model call; strings in en and zh; never rewrites the
  answer.
- Tests: an invented setting name is flagged; a setting in the cited chunk
  is not; code spans are ignored.

## 4. Acceptance

- On the real question sets (4.x and 5.x, kept outside the repository), the
  D-KB8 numbers hold per version, and the PR shows before and after.
- The section 0 failures all pass: the invented-settings question is
  `not_covered` / `unknown_setting`; SAML, pricing, iOS, Kubernetes,
  "chrome is not opening" are `not_covered`; the paraphrases rank their card
  in the top 3; stub-only questions return `stub`.
- A 4.x tenant in Injected mode gets a 4.x verdict from a network capture;
  in Extension mode, from a service-worker HAR; neither cites a 5.x card.
- A v1 pack still imports and searches as before.
- All checks in rule 6 green; no card text anywhere in the repository, CI
  logs, artifacts or release zips.

## 5. How to test

### 5.1 Unit and E2E (in the repository, synthetic cards only)

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @apty/agent-core exec vitest run src/kb
pnpm --filter @apty/browser-runtime exec vitest run src/kb src/tools/kb.test.ts src/storage/kb-store.test.ts src/apty/diagnosis
node --test tooling/scripts/kb/*.test.mjs
node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/knowledge-base.e2e.test.mjs tooling/e2e/kb-answer.e2e.test.mjs tooling/e2e/kb-matches.e2e.test.mjs tooling/e2e/visibility-check.e2e.test.mjs tooling/e2e/har-check.e2e.test.mjs
npm run preflight
```

Before any change, the baseline is 413 runtime tests (KB, diagnosis,
network), 18 agent-core KB tests and 24 builder and eval tests, all passing.

### 5.2 Synthetic edge-case set (CI)

Extend `tooling/scripts/kb/fixtures/synthetic-cards.mjs` and
`synthetic-questions.json` with one invented card and question per category
below, and give each question a `category` field; `eval-kb.mjs --by-category`
prints the metrics per category.

| Category | What it checks |
|---|---|
| paraphrase | the user's words, not the title's |
| symptom-line | answered only by a card's symptom line |
| collision | a shared title word must not win |
| typo | one or two letters off |
| short | one or two words |
| multi | two symptoms in one question |
| network-file | a file name, a status code, an empty `[]` |
| layer | settings vs Console vs network vs support |
| stub | only a stub card covers it |
| version | the same title in a 4.x and a 5.x card |
| not-covered-long | a long off-topic question |
| not-covered-setting | an invented Title Case setting name |
| not-covered-domain | another product area (SSO, billing, mobile, infra) |
| non-english | a question in Chinese |

### 5.3 Real cards (KB owner, outside the repository)

```bash
mkdir -p ~/apty-kb && cd ~/apty-kb
export CONFLUENCE_EMAIL=<service-account-email> CONFLUENCE_TOKEN=<classic-read-only-token>
pnpm --dir ~/apty-super-hero kb:pack --space A4PKH --root 1509720081 --version 4.x --out ~/apty-kb/apty-kb-A4PKH-4.x.kbpack.json
pnpm --dir ~/apty-super-hero kb:pack --space JA --root 1496711169 --version 5.x --out ~/apty-kb/apty-kb-JA-5.x.kbpack.json
pnpm --dir ~/apty-super-hero kb:eval --pack ~/apty-kb/apty-kb-A4PKH-4.x.kbpack.json --questions ~/apty-kb/questions-4x.json --calibrate --by-category
pnpm --dir ~/apty-super-hero kb:eval --pack ~/apty-kb/apty-kb-JA-5.x.kbpack.json --questions ~/apty-kb/questions-5x.json --calibrate --by-category
```

Rebuild each pack with the suggested `--coverage-min` and
`--coverage-min-idf`, re-run `kb:eval`, and record the numbers (ids only) in
the PR and on F15. Keep 60 or more questions per version, at least 9 of them
not covered, covering every category in 5.2. When the 5.x tree moves to the
5.x hub, change `--space` and `--root`.

### 5.4 Manual run in Chrome (each scenario, both versions)

| # | Do | Expect |
|---|---|---|
| 1 | No AI key. Ask a covered symptom in your own words | KB matches card, top 3, one excerpt each, version label, no model request |
| 2 | No AI key. Ask "how do I configure X" with no symptom | No KB card (D-KB1) |
| 3 | AI key. Ask a follow-up on a finding | Answer cites `kb://…`; links open the card in its own space; no phrase flagged by K18 |
| 4 | Ask "where is the Widget Activation toggle" | "The KB has no setting called Widget Activation", no card text presented as an answer |
| 5 | Ask about SSO, pricing or mobile | "Not covered", suggests Ask Dapty |
| 6 | Ask something only a stub covers | "Card exists, text not written yet" with its link |
| 7 | 4.x tenant, Injected mode: "widget not showing" | Network capture runs, 4.x verdict, 4.x card text under each cause |
| 8 | 4.x tenant, Extension mode: same | Guided HAR steps; after the HAR import, 4.x verdict |
| 9 | 5.x tenant with the Client connected: same | 5.x verdict as today, 5.x card text |
| 10 | Both packs loaded, unknown version | Hits labelled by version; no mixed instruction |
| 11 | Ask in Chinese | English-cards notice |

## 6. Out of scope

- A hosted vector database, Confluence calls from the extension, indexing
  Ask Dapty answers (unchanged from MASTER.md §6).
- K7 dense vectors: re-run its decision only after K10–K17, on the real sets.
- Writing the 23 missing 4.x cards: that is KB work; K17 makes their absence
  visible instead of answering wrongly.
