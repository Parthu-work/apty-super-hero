# KB retrieval (KB-RAG): master implementation prompt

Owner prompt for building the Apty Agent's internal knowledge-base retrieval:
the Agent finds the right RAG Answer Card for a symptom or a finding, shows its
text on the verdict card, and grounds follow-up answers in it with a citation.
It runs entirely in the browser. There is no server, no vector database and no
new shared secret in the extension.

Base: `origin/main` at `f86ebc7` (2026-11-04). Status: NOT STARTED. Re-read this
file after a context compaction; never guess scope.

## 0. Why, in one paragraph

Section 1.4 of the End goal (2026-10-29) says the chat has the knowledge and the
Agent has the evidence, and neither closes the loop. The Agent's check packs
already cite a card page id (`cardPageId`), but the SE still has to open
Confluence to read the fix, and a follow-up question ("how do I turn that off in
Studio?") goes to the model with no card text, so the model can invent Apty
settings (the 2026-10-23 RAG test produced "Widget Activation" and "Allowed
Domains", which do not exist). KB-RAG puts the card text next to the finding
and makes the model answer from cards only, citing them.

## 1. Owner decisions this prompt depends on

Record each in `DECISIONS.md` in the first PR (K0). Do not build past K0 until
D-KB1 and D-KB2 are answered; use the defaults below only if the owner says so.

| Id | Decision | Default proposed |
|---|---|---|
| D-KB1 | This supersedes non-goal 3 of the End goal ("no second RAG inside the Agent") for **card retrieval only**. The Agent still does not answer general "how do I configure X" questions with no finding or symptom; those stay with Ask Dapty. | Accept, scoped as written |
| D-KB2 | How the KB reaches the SE. The repository is **public** and release zips go to public GitHub Releases, so the KB text can never be committed, built in this repository's CI, uploaded as a CI artifact or bundled in a release zip. | A **KB pack** file built on an Apty machine, shared internally (restricted Confluence page or SharePoint), imported by each SE in Options |
| D-KB3 | Retrieval method | Keyword (BM25) first; dense vectors only if the evaluation in K7 shows they help |
| D-KB4 | Which pages are cards | Pages labelled `rag-card` in space JA (5.x cards only; move to the 5.x Product Knowledge Hub when the restructure lands) |
| D-KB5 | Who may build and distribute a pack | The KB owner (assumed Harsh Sharma) |

## 2. Hard rules

1. Read `CLAUDE.md`, `docs/STATUS.md` and this file first. One branch and one PR
   per work package, from the latest `origin/main`. Never commit to `main`.
2. **No KB content in the repository, ever.** Tests use synthetic cards only
   (invented titles, invented settings marked as fixtures). Add `*.kbpack.json`
   and `kb-pack*/` to `.gitignore`, and add `tooling/scripts/check-no-kb-pack.mjs`
   to CI: it fails if a file in the tree matches the pack schema's `"kind":
   "apty-kb-pack"` marker or the ignored names.
3. **No new permission, no new host, no new network call from the extension.**
   The pack is a local file. Keep `externally_connectable: {"ids": []}`.
4. **No Confluence credential in the extension.** Only the pack builder (a Node
   script run by a person) holds a Confluence token, read from environment
   variables, never written to disk, never logged.
5. Architecture: `agent-core` stays platform-free (no `chrome`, no DOM, no
   IndexedDB); `ui` depends on `agent-core` only; storage and the file picker
   are injected from `browser-runtime` or the extension. `npm run
   audit:architecture` must pass.
6. Deterministic: same pack and same query give the same ranked result,
   including ties (break ties by `pageId`, then layer). This is rule P8.
7. Every chunk shown or sent cites its card: `pageId`, title, layer, and the
   card's "Verified on" line. NOT VERIFIED statements carry a visible badge and
   are passed to the model marked as such (rules P1, P2).
8. The RAG chat's (Ask Dapty's) answer text is never indexed and never fed to the
   model (rule P9). Only card bodies from Confluence go in a pack.
9. Card text goes to the model through the existing request path, so the
   outbound filter, redaction mode, request budget and "what was sent" all
   apply unchanged. Do not change redaction semantics, the approval gate or any
   existing tool's behaviour.
10. Evidence over claims. Every behaviour change gets a unit test that fails on
    the old code first. Anything that crosses the Chrome boundary also gets an
    E2E test in `tooling/e2e/` using `harness.mjs`. Never skip or weaken a test.
    Label unfinished work "partial". Never claim real-tenant or real-provider
    results that were not run.
11. Every new UI string goes in both `packages/ui/src/i18n/locales/en.json` and
    `zh.json`. New surfaces pass the axe checks in light and dark themes and work
    by keyboard alone.
12. Before each PR: `npm run preflight`, `npm run build`, the E2E suites you
    touched, `npm run lint:dependencies`, `npm run audit:architecture`, `npm run
    audit:tools`. Paste the results and test counts in the PR body.

## 3. Design

### 3.1 The KB pack (schema v1)

One JSON file, `apty-kb-<space>-<yyyymmdd>.kbpack.json`:

```ts
interface KbPack {
  kind: "apty-kb-pack";
  schemaVersion: 1;
  builtAt: string;            // ISO time
  builder: string;            // tool version, e.g. "build-kb-pack 1.0.0"
  source: { site: string; space: string; label: string; cardCount: number };
  aptyVersion: "5.x";
  retrieval: { bm25: true; dense?: { model: string; dims: number } };
  cards: KbCard[];
  chunks: KbChunk[];
  vectors?: string;           // base64 Float32Array, chunk order, only with dense
  sha256: string;             // over the canonical JSON without this field
}
interface KbCard {
  pageId: string; title: string; group: string;
  verifiedOn: string | null;  // the card's "Verified on" line, verbatim
  notVerifiedCount: number;
  url: string;                // https://apty.atlassian.net/wiki/spaces/JA/pages/<pageId>
  updatedAt: string;          // Confluence version time
}
interface KbChunk {
  id: string;                 // `${pageId}#L${layer}`
  pageId: string;
  layer: 1 | 2 | 3 | 4;       // product settings; Console and Elements; pasted data; contact support
  heading: string;
  text: string;               // plain text, at most 1,000 characters
  notVerified: boolean;       // the layer contains a NOT VERIFIED statement
}
```

One chunk per card layer (cards are four layers of 600 to 750 characters, under
3,000 in total, per the KB rules), so dedup is by `(pageId, layer)`, never by
text similarity. This fixes the Ask Dapty defect where templated cards were
collapsed as near-duplicates.

### 3.2 Retrieval

- **Keyword:** MiniSearch (MIT, no dependencies) over `title` (boost 3),
  `heading` (boost 1.5) and `text`, with prefix and light fuzzy matching. Strip
  the boilerplate that appears in every card (layer headings, "Verified on",
  "Send support") before indexing it as text, so it does not flatten the scores.
- **Dense (optional, K7):** `Xenova/all-MiniLM-L6-v2` (quantized) through
  `@huggingface/transformers`, run in the builder for chunks and in the
  extension for the query, so both share one vector space and no provider key is
  needed. Flat cosine scan (about 1 ms for 800 chunks); no ANN index.
- **Fusion:** reciprocal rank fusion (`k = 60`) when dense is present.
- **Threshold:** a result below the calibrated score threshold is "not covered".
  Calibrate it in K7, store it in the pack, and never hard-code a guess.
- **Card-scoped lookup:** when a finding already names `cardPageId`, read that
  card's chunks directly. No search is involved.

### 3.3 Where it shows

All in the side panel and Options. Nothing renders on the customer's page.

| Surface | What | No AI key needed? |
|---|---|---|
| Verdict card (`check-result-card.tsx`) | "From the KB card" expander under each cause: the matching layer's text, the "Verified on" line, a NOT VERIFIED badge, and the existing `KbCardLink` | Yes |
| KB matches card | For a symptom no check pack claims: the top 3 cards (title, best layer excerpt, link) | Yes |
| Follow-up answers | The model calls `search_kb` and answers only from the returned chunks, citing `kb://<pageId>#L<n>`, which renders as a link to the card | No (the SE's own key) |
| Options → Knowledge base | Import a pack, see what is loaded, remove it | Yes |

### 3.4 Lifecycle

1. The KB owner runs `pnpm kb:pack` on their own machine, with
   `CONFLUENCE_EMAIL` and `CONFLUENCE_TOKEN` (a read-only service account's
   classic API token) in the environment.
2. The builder prints a summary (card count, changed cards by id and title,
   warnings) and writes the pack outside the repository by default
   (`~/apty-kb/`).
3. The owner uploads the pack to a restricted internal page.
4. Each SE imports it in Options → Knowledge base. The Agent shows the pack's
   date and warns when it is older than 30 days.
5. Re-run when cards change. A managed-install policy can pre-load a pack later
   (out of scope here).

## 4. Work packages

Order: K0, K1, K2, K3, K4, K5, K6, K8, then K7 (optional) and K9. Each is one PR.

### K0. Decisions and guardrails

- `DECISIONS.md`: D-KB1 to D-KB5 with the owner's answers.
- `.gitignore` entries and `tooling/scripts/check-no-kb-pack.mjs` (+ test),
  wired into `ci.yml` and `npm run ci:local`.
- `docs/STATUS.md`: an Open row for KB-RAG pointing here; `docs/tasks/README.md`
  lists `kb-rag/`.
- Acceptance: committing a synthetic file with the pack marker fails the check.

### K1. Pack builder (`tooling/scripts/kb/build-kb-pack.mjs`)

- Fetch with Basic auth (`email:token`):
  `GET https://<site>/wiki/rest/api/search?cql=space="<space>" AND label="<label>" AND type=page&limit=50&cursor=…`,
  then each body with `GET /wiki/api/v2/pages/<id>?body-format=storage`.
  Follow `_links.next`. On `429`, wait for `Retry-After` and retry up to 3 times.
  If CQL search returns 401 or 403 with a scoped token, say so and suggest a
  classic token (scoped tokens route to v2, which has no CQL).
- Convert storage HTML to plain text (no new HTML parser dependency if
  `dom-snapshot` or Node's built-ins suffice; otherwise justify one in the PR).
  Split on the four layer headings. A card with fewer or more than four layers
  is reported and skipped, never guessed.
- Extract the "Verified on" line and mark NOT VERIFIED statements.
- Write the pack with `sha256`. Never print card text to stdout or logs; print
  ids, titles and counts only.
- Optional `--customer-names <file>`: a local deny list. Any match fails the build
  and names the page id only (KB rule: hide customer names).
- `--diff <old pack>`: lists added, changed and removed cards.
- Inject `fetchImpl` and a clock; test against synthetic Confluence responses
  (pagination, 429, a malformed card, a NOT VERIFIED layer, a customer-name hit).
- Add `"kb:pack"` to the root `package.json`.

### K2. Pack schema and search core (`packages/agent-core/src/kb/`)

- `pack.ts`: types, a zod validator, `sha256` check (Web Crypto, injected), size
  limits (at most 5,000 chunks; at most 25 MB with vectors).
- `search.ts`: `createKbIndex(pack)` returning `search(query, { topK, layers })`
  and `cardChunks(pageId)`; MiniSearch setup from 3.2; deterministic ties; the
  threshold; RRF when vectors and a query vector are supplied (the embedder is
  injected, so `agent-core` stays model-free).
- Add `minisearch` to `agent-core`; run `npm run check:dist-licences`.
- Unit tests: ranking on synthetic cards, ties, layer filter, threshold → not
  covered, boilerplate stripping, `(pageId, layer)` dedup, a corrupt pack, a
  checksum mismatch.

### K3. Storage and import

- `packages/browser-runtime/src/storage/kb-pack-store.ts`: IndexedDB (extension
  origin), one active pack, `load`, `replace`, `remove`, `info`. No
  `chrome.storage.local` for the pack body (size).
- `packages/ui/src/components/settings/knowledge-base-card.tsx` (+ test), added to
  Options → Settings: Import (file picker), the loaded pack's space, card count,
  build date, retrieval mode and age warning; Remove with confirmation. Errors
  are named: wrong kind, wrong schema version, checksum mismatch, too large.
- Preflight (F12) gets a row: "Knowledge base: loaded (N cards, built <date>)",
  "not loaded" (info, not an error) or "older than 30 days" (warning).
- E2E: import a synthetic pack, reload the extension, still loaded; remove it.
  Axe in both themes for the new card.

### K4. `search_kb` tool (`packages/browser-runtime/src/tools/kb.ts`)

- `tool({ name: "search_kb", … })`, following `diagnosis.ts`. Parameters: `query`
  (string, at most 300 characters), `topK` (1 to 5, default 3), `layers`
  (optional). The model cannot pass a pack, a URL or a page id to fetch.
- Result: `{ status: "ok" | "not_covered" | "no_pack", results: [{ cite:
  "kb://<pageId>#L<n>", title, layer, heading, verifiedOn, notVerified, score,
  text }] }`, at most 1,000 characters per chunk and 4,000 in total.
- Register it in `tools/index.ts` with the result-privacy wrapper like every
  other tool.
- Add a prompt section to `SYSTEM_PROMPT_SECTIONS`
  (`packages/ui/src/components/chatbot/constants.ts`), sent only with the tool
  (the Phase B P2 pattern): answer Apty product questions only from `search_kb`
  results; cite each claim with its `kb://` id; carry NOT VERIFIED; on
  `not_covered`, say the KB does not cover it and suggest Ask Dapty or the
  card's send-support list; never invent a setting name.
- Render `kb://<pageId>#L<n>` in assistant messages as a link to the card.
- Update `tooling/e2e/request-budgets.json` and `REQUEST_ANATOMY.md`; `npm run
  report:request-size` stays within budget.
- Tests: unit (status values, caps, no pack, privacy wrapper applied); E2E with
  the mock model calling `search_kb` and the answer showing a card link.

### K5. Card text on the verdict card

- In `check-result-card.tsx`, under each cause with a `cardPageId`: a "From the
  KB card" expander with the layer the check pack names (default: layer 1 for a
  settings cause, layer 3 for a data cause), the "Verified on" line and the NOT
  VERIFIED badge. With no pack loaded, show today's link only.
- The card's "Copy case summary" (or the evidence bundle, if that is where the
  summary lives) gains the card ids and layers, never the card text.
- Tests: unit for both states; extend `visibility-check` and `dapty-check` E2E
  with a loaded synthetic pack; axe in both themes.

### K6. KB matches card when no check pack applies

- In the local-answer router (`responder.ts`, `createDiagnosisResponder`): if no
  pack claims the message and a pack is loaded, run `search_kb` locally. With
  results above the threshold, show a KB matches card (top 3) with no model call.
  Below it, do nothing new.
- Never override a check pack's answer. Never answer a bare "how do I configure
  X" with no symptom (D-KB1); leave those to the model or Ask Dapty.
- Works with no AI key (extend `send-gate.ts` the way Ask Dapty did).
- Tests: router unit tests (check pack wins; below threshold; no pack); E2E with
  no key: a symptom question shows the KB matches card and no model request is
  made.

### K7. Dense vectors (optional, ships only if K8 shows a gain)

- Builder: embed chunks with `@huggingface/transformers` and the model in 3.2;
  write `vectors` and `retrieval.dense`.
- Extension: bundle the quantized model weights under `assets/` (no download at
  runtime: rule 3), load them lazily in the side panel on first search, and
  inject the embedder into `agent-core`'s search.
- Measure and report: the zip size before and after, cold-start load time and
  per-query time in Chromium.
- Merge only if K8 shows a gain the owner accepts, on Recall@3 and on the
  "not covered" precision. Otherwise close it as "not shipped" with the numbers.

### K8. Evaluation (`tooling/scripts/kb/eval-kb.mjs`)

- Input: a pack and a questions file `[{ q, expectedPageIds, expectedLayer? }]`.
  The real 40-question set from the KB rollout kit stays outside the repository
  (it is internal) and is run by the KB owner locally; a synthetic set ships in
  the repo for CI.
- Output: Recall@1, Recall@3, MRR, "not covered" precision and recall, and the
  per-question misses (ids only). Same pack and set give the same numbers.
- Use it to calibrate the threshold stored in the pack.
- Gate for D-KB3: report BM25-only against hybrid on the same set.

### K9. Documentation and security

- `docs/development/kb-rag.md`: design, lifecycle, how to build, share and import
  a pack, and how to evaluate.
- `docs/security/SECURITY_AUDIT.md`: a new reviewed entry covering: internal KB
  text in IndexedDB on SE machines; the public-repository rules (2, 4); the pack
  as untrusted input (schema, checksum, size limits, text rendered as text,
  never as HTML); card text sent to the SE's AI provider; and the builder token's
  scope.
- `PRIVACY.md` and `docs/security/DATA_FLOW.md`: what card text goes to the
  provider and when.
- `docs/STATUS.md`: move KB-RAG to Working with its tests, or keep it Open with
  what is partial.
- The handbook page F15 (Confluence): update statuses and test counts.

## 5. Acceptance for the feature

- An SE with a pack loaded and no AI key sees the matching card text under each
  check-pack cause, and a KB matches card for a covered symptom with no check
  pack, with no model request.
- With a key, a follow-up answer cites at least one `kb://` card, and the
  answer's settings appear in the cited chunk (checked by a mock-model E2E that
  asserts the tool result reached the request).
- A question the KB does not cover gets "not covered", not an invented setting.
- No card text exists anywhere in the repository, CI logs, CI artifacts or
  release zips (`check-no-kb-pack` green; release dry run inspected).
- Preflight, build, all touched E2E suites, the dependency, licence,
  architecture and tool audits are green; the request budget holds.
- On the real 40-question set, run locally by the KB owner: the numbers are
  reported in the PR and on F15. No target is invented before that baseline
  (End goal, section 9).

## 6. Out of scope

- Any Confluence call from the extension, or an SE's own Atlassian token in it.
- Indexing Ask Dapty answers, support tickets, the older "KB:" and "4.X" pages,
  or 4.x cards.
- A hosted vector database or managed RAG service (Cloudflare AI Search, OpenAI
  vector stores, Upstash and the rest were compared on 2026-11-06; see the
  handbook page F15). Revisit only if the KB outgrows a local pack.
- Changing Ask Dapty or the apty-dap RAG.
- Pre-loading packs through managed policy (later).
