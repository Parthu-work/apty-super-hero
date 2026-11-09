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

**Amended 2026-11-07 by the owner.** The cards carry no `rag-card` label;
they are the pages titled "RAG Card: …" under
[RAG Answer Cards](https://apty.atlassian.net/wiki/spaces/JA/pages/1496711169/RAG+Answer+Cards)
(page `1496711169`), grouped under pages titled "RAG Cards: …" (125 cards in
17 groups on 2026-11-07). The builder reads that tree by default (`--root`,
the group page's title as the card's group); `--label` still selects
labelled pages instead. When the restructure moves the tree, pass its new
space and root page.

## D-KB5: the KB owner builds and distributes packs

Accepted: the KB owner, assumed to be Harsh Sharma.

## D-KB6: 4.x cards are in scope

Accepted by the owner on 2026-11-09 with [`FIXES.md`](FIXES.md). Amends
D-KB4 and MASTER.md section 6. Packs carry their Apty version, and an SE
loads one pack per version:

- **4.x:** the Apty 4.x Product Knowledge Hub, space `A4PKH`, root page
  `1509720081` (`kb:pack --version 4.x`, the default for `A4PKH`);
- **5.x:** the cards under JA root `1496711169` until the restructure moves
  them to the 5.x hub, then that root (`--version 5.x`);
- **common:** Apty KB - Common, for cards the same in both versions
  (`--version common`); a common pack is searched with either version.

## D-KB7: the Agent diagnoses 4.x tenants

Accepted 2026-11-09. Amends MASTER.md section 6 for the check packs. The
Agent runs 4.x check packs, starting with "widget not showing" and "content
not showing", ported from 4.x code (apty-assist `player3.0`) with file and
line citations in code comments. Each finding says it comes from 4.x code
and is not runtime-verified until tested on a tenant. `element-not-found`
and `page-readiness` keep the version gate for 4.x until a later port.

## D-KB8: retrieval quality gate per version

Accepted 2026-11-09. On the real question sets, per version (60 or more
questions each, at least 9 the KB should not cover): **Recall@3 ≥ 0.90,
"not covered" precision ≥ 0.90, "not covered" recall ≥ 0.80, layer
accuracy ≥ 0.70.** On the synthetic CI set every question passes. The real
sets and packs stay outside this repository; the KB owner runs them.

## D-KB9: how the Agent gets a 4.x tenant's calls

Accepted 2026-11-09. Page network capture (Injected mode) and the guided
service-worker HAR (Extension mode) ship in this repository. The 4.x Client
bridge is a separate change to `aptyInc/apty-assist`; without access to that
repository it is described, ready to apply, in
[`docs/integrations/apty/4X-BRIDGE.md`](../../integrations/apty/4X-BRIDGE.md),
with no apty-assist code copied here.
