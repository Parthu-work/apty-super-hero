# Apty Agent: the support runbook

For the KB owner and IT during the pilot. The SE's side is in
[se-guide.md](se-guide.md); pack hosting and delivery set-up in
[release/KB_PACK_DELIVERY.md](release/KB_PACK_DELIVERY.md); the policy keys
in [security/ORG_POLICY.md](security/ORG_POLICY.md).

## The weekly pack cycle (KB owner)

1. Fold in what the week's feedback asks for (below): fix wrong cards,
   write stubs, resolve NOT VERIFIED statements.
2. Rebuild each version on the signing machine; the token is typed at a
   hidden prompt ([development/kb-rag.md](development/kb-rag.md)):

   ```bash
   pnpm kb:pack --space A4PKH --root 1509720081 --version 4.x --sign-key ~/apty-kb-signing-key/kb-signing-key-<keyId>.pem
   ```

   ```bash
   pnpm kb:pack --space JA --root 1496711169 --version 5.x --sign-key ~/apty-kb-signing-key/kb-signing-key-<keyId>.pem
   ```

3. Read the builder's summary: card counts, "N routing left out", skipped
   pages and the self-check totals. Every title must find its own card in
   the top 3; the builder names any that do not.
4. Run the real questions for each version and compare with last week:

   ```bash
   pnpm kb:eval --pack "$(ls -t ~/apty-kb/apty-kb-A4PKH-4.x-*.kbpack.json | head -1)" --questions ~/apty-kb/questions-4x.json --by-category
   ```

   The gate: Recall@3 at least 0.90, "not covered" precision at least 0.90
   and recall at least 0.80. Below it, do not publish; fix the cards first.
5. Publish: put the packs on the restricted page, or let the nightly job
   deliver them (it runs the same gate). A pack expires 60 days after it
   is built by default; publish well before.

## Reading the feedback export (KB owner)

SEs send Options → General → Feedback → **Export CSV** weekly. It holds ids,
counts and times; question text only when the SE ticked "Include my
question".

Its columns: date, case id, Apty version, pack built, card shown (`id#Llayer`),
right card, outcome (the case's: resolved, escalated, not_covered,
abandoned), coverage, reason, note, mark (`wrong card` or `helped`).

| A row with | What to do |
| --- | --- |
| A **right card** (a Wrong card report) | The right card ranked low or not at all: compare its title and symptom line with the question; add the user's words to the card, or propose a synonym |
| outcome `not_covered`, a low coverage | A real question with no card: write one, or add it to the questions file as one the KB should not cover |
| reason `unknown_setting` | The SE named a setting no card has: if Apty has it, a card should name it |
| card shown ending in `#L4` on a symptom | The support layer answered first: check the card's layers 1 to 3 |
| Many rows with the same card shown | That card does a lot of work: make sure it is verified |

**Export questions for kb:eval** gives a questions file for `kb:eval
--questions`; add those questions to the next week's run.

**Export proposed synonyms** (only with "Include my question" ticked) lists,
per right card, the words SEs used in wrong-card questions that the card
does not contain, with how many questions used each. They are proposals:
decide which are real synonyms, add them to the card's text or to the pack's
`retrieval.synonyms` at the next build, and ignore the rest. Nothing is
applied by itself; the pack changes only when you rebuild it.

## Escalation path

1. The SE works the verdict or the KB card, and the next check it names.
2. Still stuck: the SE asks the KB owner, with the case id and a copied
   "Why this answer".
3. A cause Apty must fix, or a product bug: the SE files an Apty support
   ticket with the support bundle (Strict redaction, customer host shown as
   `customer-app`). Support replies on the ticket; the SE closes the case
   as resolved or escalated.
4. Anything about the extension itself, the policy or AI keys goes to IT.

## Incident: a signing key may have leaked

Do all four, in order, the same day:

1. **Revoke.** IT adds the key's 16-character id to `revokedPackKeyIds` in
   the managed policy and pushes it. Every pack it signed stops being used
   at the next question; SEs see "The … pack is signed by a revoked key."
2. **New key.** The KB owner runs `pnpm kb:keygen` on the signing machine
   and sends IT the new key id and public key (never the private key). For
   the CI key, also replace the `KB_CI_SIGNING_KEY` secret.
3. **Trust the new key.** IT replaces the old entry in `trustedPackKeys`
   with the new one and pushes the policy.
4. **Rebuild and redistribute.** The KB owner rebuilds and signs every
   version with the new key and publishes them (or runs the delivery
   workflow by hand). SEs re-import if they import by hand; Options shows
   "Signed by key <new id>".

Then record what leaked, when, and which packs were signed with it.

## Incident: a pack with wrong or sensitive content went out

1. IT revokes the key that signed it (above), or, if the key is fine, the
   KB owner publishes a corrected pack built later (a newer `builtAt`
   replaces it on delivery).
2. Tell SEs to delete the pack in Options → Knowledge base if they imported
   it by hand.
3. Fix the card in Confluence and rerun the weekly cycle.
