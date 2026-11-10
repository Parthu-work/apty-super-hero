# KB retrieval (KB-RAG)

The Agent finds the RAG Answer Card for a finding or a symptom, shows its
text in the side panel and grounds follow-up answers in it with a citation,
for Apty 4.x and 5.x tenants alike. It runs entirely in the browser: no
server, no vector database, no Confluence call and no new permission in the
extension. The owner prompts are [`MASTER.md`](../tasks/kb-rag/MASTER.md)
(K0–K9) and [`FIXES.md`](../tasks/kb-rag/FIXES.md) (K10–K20); the owner's
decisions are in [`decisions.md`](../tasks/kb-rag/decisions.md) (D-KB1 to
D-KB9).

To try it in ten minutes with synthetic cards, follow the root
[README](../../README.md#try-it-locally-in-10-minutes).

## Design

```
Confluence                                      pnpm kb:pack, KB owner's machine
  A4PKH (root 1509720081)      --version 4.x  ─┐  (CONFLUENCE_EMAIL / TOKEN)
  JA    (root 1496711169)      --version 5.x  ─┤
  Apty KB - Common             --version common┘
         │
         ▼
apty-kb-<space>-<version>-<date>.kbpack.json      ← never in this repository
         │  shared on a restricted internal page; each SE imports each version
         ▼
Options → Settings → General → Knowledge base → IndexedDB apty-kb-db
  pack:4.x  meta:4.x   pack:5.x  meta:5.x   pack:common  meta:common
         │
         │   tab version: a check's files (playerVersionOf), else the
         │   user's "Apty version: 4.x / 5.x / Not sure"; unknown = every pack
         ▼
  ├─ verdict card: "From the KB card" under each cause (no model)
  ├─ KB matches card: a message no check pack claims (no model)
  ├─ search_kb: the model's answers, cited kb://<pageId>#L<layer>
  └─ grounding check: phrases the cited chunks do not hold are marked
```

| Part | Code |
|---|---|
| Pack builder | `tooling/scripts/kb/build-kb-pack.mjs` (`pnpm kb:pack`) |
| Demo pack | `tooling/scripts/kb/build-demo-pack.mjs` (`pnpm kb:demo-pack`) |
| Schema, checksum, limits, links | `packages/agent-core/src/kb/pack.ts` (`parseKbPack`, `kbCardUrl`) |
| Search, coverage, layer hints | `packages/agent-core/src/kb/search.ts` (`createKbIndex`) |
| Several packs at once | `packages/agent-core/src/kb/index-set.ts` (`createKbIndexSet`) |
| Text analysis, stemmer, synonyms | `packages/agent-core/src/kb/text.ts`, `stem.ts`, `synonyms.ts` |
| Storage, one pack per version | `packages/browser-runtime/src/storage/kb-store.ts` (`createKbPackStore`) |
| Index per version, tool result | `packages/browser-runtime/src/kb/kb-index.ts` |
| Tab version | `packages/browser-runtime/src/kb/kb-version.ts` |
| Symptom, how-to and script rules | `packages/browser-runtime/src/kb/kb-intent.ts` |
| KB matches answer | `packages/browser-runtime/src/kb/kb-matches.ts`, `createDiagnosisResponder` |
| The model's tool | `packages/browser-runtime/src/tools/kb.ts` (`search_kb`) |
| When the tool is offered | `packages/browser-runtime/src/tools/tool-relevance.ts` |
| Layer a cause reads | `packages/browser-runtime/src/apty/diagnosis/card-layers.ts` |
| Options card | `packages/ui/src/components/settings/knowledge-base-card.tsx` |
| Citations and grounding | `packages/ui/src/lib/kb-citations.ts`, `kb-grounding.ts` |
| Verdict card text, version control | `apps/browser-extension/src/components/investigation/kb-card-excerpt.tsx`, `kb-version-control.tsx` |
| KB matches card | `apps/browser-extension/src/components/investigation/kb-matches-card.tsx` |
| Evaluation | `tooling/scripts/kb/eval-kb.mjs` (`pnpm kb:eval`) |
| Repository guard | `tooling/scripts/check-no-kb-pack.mjs` (`npm run audit:kb-pack`) |

## The pack (schema 2)

One JSON file per version. `parseKbPack` reads schema 1 and 2 and returns
the schema 2 shape: a schema 1 pack is a 5.x pack of full cards with no
symptom, and keeps its `retrieval.threshold` and its search exactly as
before.

| Field | Meaning |
|---|---|
| `kind` | `"apty-kb-pack"`, the marker `audit:kb-pack` fails the repository on |
| `schemaVersion` | `2` (the builder's); `1` is still read |
| `builtAt`, `builder` | ISO time, builder version |
| `source.site`, `.space`, `.label`, `.cardCount` | Where the cards came from; `label` is `ancestor:<root>` for the tree |
| `aptyVersion` | `"4.x"`, `"5.x"` or `"common"` |
| `retrieval.bm25` | `true` |
| `retrieval.coverage` | `{ min, minIdf, minTerms }`, calibrated by `kb:eval --calibrate`; absent: `{ 0.5, 1.5, 1 }` |
| `retrieval.synonyms` | The KB owner's own synonym groups (`kb:pack --synonyms`), added to the built-in ones |
| `retrieval.threshold` | Schema 1 only: the BM25 score below which a question was not covered |
| `retrieval.dense` | Optional vectors (K7, not shipped) |
| `cards[].pageId`, `.title`, `.group`, `.url`, `.updatedAt` | The card; `url` is its own page in its own space |
| `cards[].verifiedOn` | The card's "Verified on" line, verbatim, or null |
| `cards[].symptom` | The card's "Symptom:" line (at most 300 characters), or null |
| `cards[].status` | `"full"`, `"stub"` (its text for this version is not written yet) or `"routing"` ("Start here") |
| `cards[].notVerifiedCount` | NOT VERIFIED statements in the card |
| `chunks[]` | One per layer of a full card: `id` (`<pageId>#L<layer>`), `pageId`, `layer` 1–4, `heading`, `text` (at most 1,000 characters), `notVerified`; none for a stub or routing card |
| `sha256` | Over the canonical JSON (keys sorted, no whitespace) without itself |

Limits: 25 MB, 5,000 chunks. Import errors: `too_large`, `not_json`,
`wrong_kind`, `wrong_schema_version`, `invalid` (with the field),
`checksum_mismatch`, `read_failed`.

## Retrieval

**Ranking (BM25).** A chunk's score is its card's score over the title
(boost 2) and the symptom line (2.5), indexed once per card, plus its own
score over the heading (1.5) and the text. The layer the question asks
about gets ×1.3 on its own part only, so the hint picks among a card's
layers without being outweighed by what all of them share:

| Layer | Words that point to it |
|---|---|
| 3, network data | Network tab, status, a status code (`403`), response, request, payload, `.json`, HAR, "means", "returned" |
| 2, Console and Elements | Console, Elements, DevTools, selector, XPath, DOM, inspect |
| 1, settings | Studio, Admin, setting, configure, publish, toggle |
| 4, support | support, ticket, escalate, contact, "send to" |

With no hint, a question naming a file prefers layer 3 and any other
layer 1. Ties go to the lower page id, then the lower layer.

**Terms.** Lower case, "doesn't" as "does not", function words dropped,
then a light deterministic stemmer (`stem.ts`: plurals, `-ing`, `-ed`,
`-ly`, a final `e`; `-er`/`-est` only for a listed comparative such as
"slower" or "bigger", so "player" and "header" stay nouns (K21 F6); never a
token with digits or dots). A
file name stays whole, its id normalized (`flow-123.json`,
`flow-<uuid>.json` and `flow-ID.json` are all `flow-id.json`), and its
parts follow it. Prefixes match from 4 characters. A typo is judged on the
word as typed, not its stem (K21 F5): 5 to 7 letters allow one edit, 8 or
more two, and only for a word no card holds; it is compared with the cards'
words before stemming and after (an unstemmed vocabulary is kept per
index). Ranking searches the matched card terms at weight 0.5 and coverage
counts them 0.5, so the two agree.

**Synonyms** (`synonyms.ts`, weight 0.8): balloon/tooltip/popup/bubble/hint;
workflow/walkthrough/guide/flow/tour; reload/refresh/F5;
production/prod/live; test/UAT/staging/QA/sandbox;
freeze/hang/unresponsive/stuck; crash/tab crashed/out of memory;
slow/sluggish/lag/laggy/performance; disappear/vanish/missing/gone;
repeat/again and again/shows again/appears again/keeps coming back/every
time/each login; language names and
locale/translation; split step/decision step/branch/condition;
launcher/button/beacon; widget/help icon/help panel/help widget/self-help;
segment/audience/user group/targeting;
publish/release/go live/deploy content; selector/XPath/CSS/locator;
CSP/Content-Security-Policy/nonce; CORS/cross-origin; iframe/frame/embedded;
shadow DOM/shadow root/LWC; skip/jump/starts at step. A bare "icon" and a
bare "again" are not synonyms: each matched an unrelated card (K21 F7), and
`search.test.ts` holds a collision question for every group.

**Coverage (is the question covered at all?).** BM25 sums over terms, so a
long off-topic question can outscore a short covered one; coverage does not
depend on length. Over the question's distinct terms,

```
idf(t)    = ln(1 + N / (1 + df(t)))      N = documents (chunks, and one per stub or routing card)
coverage  = Σ idf(t) · match(t) / Σ idf(t)
match(t)  = 1 exact or stemmed, 0.8 synonym, 0.5 typo or prefix, 0 none   (against the top card)
```

A word no card holds gets the highest idf, so "saml", "kubernetes" or
"licence" pull coverage down. The question is covered when coverage ≥
`coverage.min` **and** at least `coverage.minTerms` matched terms have idf
≥ `coverage.minIdf` (so "apty widget" alone is never covered).
Not covered: `reason: "no_match" | "low_coverage" | "unknown_setting"`.

**Setting-name guard.** It stops invented settings, and only those (K21
F1). A phrase is checked when it is quoted, or when it is a run of two or
more Title Case words (not a sentence's first word) within three words of a
setting cue: setting(s), toggle, option, checkbox, switch, flag, field,
enable, disable, turn on, turn off, set, configure. A run made only of
browser and platform terms (Developer Mode, Service Worker, Preserve Log,
Inspect Views, Network Tab, Console, Elements, DevTools, Chrome, Edge,
Google, Microsoft, Windows, macOS) or customer applications (Salesforce,
Lightning, Workday, SAP, ServiceNow, Oracle, Dynamics, SuccessFactors) is
never checked. A checked phrase must appear, stemmed, in some card of any
pack being searched (title, symptom or text; the lookup is built once per
index). Otherwise: `unknown_setting` with `missingPhrases`, e.g. "Widget
Activation".

**Stubs and routing.** A stub is searched on its title and symptom; when it
is the best covered match the result is `status: "stub"` with the card
(title, link, version, no text), never the nearest other card. A stub wins
only when it matches the question itself (K21 F2): it outscores the top
full card, its own coverage reaches `max(coverage.min, 0.5)`, it matches two
terms with idf ≥ `minIdf` (or the only one the question has), and one
matched term is not a generic symptom word (`GENERIC_SYMPTOM_TERMS`: show,
appear, work, load, open, display, see, missing, not, never, error, issue,
problem, page, user). Otherwise the full cards decide alone. A routing
card takes part in ranking and is never returned.

## Versions

- **Packs per version.** One active pack per version in IndexedDB
  (`pack:<version>`, `meta:<version>`), each pair written, replaced or
  removed in one IndexedDB transaction (K21 F8); the one pack an earlier
  Agent stored moves to 5.x on first open, in one transaction too.
- **Tab version.** A check's files decide it (`playerVersionOf`: 4.x reads
  `flow.json`, `segments.json`, `rules.json`, `feature-flag.json`,
  `flow-<id>.json`; 5.x reads `workflow.json`, `segment.json`, `rule.json`;
  `app-urls.json` and `app-data.json` are read by both and tell nothing).
  Otherwise the user's choice on the KB matches or verdict card, kept in the
  side panel's memory per site host, never in `chrome.storage`. `search_kb`
  takes an optional `aptyVersion` the model sets only when the user said it.
- **What is searched.** The tab's version and the common pack, or every pack
  when the version is unknown. Each pack is searched with its own index;
  BM25 scores from separate indexes are not comparable, so covered packs'
  hits are merged by rank, the packs taking turns: the tab's version, then
  common, then any other version (K21 F9). Each hit carries its version; when the top
  two differ, the card labels both and asks "These cards are for different
  Apty versions; which does this tenant run?", and the prompt forbids
  merging two versions' statements into one instruction.
- **Links.** Every link is the card's own page (`card.url`); a check pack's
  card with no pack loaded falls back to its version's space (A4PKH for 4.x,
  JA for 5.x).

## Where it shows

- **Verdict card.** A cause that cites a card gets **From the KB card**: the
  layer its rule reads (`cardLayerOf`), the "Verified on" line and a **Not
  verified** badge. The card says which Apty version its KB answers read.
- **KB matches card.** Any message no check pack claims is searched; a
  covered one shows the top 3 cards (title, version, one chunk each, link),
  a stub shows "The KB has a card for this, but its `<version>` text is not
  written yet." with its link, with no model call and no AI key. A bare
  how-to ("how do I / how to / can I / where is the setting / where do I
  configure / what is the setting for", with no symptom word) gets no card
  (D-KB1). A message mostly outside the Latin script gets "The KB cards are
  in English. Ask in English, or send the question to the model." when no
  model is configured, and goes to the model otherwise.
- **`search_kb`.** Offered with any Apty, network, DevTools, selector or
  check-pack question, any symptom word, a question in another script and a
  product follow-up ("setting", "in Studio", "send support"); not with a bare
  how-to, a request to fetch a file or casual chat. The prompt section says
  to answer only from the returned chunks, cite each claim, carry NOT
  VERIFIED, say so on `not_covered`, `unknown_setting` (naming the phrase,
  suggesting nothing similar) and `stub` (with the link), state the version,
  and search in English for a question in another language.
- **Grounding check.** After an answer in a turn whose `search_kb` calls
  returned cards, every setting-like phrase no returned chunk holds is
  underlined with the tooltip "Not found in the cited KB cards" and named
  under the answer; a `kb://` cite the turn did not return reads "unknown
  citation". Deterministic, no model call, the text unchanged.

## Lifecycle: the KB owner

Needs a read-only service account's **classic** Confluence API token (a
scoped token cannot use CQL search, and the builder says so).

```bash
mkdir -p ~/apty-kb
```

```bash
export CONFLUENCE_EMAIL=<service-account-email> CONFLUENCE_TOKEN=<classic-read-only-token>
```

```bash
pnpm kb:pack --space A4PKH --root 1509720081 --version 4.x
```

```bash
pnpm kb:pack --space JA --root 1496711169 --version 5.x
```

```bash
pnpm kb:pack --space <common-space-key> --root <root-page-id> --version common
```

The builder reads the "RAG Card:" pages under the root, each group page's
title as the card's group, and prints ids, titles and counts only: cards per
class (full, stub, routing, malformed with its reason), cards with NOT
VERIFIED statements, no "Verified on" line or no "Symptom:" line, and with
`--diff <old pack>` the cards added, changed and removed. `--customer-names
<file>` fails the build on a listed name (page ids only). `--synonyms <file>`
adds the owner's groups (one per line, comma-separated). The pack is written
to `~/apty-kb/apty-kb-<space>-<version>-<yyyymmdd>.kbpack.json`, mode 600;
the builder refuses to write inside this repository. `--version` is required
for JA and any space other than A4PKH.

**Calibrate, then rebuild** with the printed flags:

```bash
pnpm kb:eval --pack ~/apty-kb/apty-kb-A4PKH-4.x-<yyyymmdd>.kbpack.json --questions ~/apty-kb/questions-4x.json --calibrate --by-category
```

```bash
pnpm kb:pack --space A4PKH --root 1509720081 --version 4.x --coverage-min <x> --coverage-min-idf <y>
```

**Share** the files on a restricted internal page. Never attach a pack to a
GitHub issue, PR, release or CI run: this repository and its releases are
public, and `npm run audit:kb-pack` fails CI on a pack in the tree or the
build, and on a source comment that quotes a card title next to its page id
(name a card by its id and a description in your own words).

## Lifecycle: each SE

Options → Settings → General → **Knowledge base** → **Import pack…**, once
per version; the file names its version. Each loaded pack has a row
(version, space, cards and how many are not yet written, build and import
dates, retrieval, calibration) with **Replace** and **Remove** (after a
confirmation; the other versions stay). A pack older than 30 days gets a
warning, in Options and in Preflight (one row per version).

## Evaluation

```bash
pnpm kb:eval --pack <file> --questions <file> [--calibrate] [--coverage-min-floor <f>] [--coverage-min <x>] [--coverage-min-idf <y>] [--by-category] [--json]
```

A questions file is a list of `{ "id", "category"?, "q", "expectedPageIds",
"expectedLayer"?, "surface"? }`. An empty `expectedPageIds` means the KB
should not cover it; a stub counts as a hit when it is the expected card; a
`multi` question needs all its cards in the top 3; `"surface": "responder"`
(a bare how-to, a question in another script) is left to the responder's
tests. The report gives Recall@1, Recall@3, MRR, layer accuracy, "not
covered" precision and recall, covered recall and each miss by id; it never
prints question or card text. `--by-category` prints the same per category.
`--calibrate` grid-searches `coverage.min` (0.05 to 0.95) and `minIdf` (the
vocabulary idf's 10th to 90th percentiles) for the best Youden J (covered
recall + not-covered recall − 1), keeping Recall@3 within 0.02 of the
uncapped ranking, and prints the `kb:pack` flags. It never suggests a
`coverage.min` below `--coverage-min-floor` (default 0.35), and warns when
the best J sits below the floor (K21 F2).

**Gate (D-KB8), per version, on the real sets** (60 or more questions, at
least 9 not covered, every category of FIXES.md 7.2, written in the owner's
own words and kept in `~/apty-kb/`): Recall@3 ≥ 0.90, "not covered"
precision ≥ 0.90 and recall ≥ 0.80, layer accuracy ≥ 0.70. On the synthetic
set (`tooling/scripts/kb/fixtures/demo-questions-4x.json`, `-5x.json`) every
question passes.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Import refused: "too large" | Over 25 MB or 5,000 chunks | Ask the KB owner to split the tree |
| Import refused: "not JSON" / "not a KB pack" | Wrong file | Import the `.kbpack.json` file |
| Import refused: "schema version" | A pack from a newer builder | Update the Agent |
| Import refused: "malformed" | The file was edited or cut | Download it again; the owner rebuilds if it persists |
| Import refused: "checksum" | Changed or truncated in transit | Download it again |
| Everything is "not covered" | Coverage settings too strict for the pack, or the tab's version has no pack loaded | Rebuild with the calibrated flags; import the tab's version, or choose "Not sure" |
| Cards of the wrong version | The tab's version is unknown or was chosen wrongly | Pick the version on the KB matches or verdict card; a check's files decide it when one runs |
| No KB card with no AI key | The message reads as a bare how-to, or nothing covers it | Name the symptom ("…does not show", "…flickers"). The KB answers symptoms, not how-to questions (D-KB1); for how to configure something, use the Apty product documentation or ask the KB owner. |
| The model does not call `search_kb` | The message is casual, a bare how-to or a file request | Name the symptom or the Apty item; `tool-relevance.ts` lists the words |
| Links open the wrong space | A schema 1 pack (always JA) | Rebuild the pack with this builder |
| "Older than 30 days" | Stale pack | Ask the KB owner for a newer one |
| "The KB cards are in English" | The question is mostly in another script and no model is configured | Ask in English, or configure a model |

## Not done

- **Real cards and the D-KB8 gate.** The real 4.x and 5.x packs and their
  60-question sets have not been run in this repository's work (no classic
  Confluence token here). The KB owner runs the commands above and records
  the numbers (ids only) on the handbook page F15.
- **4.x check packs.** The 4.x widget and flow checks were checked against
  apty-assist `player3.0` at `bbb4cbc518a9` (player 4.30.0) (K21 F4); each
  rule's comment names the player file and line it mirrors. Their version
  line is "4.x code, apty-assist bbb4cbc (player 4.30.0); from code, not runtime-verified", and a 4.x finding is as certain as a 5.x one
  ("likely"). The code changed several rules: environments are an object
  keyed by id with one `url`, tried in text order; the regex flag is
  `regExpUrl.status`, and an invalid regex stops the whole search;
  `enablePlayer` must be truthy, with production as the fallback
  environment; `widgetConfig.display` decides the widget's audience;
  app-data.json without `config.customConfig` stops the player (W4X-06);
  segments hold `conditions`, decided in the browser, and rules attach to a
  flow (`attachedRule`), so neither is a cause from the files; a flow's steps
  file is a bare array; and without the `publishingSystem` flag the flows come
  from the Assist server, not flow.json. Each rule cites its own A4PKH card
  (`CARD_4X` in `cards-4x.ts`, K21 F3), for the KB owner to confirm. A 4.x
  port of the selector and page checks is later work.
- **The 4.x Client bridge** is described in
  [`4X-BRIDGE.md`](../integrations/apty/4X-BRIDGE.md), not yet in apty-assist.
- **K7, dense vectors.** Not shipped; decide again on the real sets.
- **Real providers.** `search_kb` was tested with a mock model in Chromium.

## Tests

| What | Where |
|---|---|
| Builder (fetch, parse, classes, symptom, versions, checksum, deny list, diff, coverage and synonym flags, CLI) | `tooling/scripts/kb/build-kb-pack.test.mjs` |
| Evaluation, calibration, categories | `tooling/scripts/kb/eval-kb.test.mjs` |
| Demo packs, the synthetic edge-case set | `tooling/scripts/kb/build-demo-pack.test.mjs` |
| Repository guard | `tooling/scripts/check-no-kb-pack.test.mjs` |
| Schema 1 and 2, checksum, limits, links | `packages/agent-core/src/kb/pack.test.ts` |
| Ranking, coverage, guard, symptom, stems, synonyms, file names, layer hints, stubs | `packages/agent-core/src/kb/search.test.ts`, `text.test.ts`, `stem.test.ts` |
| Several packs, versions, mixed results | `packages/agent-core/src/kb/index-set.test.ts` |
| Store per version and migration, index per version, tool, matches, intent, tab version | `packages/browser-runtime/src/storage/kb-store.test.ts`, `src/kb/*.test.ts`, `src/tools/kb.test.ts` |
| When `search_kb` is offered | `packages/browser-runtime/src/tools/tool-relevance.test.ts` |
| Options rows, citations, grounding | `packages/ui/src/components/settings/knowledge-base-card.test.tsx`, `src/lib/kb-citations.test.ts`, `kb-grounding.test.ts`, `message-item.test.tsx` |
| Two packs, restart, migration, Preflight rows, axe, keyboard | `tooling/e2e/knowledge-base.e2e.test.mjs` |
| `search_kb` with a mock model, citation link, "not covered" | `tooling/e2e/kb-answer.e2e.test.mjs` |
| KB matches card with no AI key, every symptom family, the English-cards notice | `tooling/e2e/kb-matches.e2e.test.mjs` |
| Card text under a cause; a 4.x tenant | `tooling/e2e/visibility-check.e2e.test.mjs`, `dapty-check.e2e.test.mjs` |
| 4.x evidence: Capture and reload, a service-worker HAR | `tooling/e2e/four-x-evidence.e2e.test.mjs` |
