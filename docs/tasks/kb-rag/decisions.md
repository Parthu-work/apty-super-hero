# KB-RAG owner decisions

The five decisions [`MASTER.md`](MASTER.md) section 1 asks for, answered by
the owner on 2026-11-06 before K0. All five take the proposed default.
[`DECISIONS.md`](../../../DECISIONS.md) lists them, one row each.

## D-KB1: card retrieval supersedes "no RAG" for findings and symptoms only

Accepted, scoped as written. The Agent may retrieve RAG Answer Cards from a
local KB pack to show the card for a finding or a symptom and to ground
follow-up answers in it, with a citation. This amends two earlier positions,
for card retrieval only:

- non-goal 3 of the End goal (2026-10-29), "no second RAG inside the Agent";
- [No RAG layer, ever, in this repo](../../archive/DECISIONS.md#no-rag-layer-ever-in-this-repo).

Everything else in them stands: the Agent does not answer a general "how do I
configure X" question with no finding or symptom; those stay with Ask Dapty.
No hosted vector database, document ingestion from the extension, or index of
Ask Dapty answers is added (MASTER.md sections 2 and 6).

## D-KB2: the KB reaches SEs as a local pack they import

Accepted. The repository is public and release zips go to public GitHub
Releases, so KB text is never committed, built in this repository's CI,
uploaded as a CI artifact or bundled in a release zip. The KB owner builds a
KB pack file on an Apty machine, shares it internally (a restricted
Confluence page or SharePoint), and each SE imports it in Options.

Enforced from K0: `.gitignore` ignores `*.kbpack.json` and `kb-pack*/`, and
`npm run audit:kb-pack` (`tooling/scripts/check-no-kb-pack.mjs`) fails CI,
the release workflow and the release dry run on those names or on a file
carrying the pack's kind marker, dist included.

## D-KB3: keyword retrieval first

Accepted. BM25 (MiniSearch) first; dense vectors (K7) ship only if the K8
evaluation shows a gain the owner accepts.

## D-KB4: cards are pages labelled `rag-card` in space JA

Accepted. 5.x cards only; the source moves to the 5.x Product Knowledge Hub
when the restructure lands.

## D-KB5: the KB owner builds and distributes packs

Accepted: the KB owner, assumed to be Harsh Sharma.
