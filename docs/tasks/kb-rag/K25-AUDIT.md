# KB-RAG K25 audit (redone)

18 Nov 2026 · base commit `3a3930e` (`claude/kb-rag-k27-ui`, which holds `main` at `d9860bd` plus K27 Parts F and U)

K25 ([`FIXES-K25.md`](FIXES-K25.md)) is merged. A first audit of it was
written as commit `ebdd69e` (branch `claude/kb-rag-k25-audit-fixes`,
`k25-audit-fixes.patch`), but that commit never reached GitHub: it is not in
this repository's objects, refs, reflog or pull requests. Its findings and
fixes are lost, so this audit starts again from the code on `main`.

Method: each acceptance item of FIXES-K25.md (packages A1 to L4 and the
numbered checks), the K23 checks A7 brings in ([`FIXES-K23.md`](FIXES-K23.md)),
and decisions D-SEC8 to D-SEC11 ([`decisions.md`](decisions.md)) were checked
against the implementing code and its tests. Targeted tests run for this
audit, all green: agent-core `pack-signature`, `destination`,
`provider-schema`, `search` (144 tests); browser-runtime `kb-trust`,
`kb-matches` (27 tests); `node --test` on `self-check`, `build-demo-pack` and
`check-no-kb-pack` (40 tests); `npm run audit:kb-pack` ("no KB pack in the
tree"). The full suite, builds and E2E were not run.

Status words: **met** (code and a test prove it), **partial** (code is there,
a test or a piece is missing), **gap** (not done), **needs owner** (a person
or real data must act; not code).

## Work packages

| Item | Requires | Status | Evidence |
| --- | --- | --- | --- |
| A1 rewrite | Pure per-provider schema rewrite in agent-core; Anthropic limits moved into descriptions; Anthropic docs cited | met | `packages/agent-core/src/tools/provider-schema.ts:35` (cited URL), `:177` `rewriteToolSchema`; test "removes bounded integers and states the range in the description" |
| A1 middleware | Anthropic and Groq middleware; a tool that cannot be strict is sent without `strict` and logged | met | `apps/browser-extension/src/services/ai-provider.ts:217` `providerSchemaMiddleware`, used at `:424`, `:460`; test "Anthropic: bounded tools keep strict and say their limits in words" (`tool-schemas.test.ts:262`) |
| A1 validation | `topK: 9` rejected on every provider path | met | `provider-tool-validation.test.ts:317` "%s: search_kb with topK 9 is rejected by the tool's own schema" |
| A1 conformance | Real request per provider obeys its rules; a new keyword fails a test | met | `tool-schemas.test.ts:248` "every tool is sent and obeys the provider's schema rules", `:291` "every keyword a registered tool uses is known to the rewrite" |
| A1 E2E | Fake Anthropic that 400s on a keyword still answers | met | `tooling/e2e/provider-schemas.e2e.test.mjs:193` |
| A2 outcome | `localKbMatches` returns a typed outcome; errors logged with stack | met | `packages/browser-runtime/src/kb/kb-matches.ts:52` (`KbOutcome`), `:93` `console.error`; describe "every KB outcome is typed (KB-RAG K25, A2)" (`kb-matches.test.ts:113`) |
| A2 record | Per-turn decision record: route, version and source, packs (sha256 prefix), outcome; no text | met | `packages/agent-core/src/kb/decision.ts:62` `TurnDecision`; test "the decision holds ids, numbers and codes: never a chunk's words or the question" |
| A2 lines | Quiet line above a model reply; same outcomes with no key; "Why this answer" | met | `packages/ui/src/lib/turn-decision.ts:35` `kbOutcomeLine`, `apps/browser-extension/src/components/app-root.tsx:196`, `message-item.tsx:207`; E2E `kb-decision.e2e.test.mjs:57`, `:71`, `:91` |
| A3 self-check | `kb:eval --self-check`, no questions file, ids and numbers only, exit 1 on failure | met | `tooling/scripts/kb/eval-kb.mjs:252` `selfCheck`; `self-check.test.mjs:149` "the CLI needs no questions file…" |
| A3 builder | Builder runs the self-check and prints totals; never refuses the pack for it | met | `build-kb-pack.mjs:916`, printed at `:990`; `build-kb-pack.test.mjs:628` asserts the totals |
| A3 large pack | 110 cards, 17 groups, 10 stubs, 6 routing, 5 absent; 100% top 3, ≥ 95% rank 1 | met | `fixtures/large-synthetic-cards.mjs`; `self-check.test.mjs:48`, `:68` |
| A3 unknown version | Tab-agnostic card labelled with both versions | met | `self-check.test.mjs:205` |
| A6 reasons | `no_match`, `low_coverage`, `no_strong_term`, `unknown_setting`, each tested; Workday example | met | `packages/agent-core/src/kb/search.ts:60`, `:1077`; `search.test.ts:1200`-`:1229`; `build-demo-pack.test.mjs:275` |
| A6 tool text | `search_kb` describes each reason | met | `packages/browser-runtime/src/tools/kb.ts:22` |
| A5 builder | `other_format` with first five headings; stderr progress, `--quiet`; 30 s timeout with retry and an access hint | met | `build-kb-pack.mjs:297`, `:545`, `:57`; tests `:855`, `:883`, `:950`, `:988`; troubleshooting row `docs/development/kb-rag.md:606` |
| A7 | K23 P1 to P6 in full (K23 checks below) | met | see the K23 table |
| A7 record | Decision record gains key id and expiry; `pack_unusable` outcome and line | met | `decision.ts:15` (`keyId`, `expiresAt`), `:36`; `kb-trust.test.ts:165` |
| A4 builder | "No N.x equivalent" page becomes `absent` with `absentReason` ≤ 300 | met | `build-kb-pack.test.mjs:1184`, `:1200` |
| A4 schema | Schema 3 `absent`; integrity refuses chunks on it | met | `packages/agent-core/src/kb/pack.ts:34`, `:175`; `pack.test.ts:311` |
| A4 search and UI | `not_in_version` with one hit; panel line; Options "N not in this version" | met | `search.ts:1088`, `search.test.ts:1272`; `knowledge-base-card.test.tsx:347`; E2E `kb-absent.e2e.test.mjs:52` |
| A4 eval | `kb:eval` counts an absent card as a hit when expected | met (G1 fixed) | Code at `eval-kb.mjs:139`; no `evaluate` test with an absent card (only the stub case, `eval-kb.test.mjs:181`). Gap G1 |
| L1 case | Id format, start rule, record fields, symptom ≤ 300, note ≤ 1,000 | met | `packages/agent-core/src/case/case.ts:104`; `case.test.ts:30`, `:38`, `:67`, `:132`, `:142`. K27 later made it one open case per host, not per conversation (`case-recorder.test.ts:263`) |
| L1 storage | `apty-cases-db`, retention by `caseRetentionDays` (1 to 365, default 90), pruned at start-up and each write | met | `packages/browser-runtime/src/storage/case-store.ts:156`; `entrypoints/sidepanel/index.tsx:18`; `case-store.test.ts:33`, `case.test.ts:189` |
| L1 continuity and view | Survives reload; "Continue CASE-…" once; list, open, delete | met | `case-recorder.test.ts:191`; E2E `cases.e2e.test.mjs:48`, `:65`, `:100` |
| L2 bundle | Fields or `{missing, hint}`; ≤ 4 KB per file, ≤ 200 KB; Strict redaction and deny list; `customer-app`, `:id`; no card text | met | `packages/browser-runtime/src/case/support-bundle.ts:20`, `:111`; `support-bundle.test.ts:118`, `:154`, `:166`, `:198`, `:206` |
| L2 review | Through `BundleReviewDialog`; no request | met | `support-bundle-button.tsx:138`; E2E `support-bundle.e2e.test.mjs:43` |
| L3 outcomes and feedback | Close with outcome; Wrong card on hits and excerpts; CSV and kb:eval exports | met | `feedback-store.test.ts:36`, `:67`, `:83`, `:109`; `WrongCardButton` in `kb-matches-card.tsx:252` and `kb-card-excerpt.tsx:118`; E2E `feedback.e2e.test.mjs:54`, `:85` |
| L3 clear lock | Feedback log cannot be cleared while a policy is set (D-CASE1) | met (G2 fixed) | `apps/browser-extension/src/components/cases/feedback-card.tsx:48`, `:110` (fails closed); no test. Gap G2 |
| L4 docs | ORG_POLICY, DECISIONS, CHANGELOG release note, STATUS | met | `docs/security/ORG_POLICY.md:41`-`:45`; `DECISIONS.md:77`-`:82`; `CHANGELOG.md:41` |

## K25 acceptance checks

| # | Requires | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Anthropic works | met | A1 rows |
| 2 | No silent KB outcome | met | A2 rows |
| 3 | Self-retrieval on the large synthetic pack | met | `self-check.test.mjs:68` (run green) |
| 4 | Real-pack self-check totals | needs owner | KB owner runs `pnpm -s kb:eval --self-check --pack <pack>` on the 4.x and 5.x packs |
| 5 | Reasons tested; Workday example | met | A6 rows |
| 6 | Builder `other_format`, progress, timeout | met | A5 row |
| 7 | "Not in this version" end to end | met | A4 rows (eval test: G1) |
| 8 | No regressions against the 5b3c096 counts | needs owner | Not run here (no full suite). CI on `main` is the proof |
| 9 | Hard rule 8 checks green | needs owner | Not run here; CI on `main` |
| 10 | No card text | met | `npm run audit:kb-pack` green; fixtures are marked FIXTURE |
| 11 | Docs, STATUS, CHANGELOG, status | met | L4 row; `FIXES-K25.md` Status |

## K23 acceptance checks (A7)

| # | Requires | Status | Evidence |
| --- | --- | --- | --- |
| K23-1 | Trusted pack imports and answers | met | `kb-trust.test.ts:66`; E2E `kb-signing.e2e.test.mjs:77` |
| K23-2 | One changed character (card, `expiresAt`, `source.site`) fails; loaded pack stays | met | `pack-signature.test.ts:129`; `kb-trust.test.ts:112`; `kb-store.test.ts:139`; E2E `kb-signing.e2e.test.mjs:92` |
| K23-3 | Unknown or revoked key refused; revoking a loaded pack's key stops it at the next search | met | `pack-signature.test.ts:161`; `kb-trust.test.ts:102`, `:145`; E2E `kb-signing.e2e.test.mjs:163` |
| K23-4 | Unsigned refused or unused unless `allowUnsignedPacks` | met | `kb-trust.test.ts:130`; E2E `kb-signing.e2e.test.mjs:106` |
| K23-5 | `.invalid` site without the demo key gets no demo exception, floor applies | met | `effective-settings.ts:63` `isDemoKbPack`; `destination.test.ts:181`; agent-core `effective-settings.test.ts:218`; `kb-trust.test.ts:209` |
| K23-6 | Expired: `pack_unusable`/`expired` in `search_kb`, KB matches, Options, Preflight; `maxPackAgeDays` earlier | met | `kb-trust.test.ts:165`, `:191`; `preflight.ts:654`; `knowledge-base-card.tsx:136`; E2E `kb-signing.e2e.test.mjs:118` |
| K23-7 | Built > 1 day in the future refused | met | `pack-signature.ts:173`; `pack-signature.test.ts:273`; `kb-trust.test.ts:82` (`not_yet_valid`) |
| K23-8 | Builder: schema 3, signed, `expiresAt`, ≤ 180 days, no key printed; keygen refuses repo path | met | `build-kb-pack.test.mjs:1044`, `:1092`, `:1109`, `:1140`, `:1154` |
| K23-9 | No private key but the demo key; audit catches a planted one | met | `tooling/scripts/check-no-kb-pack.mjs:48`; `check-no-kb-pack.test.mjs:257`, `:268`; `.gitignore:18`-`:19` |
| K23-10 | Checks at use, not only import | met | `packages/browser-runtime/src/kb/kb-index.ts:47`-`:62` (usable filter; cache key holds trust and validity); `kb-trust.test.ts:145`, `:165` without re-import |
| K23-11 | Existing tests and audits green | needs owner | Not run here; CI |
| K23-12 | Docs and the re-sign release note | met | `CHANGELOG.md:41`; `docs/development/kb-rag.md:76`-`:77` |

## Decisions

| Id | Requires | Status | Evidence |
| --- | --- | --- | --- |
| D-SEC8 | Used only when a trusted key signed it (ES256 over `apty-kb-pack-signature/1\n<sha256>\n<keyId>`); refused at import and unused when loaded; only `allowUnsignedPacks` admits unsigned | met in code; needs owner | `pack-signature.ts:93` `verifyKbPackSignature` (throws count as `bad_signature`, `:139`), `:211` `kbPackUsability`; `kb-store.ts:249`-`:262`; `kb-trust.ts:61`; tests above. Decision still reads "Proposed with K23" (`decisions.md:143`, `DECISIONS.md:77`) |
| D-SEC9 | Built-in keys plus `trustedPackKeys`; `revokedPackKeyIds` revokes any, built-in included; private key never in repo or CI | met in code; needs owner | `trusted-keys.ts:42` `kbTrustPolicyOf`; `org-policy.ts:301`-`:345`; `pack-signature.test.ts:174`, `:338`; `org-policy.test.ts:170`. `KB_OWNER_PACK_KEYS` is empty (`trusted-keys.ts`): only demo or policy-trusted packs work until the KB owner sends a key. Still "Proposed" |
| D-SEC10 | Demo pack = demo key signature on a `.invalid` site; a `.invalid` site alone is not enough | met in code; needs owner | `pack-signature.ts:77`, `:118`; `effective-settings.ts:63`; `destination.ts:141`; `pack-signature.test.ts:185`; `destination.test.ts:181`. A policy entry that repeats the demo key's id cannot widen it: the built-in demo entry is matched first. Still "Proposed" |
| D-SEC11 | `expiresAt` default 60, max 180 at build; expired kept but unused and shown; `maxPackAgeDays`; future build refused | met in code; needs owner | `build-kb-pack.mjs:342`; `pack-signature.ts:167`; tests above. The 180-day cap is enforced only by the builder: the extension accepts any `expiresAt` a trusted key signed (`pack.ts:57`). Owner question O3. Still "Proposed" |

## Gaps

### Code (tests only; behaviour is already right)

Both fixed in K27 R1, in the same commit as this audit.

- **G1 (fixed). No test that `kb:eval` counts an absent card as a hit (A4).**
  Now: `eval-kb.test.mjs` "counts a not-in-this-version card as a hit when
  it is the expected card (K25 audit, G1)".
  Fix: in `tooling/scripts/kb/eval-kb.test.mjs`, next to "counts a stub as a
  hit when it is the expected card" (`:181`), add "counts a not-in-this-version
  card as a hit when it is the expected card": build a schema 3 synthetic pack
  with one `absent` card, ask a question only it covers with
  `expectedPageIds: [<its id>]`, and assert Recall@1 is 1 and no miss is
  listed. Fails if the `not_in_version` branch at `eval-kb.mjs:139` is dropped.
- **G2 (fixed). No test that the feedback log's Clear is locked under a
  policy (L3, D-CASE1).** Now: `feedback-card.test.tsx` "FeedbackCard's
  Clear": locked under a policy, locked when the policy is invalid, open
  with none. The optional store-level check below is not made. Fix: new
  `apps/browser-extension/src/components/cases/feedback-card.test.tsx` mocking
  `@apty/browser-runtime/runtime/org-policy` as `cases-card.test.tsx` does:
  with `{ kind: "active" }` and with a rejected read, Clear is disabled and
  the locked note shows; with `{ kind: "none" }` and rows, Clear is enabled
  and calls `clearFeedback`. Optional hardening: the same check inside
  `caseStore().clearFeedback()`, so no other caller can bypass the UI.

### Owner decisions (not code)

- **O1.** D-SEC8 to D-SEC11 are still "Proposed with K23" although K25 is
  merged; K23 asked the owner to confirm them before merge. The owner
  confirms (or changes) each, and `decisions.md` and `DECISIONS.md` are
  updated.
- **O2.** `KB_OWNER_PACK_KEYS` is empty. The KB owner runs `pnpm kb:keygen`
  and sends the public key (built in) or IT adds it as `trustedPackKeys`.
- **O3.** Should the extension also refuse a pack whose `expiresAt` is more
  than 180 days after `builtAt` (D-SEC11's build cap), in case a pack is
  built with other tooling? If yes: in `kbPackValidity`
  (`packages/agent-core/src/kb/pack-signature.ts:167`) add
  `builtAt + 180 days` to the end dates; test in `pack-signature.test.ts`
  that a pack with `expiresAt` one year out expires at day 180.
- **O4.** Real-pack self-check totals (acceptance 4) and the smoke-test rows
  18 to 25 by hand (`docs/release/SMOKE_TEST.md`).

## allowDemoPacks (proposal, not implemented)

**This rule is NOT implemented.** It is reconstructed from a mention in
[`FIXES-K26.md`](FIXES-K26.md) (lines 574 and 642: "`allowDemoPacks: true`
(the K25 audit rule)"), whose source, commit `ebdd69e`, is lost. Nothing
below exists in the code until the owner confirms it.

**What a demo pack is today.** A pack signed with the published demo key
(`DEMO_PACK_KEY`, `demoOnly: true`, `packages/agent-core/src/kb/trusted-keys.ts`)
whose `source.site` ends in `.invalid` (`isInvalidSite`,
`pack-signature.ts:77`). The E2E fixtures use `DEMO_SITE =
"fixture.atlassian.invalid"` (`tooling/e2e/kb-fixture.mjs:62`) and sign with
the demo key. `isDemoKbPack` (`packages/agent-core/src/config/effective-settings.ts:63`)
recognises one from its verified trust result. The demo key is trusted for
every policy state, including an invalid policy (`trusted-keys.ts:48`).

**What exemption it gets.**
1. Card text may reach a model with no policy: `kbEgressAllowed` returns
   `{ allowed: true, reason: "demo" }` when every used pack is a demo pack,
   before the policy is even looked at (`destination.ts:141`, D-SEC1's
   exception).
2. It does not raise the Standard redaction floor (`nonDemoPackLoaded`,
   `packages/browser-runtime/src/runtime/effective-settings.ts:111`, D-SEC3).

**Proposal.** A new organization policy key:

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `allowDemoPacks` | boolean | `true` | When `false`, the demo key is not trusted: a demo pack is refused at import and by policy delivery, a loaded one is not used, and it gets neither exemption |

- **Where it is read.** Parsed in `parseOrgPolicy`
  (`packages/agent-core/src/config/org-policy.ts`) as a boolean, next to
  `allowUnsignedPacks` (`:346`), and added to `OrgPolicy`, to
  `apps/browser-extension/managed-schema.json` and to
  `docs/security/ORG_POLICY.md`. Applied in one place: `kbTrustPolicyOf`
  (`trusted-keys.ts:42`) drops keys with `demoOnly` from `trustedKeys` when
  the active policy sets `allowDemoPacks: false`. Everything else follows from
  trust: `verifyKbPackSignature` returns `untrusted_key`, so `replace`
  (`kb-store.ts:249`, also used by K26 delivery, `kb-pack-sync.ts:215`)
  refuses it; `createKbIndexSource` skips it at the next search; and
  `isDemoKbPack` is false, so the egress exemption ends and the redaction
  floor rises while the pack sits in IndexedDB.
- **With no policy**, behaviour is unchanged (default `true`). **With an
  invalid policy**, owner to decide: keep today's "demo packs only" (the
  key cannot be read), or treat invalid as `false` (strictest).
- **Wording.** Options, Preflight and the panel would say "untrusted" as
  today; an owner may prefer a specific line ("Demo packs are turned off by
  your organization."), which needs en and zh strings.

**Tests that would prove it.**
- `org-policy.test.ts`: `allowDemoPacks` parses `true`/`false`, and a
  non-boolean makes the policy invalid.
- `pack-signature.test.ts` (the `kbTrustPolicyOf` block, `:338`): with
  `allowDemoPacks: false` the demo key is absent from `trustedKeys`; with it
  unset or `true` it is present.
- `destination.test.ts`: a demo pack under `allowDemoPacks: false` is not
  used, so `kbEgressAllowed` gives `no-pack`, never `demo`.
- `kb-trust.test.ts`: importing a demo-signed `.invalid` pack under the
  policy is refused with `untrusted_key` and the loaded pack stays; a loaded
  demo pack stops answering at the next search after the policy changes, with
  no reload.
- `browser-runtime/src/runtime/effective-settings.test.ts`: a loaded demo
  pack under the policy raises the floor to Standard.
- E2E `tooling/e2e/org-policy.e2e.test.mjs` with `policy-build.mjs`:
  importing the demo pack under `allowDemoPacks: false` shows the refusal.

**Note on K26's manual step.** `FIXES-K26.md:574` sets `allowDemoPacks: true`
in a test policy. Today the policy parser is strict (`org-policy.ts:427`,
`"<key>" is not a policy key`), so that policy is **invalid** and
`kbPackSources` is ignored (`kbPackSources` needs an active policy). Until the
owner confirms this proposal, that step must leave the key out.
