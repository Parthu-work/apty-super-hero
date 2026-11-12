# KB-RAG K25: every fix the first real packs asked for, signed packs, and cases

12 Nov 2026 · Apty Customer Success

**This is a complete, self-contained implementation prompt for a coding
agent.** Do every work package below, in order, until every acceptance check
passes. Do not stop at a plan, and do not skip a package. Where a step cannot
be done in your environment (for example, no real pack), do everything else,
mark that step partial, and say exactly what is left and the command that
finishes it.

- **Base:** `origin/main` at `5b3c096` (2026-11-11) or later. It holds K10 to
  K24 except K23's code; [`FIXES-K23.md`](FIXES-K23.md) (the K23 prompt) is
  on `main`.
- **Branch:** `claude/kb-rag-k25-all-fixes`; one commit per work package, each
  green on its own; one PR against `main`. Never commit to `main`.
- **This prompt includes K23.** Do not run FIXES-K23.md separately: package A7
  implements it in full, inside this PR. If someone has already started K23 on
  another branch, stop and ask before A7. Set FIXES-K23.md's status to
  "Implemented in K25 (FIXES-K25.md)" in the A7 commit.
- **One schema change, not two:** A7 introduces pack schema 3 (K23 P1); A4's
  card status goes into schema 3 in the same PR, which is why A4 comes after
  A7.
- **Status:** see [Status](#status). Keep it current.
- Re-read this file and FIXES-K23.md after any context compaction; never guess
  scope.

**A1 is urgent:** without it, Anthropic is unusable whenever a KB pack is
loaded. If you can only finish one package, finish A1.

## What happened on real packs, and the bugs

On 12 Nov 2026 the first real packs were built and imported on an SE's Mac
(Chrome), both with the default coverage settings (min 0.5, minIdf 1.5, not
calibrated). Three things went wrong:

1. With Groq set, a visibility symptom about segments on a customer page
   showed no KB card; the model started an investigation and Groq
   rate-limited it.
2. With Anthropic set, the same card's exact title, asked on that card's own
   Confluence page, showed no KB card and failed:
   `tools.0.custom: For 'integer' type, properties maximum, minimum are not supported`.
3. The builder took several minutes with no output, and reported 13 5.x pages
   and 5 4.x pages as "malformed" although none is broken (13 use a different
   section layout; 5 are "No 4.x equivalent" notes).

| # | Bug | Evidence in code (5b3c096) | Fixed in |
| --- | --- | --- | --- |
| B1 | Anthropic rejects bounded integers in strict tool schemas. The AI SDK marks every tool strict; Anthropic's strict mode does not accept `minimum` or `maximum` on integers. Every request that offers such a tool fails. | `search_kb` (`tools/kb.ts`, `topK .int().min(1).max(5)`), offered on every Apty or symptom message since K16; also `devtools.ts` (two), `investigation.ts`, `dom-health.ts`, `extension-network.ts` (three), `apty.ts`, `diagnosis.ts`. Only Groq has a provider exception (`groqEmptyToolsNotStrictMiddleware`, `ai-provider.ts`). The E2E fake provider is OpenAI-shaped, so no test caught it. | A1 |
| B2 | A KB failure is silent, and "not covered" becomes a model call without a word. `localKbMatches` catches every error and returns `undefined`; `kbAnswer` then returns `undefined`; with a key set the message goes to the model, which never sees the card text for a real pack (K22). The SE cannot tell "no pack", "not covered", "wrong version" and "error" apart. | `packages/browser-runtime/src/kb/kb-matches.ts`, `apty/diagnosis/responder.ts` (`kbAnswer`) | A2 |
| B3 | No check that a card can find itself. An exact card title not being covered points to a scoring problem on real packs that no test detects: the CI and demo sets have 13 cards per pack, the real packs about 110. | `tooling/scripts/kb/eval-kb.mjs` has no self-retrieval mode; synthetic packs are small | A3 |
| B4 | "No equivalent in this version" pages are skipped as malformed. A 4.x question on such a topic gets the nearest unrelated card or "not covered" instead of "this does not exist in 4.x". | `build-kb-pack.mjs` classifies only full, stub, routing, malformed. | A4 |
| B5 | Builder messages and behaviour mislead. A page with a different heading layout is called "malformed"; there is no progress output; a stalled request waits forever (`fetchJson` has no timeout). | `build-kb-pack.mjs` (`classifyPage`, `fetchJson`, `main`) | A5 |
| B6 | A misleading reason. A question made only of context words the card holds reports coverage 1.00 with reason `low_coverage`. | `search.ts` | A6 |

The rest of what is still missing before SEs can use the Agent end to end:

| # | Gap | Today | Fixed in |
| --- | --- | --- | --- |
| G1 to G4 | Packs are not signed and never expire. | Fully specified in FIXES-K23.md ("Why: the gap") | A7 |
| C1 | No case. A debugging session has no id, no record of symptom, version, mode, environment, checks run, finding and outcome, and nothing survives closing the side panel. | `apty/investigation-session.ts` keeps an investigation in memory for the conversation only | L1 |
| C2 | The support advice is a fixed sentence. | `sendSupport` text; `BundleReviewDialog` is used only by DOM Health and the Ask Dapty export | L2 |
| C3 | Nothing learns from mistakes. There is no way to mark a card as wrong, record how a case ended, or hand the KB owner a list of misses. | None | L3 |

## Hard rules

1. No KB content in the repository. Tests use demo or synthetic packs only,
   including the large synthetic pack A3 adds. Never copy a real card's title,
   symptom or text into code, tests, fixtures, docs, commit messages or the PR
   body. `npm run audit:kb-pack` stays green.
2. No security regression. K22's rules hold: KB text never reaches a model
   unless policy approves a destination; the egress filter stays first;
   nothing new is sent to the provider. The A2 trace stays on the device and
   holds no card text.
3. Tool input stays validated. Removing schema keywords for a provider (A1)
   must not loosen what a tool accepts: every tool still validates its input
   with its Zod schema when it runs, and a test proves an out-of-range value is
   rejected for every provider.
4. Deterministic. Same packs and query give the same ranking, coverage, status
   and reason.
5. Test first. Every change starts with a test that fails on 5b3c096. Anything
   crossing the Chrome boundary also gets an E2E in `tooling/e2e/` using
   `harness.mjs`. Never skip, weaken or delete a test.
6. No new permission, host or runtime dependency; agent-core stays
   platform-free.
7. New UI strings in both en.json and zh.json; new surfaces pass axe in light
   and dark and work by keyboard alone.
8. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies` (after
   `pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace`),
   `npm run audit:architecture`, `npm run audit:tools`,
   `npm run audit:kb-pack`, `npm run audit:settings-readers`,
   `npm run report:request-size`, and the E2E files you touched. Paste the
   results into the PR body.

Also, for A7 and L1 to L3:

- K23's own hard rules and owner decisions (D-SEC8 to D-SEC11) apply to A7
  unchanged. Where this file and FIXES-K23.md disagree on A7, FIXES-K23.md
  wins; where they disagree on schema 3's card statuses, this file wins (A4).
- The KB owner's private signing key never enters the repository, CI, a test
  fixture or a log. Tests use the published demo key and keys generated inside
  the test.
- Cases stay on the device. The case record (L1), the support bundle (L2) and
  the feedback log (L3) are stored in the extension's IndexedDB only, never
  sent anywhere by the extension. Something leaves the browser only when the
  SE downloads or copies it after reviewing it.
- Nothing leaves unreviewed or unredacted. The support bundle and the feedback
  export go through Strict redaction and the content deny list, are shown in
  `BundleReviewDialog` before Copy or Download, and contain no KB card text
  (card ids and links only), no customer names, no user ids, no emails and no
  tokens.
- No new network call. L2 and L3 do not email, upload or post anything;
  sending the file is the SE's choice outside the extension.

## Work packages

Order: A1, A2, A3, A6, A5, A7, A4, then L1, L2, L3, then L4. A3 may find a
scoring bug; fix it inside A3, with its own test, before moving on.

### A1. Tool schemas every provider accepts (B1)

Files: `apps/browser-extension/src/services/ai-provider.ts` (provider
middleware), new `packages/agent-core/src/tools/provider-schema.ts` (+ test),
every tool file named in B1 only if a schema must change, a unit test that
builds real requests and `tooling/e2e/provider-schemas.e2e.test.mjs`.

- Anthropic strict mode does not support, among others: `minimum`, `maximum`,
  `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`; `minLength`,
  `maxLength`; `minItems` other than 0 or 1; `maxItems`. Confirm the current
  list in Anthropic's structured-output documentation and cite it in a
  comment.
- Add an Anthropic middleware, like `groqEmptyToolsNotStrictMiddleware`, that
  rewrites each tool's JSON schema before the request: remove the unsupported
  keywords and append each removed limit to that property's description in
  plain words ("1 to 5", "at most 300 characters", "exactly 2 numbers"). Keep
  `strict: true` when the rewritten schema is valid for strict mode; if a tool
  still cannot be expressed, send it without strict and record which tool in a
  debug log.
- The pure rewrite function lives in agent-core (`provider-schema.ts`), with a
  rule set per provider. Start with Anthropic (required) and Groq (move its
  existing rule here). For OpenAI, Google and the others, add a rule set only
  where the SDK or provider documents a limit, and cite it.
- Validation does not loosen (hard rule 3): `search_kb` called with `topK: 9`
  through the Anthropic path is rejected with the tool's usual error.
- Conformance test: build the provider request (the same code path the chat
  uses, with the provider's fetch stubbed) for each provider with every tool
  offered, and assert the tools part obeys that provider's rule set. Add a test
  that fails if a new tool adds a keyword a provider rejects.
- E2E: with a fake Anthropic endpoint that returns Anthropic's 400 error for an
  unsupported keyword, a covered question with a demo pack loaded and an
  Anthropic key gets an answer, not the error.

### A2. Make every KB decision visible (B2)

Files: `packages/browser-runtime/src/kb/kb-matches.ts`,
`apty/diagnosis/responder.ts`, the chat message components in `packages/ui`
and `apps/browser-extension`, i18n (+ tests, E2E).

- No silent failures. `localKbMatches` returns a typed outcome:
  `{ kind: "answer", result }`, `{ kind: "how_to" }`,
  `{ kind: "no_pack", version }`,
  `{ kind: "not_covered", reason, coverage, min, topPageId?, version, packs }`,
  or `{ kind: "error", code, message }`. Catch only to convert to `error`; log
  the error to the extension console with its stack.
- A decision record per turn: which route answered (check pack, KB, file
  fetch, or model), the tab version and how it was decided (files, user
  choice, unknown), the packs searched (version and sha256 prefix), and the KB
  outcome. Kept in the turn's state in the side panel only. It holds ids,
  numbers and codes, never card text or the question.
- When the model takes a message the KB did not answer, show one quiet line
  above the model's reply: not covered ("No KB card matched (coverage 0.42,
  needs 0.50). Asked the AI model."), no pack ("No 4.x pack is loaded. Asked
  the AI model."), error ("The KB could not be searched (<code>). Asked the AI
  model."), how-to: no line (D-KB1).
- Without a key, the same outcomes show in place of the generic "connect an AI
  provider" message.
- "Why this answer" disclosure on every assistant turn, collapsed by default:
  the decision record in plain words.
- Tests and an E2E (no key, demo pack): off-topic question shows the
  not-covered reason with its numbers; with the 4.x pack removed and the tab
  set to 4.x, "No 4.x pack is loaded".

### A3. Every card finds itself (B3)

Files: `tooling/scripts/kb/eval-kb.mjs`, `build-kb-pack.mjs`, new
`tooling/scripts/kb/fixtures/large-synthetic-cards.mjs` (+ tests), and
whatever A3's findings require in `packages/agent-core/src/kb/`.

- `kb:eval --self-check --pack <file>` needs no questions file. For every card
  it searches the card's own title (without the "RAG Card:" prefix) and, when
  present, its symptom line, with the pack's own version, and reports per
  query (rank of the card's own page id, status, reason, coverage, the
  coverage minimum, the top hit's page id) and totals (rank 1 and top 3, for
  titles and symptom lines; stubs and "not in this version" cards count as
  found when their own status comes back). Exit code 1 when any title is not
  in the top 3 or not covered. Output holds ids, numbers and codes only.
- The builder runs the self-check after writing a pack and prints its two
  totals and the failing ids. It never refuses to write the pack because of
  it.
- A large synthetic pack: 110 invented cards in 17 groups, four layers each of
  600 to 750 characters, realistic shared Apty vocabulary. Every card has a
  symptom line; 10 stubs, 6 routing pages, 5 "not in this version". All text
  invented and marked as fixture.
- Find and fix the cause of any self-retrieval failure, with a test per
  candidate cause; record it in the commit.
- Tests: self-check reports a broken synthetic pack correctly; the large
  synthetic pack reaches 100% title self-retrieval in the top 3 and at least
  95% at rank 1 with the builder's defaults; the unknown-version case returns
  the tab-agnostic card labelled with both versions.
- Real packs (KB owner, outside the repository): run
  `pnpm kb:eval --self-check --pack <pack>` for both packs.

### A6. Honest "not covered" reasons (B6)

- Reasons: `no_match` (no term matched any card, or every term was an ignored
  context word), `low_coverage`, `no_strong_term` (coverage reached the
  minimum but fewer than minTerms matched terms have idf ≥ minIdf), and
  `unknown_setting`.
- `search_kb`'s description explains each reason; the A2 line uses them.
- Tests: "the Workday home page tab" on the 4.x demo pack gives
  `no_strong_term` with coverage reported; each reason has a test.

### A5. A builder that says what it is doing (B5)

- A page with headings but no `Layer N:` headings is `other_format`, not
  `malformed`, with its first five headings reported. `malformed` stays for
  wrong layer numbers, order or counts. Counts per class on the summary line.
- Progress on stderr ("Listing pages…", "Fetched 40 of 118 pages" every 10
  pages and at the end, elapsed time); `--quiet` turns it off; stdout keeps
  today's summary.
- A timeout per request: 30 seconds (`--timeout <seconds>`), retried within
  `MAX_RETRIES`. The final error names the request path without credentials or
  query values, and says how to check access (troubleshooting row in
  `docs/development/kb-rag.md`).

### A7. Signed packs with expiry (K23, G1 to G4)

- Implement FIXES-K23.md in full (P1 to P6), recording D-SEC8 to D-SEC11.
- The A3 self-check and the A5 progress output run on schema 3 packs; the
  builder signs after the self-check; A4's `absent` status goes into schema 3;
  the A2 decision record gains the pack's key id and expiry date and a new KB
  outcome `{ kind: "pack_unusable", reason }` with its line ("The 4.x pack
  expired on 2027-01-10. Asked the AI model."); demo packs are signed with the
  demo key.

### A4. "Not in this version" cards (B4)

- Builder: a "RAG Card:" page with no layers whose text before any heading
  matches `/\bNo (4|5)\.x equivalent\b/i` is `absent`, with title, symptom line
  and `absentReason` (first sentence after "No 4.x equivalent:", at most 300
  characters). No chunks.
- Schema 3: card status `absent` and optional `absentReason`; integrity check
  rejects chunks on an absent card.
- Search: absent cards indexed on title and symptom; best covered match an
  absent card for the tab's version → `status: "not_in_version"`, one hit.
- UI and model: "This does not exist in Apty 4.x." with reason and link;
  `search_kb` returns the same status; Options shows "N not in this version".
- Eval counts an absent card as a hit when expected. E2E with a demo absent
  card.

### L1. A case for every debugging session (C1)

- A case starts on the first message in a conversation that is a symptom,
  runs a check, or shows a KB card; one open case per conversation.
- Record: id (`CASE-<yyyymmdd>-<4 base32>`), times, conversationId, tabHost,
  symptom (Strict-redacted, ≤ 300), aptyVersion, versionSource, mode,
  environment, clientVersion, checks, finding, kbShown, decisions, outcome,
  note (≤ 1,000).
- Storage: IndexedDB `apty-cases-db`, store `cases`; retention
  `caseRetentionDays` (policy, default 90, 1 to 365). No card text, file bodies
  or screenshots.
- Continuity: case id in the investigation bar with copy; survives panel
  reload; "Continue CASE-…" offered once for a host with an open case from the
  last 24 hours.
- Cases view: list, open, delete, delete all.

### L2. A support bundle the Agent assembles (C2)

- Rules declare `supportFields`; default set otherwise.
- Bundle (`apty-support-bundle` v1): case id and times, requested fields with
  values or `{ missing: true, hint }`, the finding, checks, trimmed file
  entries (≤ 4 KB each), status codes, console errors (≤ 50 lines), versions;
  ≤ 200 KB.
- Strict redaction and the deny list; URLs as origin + path with ids as `:id`;
  customer host part as `customer-app`; no card text, screenshots, user ids,
  emails or tokens.
- Prepare support bundle button opens `BundleReviewDialog` (JSON, missing
  fields, Copy, Download `apty-support-<case id>.json`, Copy as text).

### L3. Outcomes and wrong-card feedback (C3)

- Close a case: Resolved, Escalated, Not covered, Abandoned; "Was the finding
  right?" and "Which card was right?".
- Wrong card control on KB matches hits and verdict excerpts.
- Feedback store in `apty-cases-db`; exports (tracking-sheet CSV, kb:eval
  questions, Clear) through `BundleReviewDialog`.

### L4. Documentation

`docs/development/kb-rag.md`, `README.md`, `docs/security/ORG_POLICY.md`,
`PRIVACY.md`, `docs/security/DATA_FLOW.md`, `docs/security/SECURITY_AUDIT.md`,
`docs/release/SMOKE_TEST.md`, `docs/STATUS.md`, `CHANGELOG.md`,
`docs/tasks/kb-rag/decisions.md` and `DECISIONS.md`. Record D-CASE1 and
D-CASE2.

## Acceptance checks

1. Anthropic works (conformance test for every provider; fake-Anthropic E2E;
   `topK: 9` rejected on every provider path).
2. No silent KB outcome.
3. Self-retrieval: 100% top 3 and ≥ 95% rank 1 on the large synthetic pack.
4. Real packs: totals in the PR, or partial with the commands.
5. Reasons: each has a test; "the Workday home page tab" gives
   `no_strong_term`.
6. Builder: `other_format`, stderr progress, timeout and retry.
7. "Not in this version" end to end.
8. No regressions (agent-core 557, browser-runtime 1,934, ui 454,
   browser-extension 636, MCP bridge 72, KB tooling 48 on 5b3c096; demo
   evaluations at 100%).
9. Every check in hard rule 8 is green.
10. No card text in the diff, fixtures, commit messages or PR body.
11. Docs, STATUS, CHANGELOG and this file's status updated.

And: FIXES-K23.md's acceptance checks (A7); cases, support bundle, outcomes
and feedback as described in L1 to L3; no network call added by L1 to L3.

## Out of scope

Rewriting real KB pages; a second card shape; calibrating the real packs;
distributing packs or sending bundles from the extension; layer ranking
changes; 4.x ports of element-not-found and page-readiness, dense vectors,
the Apty Client bridges; people-side steps.

## Status

IN PROGRESS.

| Package | Status |
| --- | --- |
| A1 Tool schemas every provider accepts | Done |
| A2 Make every KB decision visible | Done |
| A3 Every card finds itself | Done; the real-pack self-check (acceptance 4) is partial: KB owner to run `pnpm -s kb:eval --self-check --pack <pack>` on both packs |
| A6 Honest "not covered" reasons | Done |
| A5 A builder that says what it is doing | Done |
| A7 Signed packs with expiry (K23) | Done; the KB owner's built-in key is empty until they run `pnpm kb:keygen` |
| A4 "Not in this version" cards | Done |
| L1 A case for every debugging session | Done |
| L2 A support bundle the Agent assembles | Done |
| L3 Outcomes and wrong-card feedback | Done |
| L4 Documentation | Not started |
