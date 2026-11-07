# KB retrieval (KB-RAG)

The Agent finds the RAG Answer Card for a finding or a symptom, shows its
text in the side panel and grounds follow-up answers in it with a citation.
It runs entirely in the browser: no server, no vector database, no Confluence
call and no new permission in the extension. The owner prompt is
[`docs/tasks/kb-rag/MASTER.md`](../tasks/kb-rag/MASTER.md); the owner's
decisions are in [`decisions.md`](../tasks/kb-rag/decisions.md).

## Design

```
Confluence (JA, the "RAG Card:" pages under RAG Answer Cards)
  │  pnpm kb:pack, on the KB owner's machine (CONFLUENCE_EMAIL/TOKEN)
  ▼
apty-kb-<space>-<date>.kbpack.json   ← never in this repository
  │  shared on a restricted internal page; each SE imports it
  ▼
Options → Settings → General → Knowledge base → IndexedDB apty-kb-db
  │
  ├─ the verdict card: "From the KB card" under each cause (no model)
  ├─ the KB matches card: a symptom no check pack claims (no model)
  └─ search_kb: the model's follow-up answers, cited kb://<pageId>#L<layer>
```

| Part | Code |
|---|---|
| Pack builder | `tooling/scripts/kb/build-kb-pack.mjs` (`pnpm kb:pack`) |
| Schema, checksum, limits | `packages/agent-core/src/kb/pack.ts` (`parseKbPack`) |
| Search | `packages/agent-core/src/kb/search.ts` (`createKbIndex`) |
| Storage | `packages/browser-runtime/src/storage/kb-store.ts` (`createKbPackStore`) |
| Index cache, tool result | `packages/browser-runtime/src/kb/kb-index.ts` |
| The model's tool | `packages/browser-runtime/src/tools/kb.ts` (`search_kb`) |
| KB matches answer | `packages/browser-runtime/src/kb/kb-matches.ts`, `createDiagnosisResponder` |
| Layer a cause reads | `packages/browser-runtime/src/apty/diagnosis/card-layers.ts` (`cardLayerOf`) |
| Options card | `packages/ui/src/components/settings/knowledge-base-card.tsx` |
| Verdict card text | `apps/browser-extension/src/components/investigation/kb-card-excerpt.tsx` |
| KB matches card | `apps/browser-extension/src/components/investigation/kb-matches-card.tsx` |
| Citation links | `packages/ui/src/lib/kb-citations.ts` |
| Evaluation | `tooling/scripts/kb/eval-kb.mjs` (`pnpm kb:eval`) |
| Repository guard | `tooling/scripts/check-no-kb-pack.mjs` (`npm run audit:kb-pack`) |

### The pack

One JSON file, schema v1 (MASTER.md section 3.1), plus two optional fields
the schema needed: `retrieval.threshold` (the calibrated BM25 score below
which a question is "not covered") and `retrieval.dense.threshold` (the same
for cosine similarity, with vectors). One chunk per card layer, at most 1,000
characters; chunks are unique by `(pageId, layer)`. The `sha256` covers the
canonical JSON (keys sorted at every level, no whitespace) without itself.

### Search

MiniSearch BM25 over the card title (boost 3), the heading (1.5) and the
text, with prefix matching from 3 characters and fuzzy matching (0.2) from
5. The index leaves out what every card shares: the `Layer N:` prefix, the
card's title repeated in its headings, a layer description most cards share,
the `Verified on` and `Send support` lines and the `NOT VERIFIED` mark (the
text sent to the model keeps all of them). Ties go to the lower page id,
then the lower layer, so the same pack and query always rank the same. With
a pack's vectors and a query vector, keyword and dense rankings are fused by
reciprocal rank (k = 60); no pack has vectors yet (K7).

### Where it shows

- **Verdict card.** A cause that cites a card gets **From the KB card**: the
  layer its rule reads (`cardLayerOf`: settings causes 1, page and element
  causes 2, data and network causes 3), the card's `Verified on` line and a
  **Not verified** badge. No pack, or a pack without the card: the link only.
- **KB matches card.** A message that reports a symptom no check pack
  claims gets the pack's top 3 cards, one chunk each, with no model call and
  no AI key. A check pack's answer always wins; a bare "how do I configure X"
  with no symptom goes to the model or Ask Dapty (D-KB1).
- **Follow-up answers.** `search_kb` and its prompt section are offered with a
  check pack's symptom or a product follow-up ("how do I", "setting", "in
  Studio", "send support"). The model answers only from the returned chunks
  and cites each claim; `kb://<pageId>#L<layer>` renders as "KB card 101,
  layer 1", a link to the card.

## Lifecycle

### Build a pack (KB owner)

```bash
CONFLUENCE_EMAIL=kb-reader@example.com CONFLUENCE_TOKEN=… pnpm kb:pack --customer-names ~/apty-kb/customer-names.txt --diff ~/apty-kb/previous.kbpack.json --threshold 18.2
```

- The token is a read-only service account's **classic** API token (a
  scoped token cannot use CQL search, and the builder says so). It is read
  from the environment and never written or logged.
- The pack is written to `~/apty-kb/apty-kb-JA-<yyyymmdd>.kbpack.json`, mode
  600; the builder refuses to write inside this repository.
- It prints ids, titles and counts only: the cards it skipped (not exactly
  layers 1 to 4, or a layer over 1,000 characters), those with NOT VERIFIED
  statements or no `Verified on` line, and with `--diff` the cards added,
  changed and removed.
- `--customer-names <file>` (one name per line, `#` comments) fails the
  build on a match and names the page ids only.
- It reads the pages titled "RAG Card: …" under
  [RAG Answer Cards](https://apty.atlassian.net/wiki/spaces/JA/pages/1496711169/RAG+Answer+Cards)
  (`--root 1496711169`, the default), each group page's title ("Workflows",
  "Studio", …) as the card's group: 125 cards in 17 groups on 2026-11-07.
  `--label <label>` selects labelled pages instead. The "start here"
  routing cards have no `Layer N:` sections, so they are reported as
  skipped. When the restructure moves the tree, pass `--space` and `--root`.

### Share it

Upload the pack to a restricted internal page (Confluence or SharePoint).
Never attach it to a GitHub issue, PR, release or CI run: this repository
and its releases are public, and `npm run audit:kb-pack` fails CI on a pack
in the tree or the build.

### Import it (each SE)

Options → Settings → General → **Knowledge base** → **Import pack…**. The card
shows the space, card count, build and import dates and retrieval mode, and
warns when the pack is more than 30 days old; Preflight reports the same.
**Replace pack…** loads a newer one; **Remove** deletes it after a
confirmation.

### Evaluate and calibrate (KB owner)

```bash
pnpm kb:eval --pack ~/apty-kb/apty-kb-JA-20261110.kbpack.json --questions ~/apty-kb/questions-40.json --calibrate
```

The questions file is `[{ "id", "q", "expectedPageIds": [...], "expectedLayer"? }]`;
an empty `expectedPageIds` means the KB should not cover the question. The
report gives Recall@1, Recall@3, MRR, layer accuracy, "not covered"
precision and recall, and each miss by question id; `--calibrate` suggests
the threshold to pass to `kb:pack --threshold`. The 40-question set stays
outside this repository. A synthetic set
(`tooling/scripts/kb/fixtures/`) runs in CI.

## Not done

- **A real pack and real numbers.** No pack has been built from Confluence
  yet, and the 40-question set has not been run, so no
  threshold is calibrated and no target exists (End goal, section 9).
- **K7, dense vectors.** Not shipped: it ships only if K8 on the real set
  shows a gain the owner accepts, and it would add the quantized model
  (about 23 MB) to the extension. The fusion code is ready in
  `createKbIndex`.
- **Real providers.** `search_kb` was tested with a mock model in Chromium,
  not with a real provider.

## Tests

| What | Where |
|---|---|
| Builder (fetch, parse, checksum, deny list, diff, CLI) | `tooling/scripts/kb/build-kb-pack.test.mjs` |
| Evaluation and calibration | `tooling/scripts/kb/eval-kb.test.mjs` |
| Repository guard | `tooling/scripts/check-no-kb-pack.test.mjs` |
| Schema, checksum vector, limits | `packages/agent-core/src/kb/pack.test.ts` |
| Ranking, ties, threshold, fusion | `packages/agent-core/src/kb/search.test.ts` |
| Store, index cache, tool, matches | `packages/browser-runtime/src/storage/kb-store.test.ts`, `src/kb/*.test.ts`, `src/tools/kb.test.ts` |
| Import, restart, Preflight, axe, keyboard | `tooling/e2e/knowledge-base.e2e.test.mjs` |
| `search_kb` with a mock model, citation link | `tooling/e2e/kb-answer.e2e.test.mjs` |
| Card text under a cause, both themes | `tooling/e2e/visibility-check.e2e.test.mjs`, `dapty-check.e2e.test.mjs` |
| KB matches card with no AI key | `tooling/e2e/kb-matches.e2e.test.mjs` |
