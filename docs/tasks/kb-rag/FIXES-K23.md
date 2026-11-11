# KB-RAG K23: only signed, current KB packs are used

10 Nov 2026 · Apty Customer Success

**This is a complete, self-contained implementation prompt for a coding
agent.** Do every work package below, in order, until every acceptance check
passes. Do not stop at a plan, and do not skip a package. Where a step cannot
be done in your environment, do everything else, mark that step partial, and
say exactly what is left and the command that finishes it.

- **Base:** `main` at `239ea68` or later (K21 and K22 are merged). Create
  `claude/kb-rag-k23-pack-signing` from it, or use the branch your session is
  assigned and say so in the PR body. One commit per work package, each
  green on its own; one PR against `main`.
- **Status:** NOT STARTED. Keep the [Status](#status) section current.
- Re-read this file after any context compaction; never guess scope.

**The rule this prompt enforces:** the Agent uses a KB pack only when it can
prove who built it and that it is still current. Anyone can hand an SE a
`.kbpack.json` file today; its checksum proves the file is whole, not who
wrote it, and nothing stops a pack from being used for years.

## Read first

1. `CLAUDE.md`, `AGENTS.md`, `docs/STATUS.md`.
2. [`FIXES-K22.md`](FIXES-K22.md) and [`decisions.md`](decisions.md)
   (D-KB1 to D-KB9, D-SEC1 to D-SEC7). K22's hard rules still apply.
3. [`docs/development/kb-rag.md`](../../development/kb-rag.md) (the pack, the
   lifecycle) and [`docs/security/ORG_POLICY.md`](../../security/ORG_POLICY.md)
   (the policy keys this prompt extends).

## Why: the gap

From the code on `main` at `239ea68`:

| # | Gap | Where | Effect |
| --- | --- | --- | --- |
| G1 | A pack proves it is whole, not who built it | `parseKbPack` checks `sha256` over `canonicalJson` of the pack (`packages/agent-core/src/kb/pack.ts`); anyone can recompute it | A pack with changed card text (wrong settings, or text written to steer the model) imports like the KB owner's own |
| G2 | The demo exception trusts a name | `isDemoKbPack` (`packages/agent-core/src/config/effective-settings.ts`) is true for any pack whose `source.site` ends in `.invalid` | A pack that calls itself a demo pack sends its text to the model with no policy (D-SEC1) and lowers the redaction floor (D-SEC3) |
| G3 | A pack never stops being used | `KB_PACK_STALE_DAYS` (30) only adds a warning in Options and Preflight | Card text from a superseded product version keeps answering SEs indefinitely |
| G4 | IT cannot say whose packs to trust | No policy key for pack origin or age (`OrgPolicy`, `managed-schema.json`) | An organization cannot require packs from its own KB owner, rotate that owner's key, or cap a pack's age |

## Owner decisions to record

Record each in [decisions.md](decisions.md) (a section each) and as a row in
`DECISIONS.md`, in the first commit, marked **Proposed with K23**. The owner
confirms them before the PR merges; the PR body says which were confirmed.

| Id | Decision |
| --- | --- |
| D-SEC8 | A KB pack is used only when it is signed by a trusted key. Signing is ECDSA P-256 with SHA-256 (WebCrypto `ECDSA`, `namedCurve: "P-256"`): every Chrome the manifest allows (`minimum_chrome_version` 116) and Node verify it with no new dependency; Ed25519 would need a newer Chrome. An unsigned pack, a bad signature, or a key that is not trusted or is revoked is refused at import, and a loaded pack in that state is not used. Only an organization policy can allow unsigned packs (`allowUnsignedPacks: true`), for a transition. |
| D-SEC9 | Trusted keys: the Apty KB owner's public key(s), built into the extension, plus any `trustedPackKeys` a policy adds; a policy can revoke any key by id (`revokedPackKeyIds`), built-in ones included. The private key stays with the KB owner, never in this repository and never in CI. |
| D-SEC10 | A demo pack is a pack signed with the published demo key, and the demo key is trusted only for packs whose `source.site` ends in `.invalid`. A pack that only names a `.invalid` site is not a demo pack. This replaces the site test behind D-SEC1's exception and D-SEC3's floor. |
| D-SEC11 | Every pack carries `expiresAt`, set by the KB owner when building: by default 60 days after `builtAt`, at most 180. An expired pack is kept but not used; Options, Preflight and the panel say it expired and ask for a new one. A policy can shorten the life of every pack (`maxPackAgeDays`, counted from `builtAt`). A pack built more than one day in the future (by the device's clock) is refused. |

## Hard rules

1. **Fail closed.** A pack whose signature, key, trust or dates cannot be
   checked is not used. A check that throws counts as a failure. Never fall
   back to "use it anyway".
2. **Check at every use, not only at import.** Trust and dates change after
   import (a policy revokes a key, time passes). The index source checks
   every loaded pack each time it builds or reuses an index, and before the
   KB matches card, `search_kb`, the verdict card's excerpt and the KB egress
   decision read a pack.
3. **No private key in the repository, except the demo key.** The demo key's
   private half is committed on purpose (anyone may build demo packs) and is
   trusted only for `.invalid` sites (D-SEC10). `npm run audit:kb-pack` fails
   on any other private key file or PEM private key block in the tree.
4. **No KB content in the repository.** Tests use demo or synthetic packs
   only. `npm run audit:kb-pack` stays green.
5. **No new permission and no new runtime dependency.** WebCrypto in the
   extension, `node:crypto` in the builder. agent-core stays platform-free:
   it takes `verify` as a dependency, as `parseKbPack` takes `sha256` today.
6. **Test first.** Every behaviour change starts with a test that fails on
   the base commit. Anything crossing the Chrome boundary also gets an E2E in
   `tooling/e2e/` using `harness.mjs`; policy cases use K22's E2E policy
   build (`tooling/e2e/policy-build.mjs`). Never skip, weaken or delete a test.
7. New UI strings in both en.json and zh.json; new surfaces pass axe in light
   and dark and work by keyboard alone.
8. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies`, `npm run audit:architecture`,
   `npm run audit:tools`, `npm run audit:kb-pack`,
   `npm run audit:settings-readers`, `npm run report:request-size`, and the
   E2E files you touched. Paste the results into the PR body.

## Work packages

Order: P1, P2, P3, P4, P5, P6.

### P1. Pack schema 3: expiry and signature

Files: `packages/agent-core/src/kb/pack.ts` (+ test), new
`packages/agent-core/src/kb/pack-signature.ts` (+ test).

- Schema 3 adds two fields: `expiresAt` (ISO date-time) and `signature`:
  `{ alg: "ES256", keyId, value }`. `keyId` is the first 16 hex characters
  of the SHA-256 of the key's SPKI DER; `value` is the base64 of the raw
  (IEEE P1363, 64-byte) signature, the form WebCrypto produces and checks.
- The checksum stays as it is, with one change: it covers the pack without
  `sha256` **and** without `signature`, so signing does not change it.
  `expiresAt` is inside it.
- What is signed: the UTF-8 bytes of
  `apty-kb-pack-signature/1\n<sha256>\n<keyId>`. The prefix keeps a pack
  signature from ever being valid for anything else.
- `verifyKbPackSignature(pack, { trustedKeys, revokedKeyIds, verify })`:
  `trusted` with the key's id and name, or one of `unsigned`,
  `untrusted_key`, `revoked_key`, `bad_signature`. `verify` is injected
  (WebCrypto in the browser, `node:crypto` in tooling). A demo-key signature
  on a pack whose site does not end in `.invalid` is `untrusted_key`
  (D-SEC10).
- `kbPackValidity(info, { now, maxPackAgeDays })`: `current`, `expiring`
  (7 days or fewer left), `expired`, or `not_yet_valid`, with the date that
  applies. The earliest of `expiresAt` and `builtAt + maxPackAgeDays` wins.
- `parseKbPack` reads schema 1, 2 and 3. Schema 1 and 2 packs have no
  signature and no `expiresAt`: they parse, and the trust check calls them
  `unsigned`. Add the new import error codes to `KbPackErrorCode`:
  `unsigned`, `untrusted_key`, `revoked_key`, `bad_signature`, `expired`,
  `not_yet_valid`.
- `KbPackInfo` gains `expiresAt` (or null), `keyId` (or null) and the trust
  result, so Options and Preflight can show them without reading card text.
- Tests: a signed pack verifies; changing one character of any card, of
  `expiresAt` or of `source.site` fails (checksum or signature); a valid
  signature with a revoked or unknown key fails; the demo key on a
  non-`.invalid` site fails; schema 1 and 2 still parse and come out
  `unsigned`; each validity state at its boundary.

### P2. Signing in the builder, keys and the demo key

Files: `tooling/scripts/kb/build-kb-pack.mjs`,
`tooling/scripts/kb/build-demo-pack.mjs`, new
`tooling/scripts/kb/kb-keygen.mjs` (+ tests), `package.json`,
`tooling/scripts/check-no-kb-pack.mjs` (+ test), `.gitignore`,
`tooling/e2e/kb-fixture.mjs`.

- `pnpm kb:keygen --out <dir>` writes a P-256 key pair: the private key as
  PKCS#8 PEM with mode 600, outside the repository (refuse a path inside
  it), and the public key as base64 SPKI with its `keyId`, ready to paste
  into the trusted keys (P3).
- `pnpm kb:pack` gains `--sign-key <path>` (or `KB_PACK_SIGNING_KEY`) and
  `--expires-days <n>` (default 60, 1 to 180). It always writes schema 3 and
  refuses to write an unsigned pack unless given `--unsigned`, which prints
  that no SE's extension will use it without `allowUnsignedPacks`. It never
  prints the key.
- The demo key: generate it once, commit its private half at
  `tooling/scripts/kb/demo-signing-key.pem` with a header comment saying it
  is public on purpose and trusted only for `.invalid` sites.
  `pnpm kb:demo-pack` and the E2E fixtures (`writeFixturePack`) sign with
  it. Synthetic non-demo E2E packs (`NON_DEMO_SITE`) are signed with a test
  key generated at run time, and the E2E trusts it through the test policy
  (`trustedPackKeys`).
- `audit:kb-pack` also fails on a file holding a PEM private key block other
  than the demo key, and `.gitignore` ignores `*.pem` except that one file.
- Tests: keygen refuses a path inside the repository; a built pack verifies
  with its public key; the builder refuses to sign a pack valid for more
  than 180 days; the audit catches a planted private key and passes the
  demo key.

### P3. Trust from the extension and from the policy

Files: new `packages/agent-core/src/kb/trusted-keys.ts`,
`packages/agent-core/src/config/org-policy.ts`, `apps/browser-extension/managed-schema.json`,
`packages/agent-core/src/config/effective-settings.ts` (+ tests).

- `trusted-keys.ts` lists the built-in keys: the demo key (with its
  `.invalid` restriction) and the Apty KB owner's key. Until the KB owner
  runs `pnpm kb:keygen` and sends the public key, the owner's entry is
  empty, and the PR body says so (an SE can then load only demo packs, or
  unsigned packs under a policy that allows them).
- New policy keys, parsed as strictly as the K22 keys:

  | Key | Type | Default | Effect |
  | --- | --- | --- | --- |
  | `trustedPackKeys` | array of `{ keyId, spki, name }` | none | Keys trusted in addition to the built-in ones; `keyId` must match the `spki` |
  | `revokedPackKeyIds` | string array | none | Keys never trusted, built-in ones included |
  | `allowUnsignedPacks` | boolean | `false` | Use unsigned (schema 1 and 2, or `--unsigned`) packs, for a transition |
  | `maxPackAgeDays` | integer 1 to 365 | none | No pack is used more than this many days after `builtAt` |

  An invalid policy (K22) trusts no key, allows no unsigned pack and uses no
  pack but demo packs.
- `isDemoKbPack` takes the trust result: a demo pack is one signed with the
  demo key on a `.invalid` site (D-SEC10). Update its callers (the KB egress
  decision, the redaction floor) and their tests.
- `effectiveSettings`' "non-demo pack loaded" counts every loaded pack that
  is not a verified demo pack, used or not: an unsigned or expired pack
  still raises the redaction floor while it sits in IndexedDB.
- Tests: each key parses and refuses wrong values; a revoked built-in key is
  untrusted; a `.invalid` pack signed with a non-demo key is not a demo pack.

### P4. Import and use

Files: `packages/browser-runtime/src/storage/kb-store.ts`,
`packages/browser-runtime/src/kb/kb-index.ts`,
`packages/browser-runtime/src/kb/kb-matches.ts`,
`packages/browser-runtime/src/tools/kb.ts`,
`packages/browser-runtime/src/runtime/kb-egress.ts`,
`apps/browser-extension/src/components/investigation/kb-card-excerpt.tsx`
(+ tests, E2E).

- `replace(text)` verifies the signature against the current trust (built-in
  keys, the policy) and the dates before it stores anything, and refuses
  with the P1 codes. A refused file keeps the loaded pack.
- The index source (`createKbIndexSource`) keeps only usable packs: trusted
  (or unsigned under `allowUnsignedPacks`) and `current` or `expiring`. It
  checks at every `current()` call, and the cache key includes the trust and
  validity result, so a revoked key or a pack that expires takes effect at
  the next search with no reload.
- When the tab's version has a loaded pack that is not usable, `search_kb`
  and the KB matches card say why: new status `pack_unusable` with
  `reason: "expired" | "unsigned" | "untrusted"` and the version, never the
  pack's text. The verdict card's "From the KB card" excerpt is not shown
  from an unusable pack (the card link stays).
- The KB egress decision (K22) counts only usable packs, and its demo
  exception uses the verified demo pack (P3).
- Tests: an expired pack gives `pack_unusable` with `expired`, from both
  `search_kb` and the KB matches card; revoking the key through the policy
  stops a loaded pack at the next search; an unsigned schema 2 pack is used
  only under `allowUnsignedPacks`. E2E (`knowledge-base.e2e.test.mjs`,
  `kb-matches.e2e.test.mjs`): importing a tampered pack (one card's text
  changed after signing) is refused with its message; a pack whose
  `expiresAt` has passed (built by the test with a short life and a fixed
  clock, or with `expiresAt` in the past and signed by the test key) shows
  as expired and answers nothing.

### P5. Options, Preflight and the panel

Files: `packages/ui/src/components/settings/knowledge-base-card.tsx`,
`apps/browser-extension/src/services/preflight.ts`, the KB matches card,
i18n (+ tests, E2E, axe).

- Each loaded pack's row in Options shows who signed it ("Signed by Apty KB
  owner", the key's name, or "Not signed"), when it expires, and its state:
  current, expires in N days, expired, not signed, signed by an untrusted or
  revoked key. An unusable pack's row says it is not used and what to do
  ("Ask the KB owner for a new pack").
- Import errors name the new codes in plain words ("This pack is not signed
  by a key this extension trusts.", "This pack expired on <date>.").
- Preflight's Knowledge base row per version: fail for an unusable pack
  (with the reason), warn when it expires within 7 days (replacing the
  30-day stale warning's role; keep that warning only for packs with no
  `expiresAt`).
- The KB matches card shows `pack_unusable` as one line: "The KB pack for
  Apty <version> expired on <date>. Ask the KB owner for a new one."
- Tests and E2E: each state renders; the Options card with an expired and a
  current pack passes axe in light and dark (`a11y-options-*`).

### P6. Documentation

Files: `docs/development/kb-rag.md` (the pack, lifecycle of the KB owner and
of each SE), `docs/security/ORG_POLICY.md` (the four keys, the recommended
policy), `docs/security/SECURITY_AUDIT.md` (a new fixed entry for G1 to G4),
`docs/security/DATA_FLOW.md` and `PRIVACY.md` (which packs are used),
`docs/STATUS.md`, `CHANGELOG.md`, `DECISIONS.md`, `README.md` if it mentions
importing packs.

- The KB owner's lifecycle: generate the key once (`pnpm kb:keygen`), send
  the public key for the built-in list or IT's `trustedPackKeys`, keep the
  private key off shared drives and out of CI, build with `--sign-key`,
  rebuild before `expiresAt`, and what to do if the key leaks (IT revokes
  its id at once; the next release removes it from the built-in list).
- The SE's lifecycle: what each pack state means and what to ask for.
- Release note: packs built before K23 are unsigned and stop being used
  once this ships, unless a policy sets `allowUnsignedPacks`; the KB owner
  must rebuild and redistribute every pack, signed, before the release.

## Acceptance checks

All must hold; paste the evidence in the PR body.

1. A pack signed by a trusted key imports and answers as today (KB matches,
   `search_kb`, the verdict excerpt).
2. Changing one character of a card, of `expiresAt` or of `source.site` in a
   signed pack makes the import fail, and the loaded pack stays.
3. A pack signed by an unknown key, or by a key the policy revokes, is
   refused at import; revoking the key of a loaded pack stops it at the next
   search, with no reload.
4. An unsigned pack is refused, or (already loaded) not used, unless the
   policy sets `allowUnsignedPacks`.
5. A pack naming a `.invalid` site but not signed with the demo key gets no
   demo exception: its text is withheld with no policy (D-SEC1) and the
   redaction floor applies (D-SEC3).
6. An expired pack is not used: `search_kb` and the KB matches card return
   `pack_unusable` with `expired`, Options and Preflight say it expired.
   `maxPackAgeDays` expires a pack earlier than its `expiresAt`.
7. A pack built more than a day in the future is refused.
8. The builder writes schema 3, signed, with `expiresAt`; refuses more than
   180 days; never prints the key; `kb:keygen` refuses a path in the repo.
9. No private key is in the repository except the demo key, and
   `npm run audit:kb-pack` proves it on a planted key.
10. Every check runs at use, not only at import: the tests for 3 and 6 show
    it without re-importing.
11. All existing unit and E2E tests still pass; `npm run preflight`,
    `npm run build`, `npm run lint:dependencies`,
    `npm run audit:architecture`, `npm run audit:tools`,
    `npm run audit:kb-pack`, `npm run audit:settings-readers` and
    `npm run report:request-size` are green.
12. The docs above describe the new behaviour, and the release note says
    the KB owner must re-sign every pack.

## How to test

```bash
pnpm install --frozen-lockfile && pnpm build
pnpm --filter @apty/agent-core exec vitest run src/kb src/config
pnpm --filter @apty/browser-runtime exec vitest run src/kb src/storage src/tools src/runtime
pnpm --filter @apty/browser-extension exec vitest run src/services src/components
node --test "tooling/scripts/kb/*.test.mjs" tooling/scripts/check-no-kb-pack.test.mjs
node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/knowledge-base.e2e.test.mjs tooling/e2e/kb-matches.e2e.test.mjs tooling/e2e/kb-answer.e2e.test.mjs tooling/e2e/org-policy.e2e.test.mjs tooling/e2e/preflight.e2e.test.mjs tooling/e2e/a11y-options-light.e2e.test.mjs tooling/e2e/a11y-options-dark.e2e.test.mjs
```

By hand, with a key of your own:

1. `pnpm kb:keygen --out ~/kb-test-key` and note the printed `keyId` and
   public key.
2. `pnpm kb:demo-pack --out /tmp/demo.kbpack.json` and import it in Options:
   "Signed by the demo key", expires in 60 days.
3. Edit one card's text in a copy of the file and import it: refused,
   "This pack's signature does not match its content."
4. With the E2E policy build (`tooling/e2e/policy-build.mjs`), set a test
   policy with `trustedPackKeys` holding your key, build a synthetic
   non-demo pack signed with it (`--sign-key ~/kb-test-key/…`), import it,
   then set `revokedPackKeyIds` to its id and ask again: the KB matches card
   says the pack is not used.

## Out of scope

- A per-card "never send" flag, the case record, the send-support bundle and
  the wrong-card feedback log (K22's other deferred items).
- Distributing packs automatically (a pack URL the extension fetches);
  packs are still files the SE imports.
- Hardware-backed or cloud KMS keys for the KB owner; the builder takes a
  PEM file, and a KMS can be added behind `--sign-key` later.
- Signing anything other than KB packs (skills, the extension itself).

## Status

NOT STARTED.

| Package | Status |
| --- | --- |
| P1 Pack schema 3: expiry and signature | Not started |
| P2 Signing in the builder, keys and the demo key | Not started |
| P3 Trust from the extension and from the policy | Not started |
| P4 Import and use | Not started |
| P5 Options, Preflight and the panel | Not started |
| P6 Documentation | Not started |
