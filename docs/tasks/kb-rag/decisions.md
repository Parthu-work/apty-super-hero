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

## D-SEC1: KB text never reaches a model by default

Accepted 2026-11-10 with [`FIXES-K22.md`](FIXES-K22.md). Card excerpts are
shown in the panel only. KB text goes to a model only when a managed policy
sets `kbToModel` to `"approved"` and the request goes to a destination that
policy allows. The one exception is a demo pack (its `source.site` ends in
`.invalid`), so developers can still test the full path.

## D-SEC2: admin policy beats user settings

Accepted 2026-11-10. A value set in `chrome.storage.managed` cannot be
changed in Options; the field shows "Set by your organization". With no
policy, the extension behaves as before except for D-SEC1 and D-SEC3.

## D-SEC3: no redaction Off while an Apty KB pack is loaded

Accepted 2026-11-10. While any non-demo pack is in IndexedDB, the effective
redaction mode is never weaker than Standard, with no policy needed. A
policy can raise the floor to Strict.

## D-SEC4: an approved destination is a provider, origin and model allow-list

Accepted 2026-11-10. A policy names the allowed provider keys, the allowed
base URL origins (https only, or loopback for a local model), and optionally
the allowed model ids. A request outside the lists is not sent, and the
panel says why. This covers custom models, the summary model and the
connection test too.

## D-SEC5: the MCP bridge gets no KB text unless the policy allows it

Accepted 2026-11-10. Without `kbToMcp: true`, KB tool results reach the
bridge as "KB result withheld by policy" plus card ids.

## D-SEC6: a local record of every request that carried KB text

Accepted 2026-11-10. Time, provider, origin, model, and the card ids and
layers sent (never text), kept for the policy's retention (default 30 days)
and exportable.

## D-SEC7: an organization gateway is the preferred destination

Accepted 2026-11-10. The extension supports it as an OpenAI-compatible
origin set by policy. A key pushed by policy is visible to the user in
chrome://policy, so a gateway that authenticates without a long-lived shared
key is preferred; building the gateway is outside this repository.

## D-SEC8: a KB pack is used only when a trusted key signed it

Proposed with K23 (implemented in K25, A7). A KB pack is used only when it is
signed by a trusted key. Signing is ECDSA P-256 with SHA-256 (WebCrypto
`ECDSA`, `namedCurve: "P-256"`): every Chrome the manifest allows
(`minimum_chrome_version` 116) and Node verify it with no new dependency;
Ed25519 would need a newer Chrome. The signature covers
`apty-kb-pack-signature/1\n<sha256>\n<keyId>`, and the checksum covers the
pack without itself and without the signature. An unsigned pack, a bad
signature, or a key that is not trusted or is revoked is refused at import,
and a loaded pack in that state is not used. Only an organization policy can
allow unsigned packs (`allowUnsignedPacks: true`), for a transition.

## D-SEC9: trusted keys are built in or set by policy, and a policy can revoke any

Proposed with K23 (implemented in K25, A7). Trusted keys: the Apty KB owner's
public key(s), built into the extension (`KB_OWNER_PACK_KEYS` in
`packages/agent-core/src/kb/trusted-keys.ts`, empty until the KB owner sends
one), plus any `trustedPackKeys` a policy adds; a policy can revoke any key by
id (`revokedPackKeyIds`), built-in ones included. The private key stays with
the KB owner, never in this repository and never in CI.

## D-SEC10: a demo pack is one signed with the demo key on a .invalid site

Proposed with K23 (implemented in K25, A7). The demo key's private half is
published on purpose (`tooling/scripts/kb/demo-signing-key.pem`) so anyone can
build demo packs, and the extension trusts it only for packs whose
`source.site` ends in `.invalid`. A pack that only names a `.invalid` site is
not a demo pack. This replaces the site test behind D-SEC1's exception and
D-SEC3's floor.

## D-SEC11: every pack expires

Proposed with K23 (implemented in K25, A7). Every pack carries `expiresAt`,
set by the KB owner when building: by default 60 days after `builtAt`, at
most 180. An expired pack is kept but not used; Options, Preflight and the
panel say it expired and ask for a new one. A policy can shorten the life of
every pack (`maxPackAgeDays`, counted from `builtAt`). A pack built more than
one day in the future (by the device's clock) is refused.

## D-CASE1: cases, bundles and feedback stay on the device

Accepted with K25 (L1 to L3). A case record, a support bundle and the
feedback log are kept only in the extension's IndexedDB (`apty-cases-db`)
and are never sent anywhere by the extension: no email, upload, ticket or
post. A case is kept for `caseRetentionDays` (organization policy, default
90, 1 to 365) after its last update and deleted on start-up and on each
write; the SE can delete one or all in Options. Something leaves the browser
only when the SE copies or downloads it after reviewing it in the review
dialog. The feedback log cannot be cleared while a policy is set, like the
K22 send record.

## D-CASE2: what a support bundle may and may not contain

Accepted with K25 (L2). A support bundle may contain: the case id and times,
the fields each rule declares (`support-fields.ts`) with their values or a
"missing" mark and hint, the finding (rule, cause key, confidence,
verification), KB card ids and links, the checks run, the file entries the
finding names (each at most 4 KB) and their status codes, Apty console
errors (at most 50 lines), and the browser and extension versions; at most
200 KB. It may not contain KB card text, screenshots, customer names (a
host that is not an Apty or Atlassian domain becomes `customer-app`), user
ids, emails or tokens, page queries or fragments, or ids in a path (`:id`).
Every value goes through the content deny list and Strict redaction before
the SE sees it.
