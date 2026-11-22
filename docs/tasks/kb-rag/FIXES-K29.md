# KB-RAG K29: a clear, stable panel and the 22 Nov test fixes

22 Nov 2026 · Apty Customer Success

## Status

**DONE, with partial steps.** Four PRs: Part P (P1 to P4) on
`claude/kb-rag-k29-pipeline` (#130, fixes #129); Part B (B4, B1, B3, B2,
B5, B6, B7, B8) on `claude/kb-rag-k29-behaviour` (#131); Part L (L1 to L5)
on `claude/kb-rag-k29-layout` (#132); Part D (D1, D2 and D3 in one commit,
D4, D5) on `claude/kb-rag-k29-delivery` (#134, on top of L, merging B for
B1's store). Merge order: P, L, B, D.

Partial, with what finishes each:

- The leak check against the two real packs (KB owner):
  `pnpm kb:check-leaks --pack <4.x pack> --pack <5.x pack>` (see How to
  test).
- After merge, in GitHub: run KB packs by hand without the switch (it names
  the missing inputs), and check that the next scheduled run succeeds
  quietly.
- The full `npm run test:e2e` and `npm run release:dry-run` on the merged
  tree; each PR ran its affected E2E files (P 2, B 13, L 24, D 30).
- The 22 Nov hand session in Chrome and its screen recording (needs a real
  browser, both packs and an Anthropic key).
- Not checked: whether Confluence redirects old JA links by page id, so 5.x
  links in JA packs are always rewritten to A5PKH at load.
- D2: a KB answer whose card a check pack reads also shows Run the check,
  9 controls; the fixture answers have at most 8.

## How to run this prompt

This is a complete, self-contained implementation prompt for a coding agent.
Do every work package in order until every acceptance check passes. Do not
stop at a plan and do not skip a package. Where a step cannot be done in
your environment (no browser, no repository secrets), do everything else,
mark that step partial, and say exactly what is left and the command that
finishes it.

- **Base:** `origin/main` at `9fc6533b` (20 Nov 2026) or later. It holds K10
  to K28.
- **Four parts, four PRs, in this order:** P (pipeline and KB tooling, fixes
  issue #129) on `claude/kb-rag-k29-pipeline`; L (panel layout and
  scrolling) on `claude/kb-rag-k29-layout`; B (behaviour fixes) on
  `claude/kb-rag-k29-behaviour`; D (how an answer is delivered) on
  `claude/kb-rag-k29-delivery`. D builds on L. One commit per package, each
  green on its own. Never commit to `main`.
- **Status:** see above. Save this prompt as
  `docs/tasks/kb-rag/FIXES-K29.md` in the first commit and keep its status
  line current. Re-read it after any context compaction; never guess scope.
- **Evidence base:** the SE test on 22 Nov 2026 on a 5.x tenant tab, with
  both real packs built on 17 Nov and an Anthropic key; a 36-second screen
  recording of the side panel; issue #129 ("KB pipeline failing", opened by
  the nightly job on 20 and 21 Nov); and a check of each answer against the
  Confluence cards.

## What the 22 Nov test and issue #129 showed

The right card came first in most answers and invented settings were
caught; the problems are the panel's layout, how much each answer shows,
the version never being known, a check that gives up too early, and a
nightly job that fails every night.

Card titles are replaced by page ids or a neutral description (hard rule 1).

| # | Finding | Evidence | Fixed in |
|---|---------|----------|----------|
| 1 | The nightly job fails every night (issue #129). | `kb-packs.yml` runs on its schedule although the secrets and variables are not set yet; "Check the secrets and variables" fails for 4.x and 5.x on 20 and 21 Nov and comments on #129 each time | P1 |
| 2 | The 5.x cards moved to space A5PKH. | Root 1496711169 and every 5.x card now sit in A5PKH with unchanged ids; `tooling/scripts/kb/sources.json` still says `"space": "JA"`, so the 5.x build finds nothing; the docs and guides say JA too | P2 |
| 3 | Packs built before a classification change keep its old behaviour silently. | The 17 Nov packs predate K27 F3 and E3: "start here" pages show as answers (help icon, element, Widget Activation) and broad questions get no choices; nothing tells the SE to rebuild | P3 |
| 4 | The chat gets about a tenth of the panel. | Recording: the title, packs line, site row and case strip (Case, Copy, Site, New case, Close case) are fixed above the chat (`investigation-context-bar.tsx`, `case-strip.tsx`); about 170 px of 1,650 is left for the chat, and Close case opens its form there, leaving about 60 px | L1, L2 |
| 5 | The view jumps when a card changes height. | Recording, seconds 18 to 23: switching a card from L3 to L4 sent the view back to the top of the answer | L3 |
| 6 | Two scroll areas. | Recording, second 2: the whole panel header moved up and the chat area went blank; two scrollbars are visible; the wheel sometimes moves nothing | L1 |
| 7 | The scroll-to-bottom button covers the text. | Recording: the ↓ button sits in the middle of the reading area all the time | L4 |
| 8 | Each answer is crowded. | Per answer: three chips; three full cards each with L1 to L4, a layer label, three bullets, "Next:", "Verified on", This helped and Wrong card; then "These cards are for different Apty versions…" with a version picker; two boilerplate lines; Prepare support bundle; Why this answer; Copy; and the pack expiry repeats the header | D1 to D4 |
| 9 | The version is never known, and the question repeats. | "Apty version unknown" on every answer on a 5.x tenant tab; the choice is kept in an in-memory map (`packages/browser-runtime/src/kb/kb-version.ts`, `known`) that a new chat or panel reload loses | B1 |
| 10 | Mixing versions promotes weak cards. | "what does flow.json mean": an unrelated 5.x card (a reload symptom) in second place; "workflow not working": an unrelated 5.x card (a publishing limit); the drop-off answer lists two unrelated 5.x cards under "Cards for other Apty versions" | B2 |
| 11 | A file name already says the version, and it is not used. | flow.json is 4.x and workflow.json 5.x; the answer to "what does flow.json mean" on a 5.x tenant never says the 5.x file is workflow.json | B3 |
| 12 | A check gives up when the connected Client has no record for this tab. | "widget is missing" on the 5.x tab: "The Apty Client did not report loading app-urls.json", then a 4.x service-worker HAR route. `apty-files.ts` reads the CDN only "when the Client does not answer"; here the Client (a 4.x dev build that does not run on this site) answered with nothing. On 17 Nov the same tab read the CDN | B4 |
| 13 | A "no data" verdict gives no steps. | The right card (1496645690) is shown only as a link | B5 |
| 14 | After "Ask the AI anyway" the model still guessed, and the grounding flags product names. | "…the toggle may be in the application settings, widget configuration, or environment settings area"; "Not found in the KB: Widget Activation toggle, Apty Studio, Apty KB, Apty Support" | B6 |
| 15 | "help icon is gone" missed the right cards. | Cards 1509785878 (4.x) and 1496645690 (5.x), on the widget not appearing at all, were not in the top 3; a narrower card on the widget missing for only some users was; "gone" reaches "missing" through a synonym, but "not appearing" is not in that group | B7 |
| 16 | Two lookup leftovers from the 20 Nov check. | "Sign in workflow in All Users segment" (a statement whose name contains "in") no longer routes; the no-Client lookup heading reads "Lookup from the Apty unknown content files" | B8 |

"Why this answer" showing empty bullets in the pasted text is not a bug:
the recording shows the section collapsed when it was copied. Its Copy
button copies the lines.

## Hard rules

1. No KB content in the repository. Tests and fixtures use synthetic cards
   and invented names. Real page ids are fine; real titles and card text
   are not.
2. No security regression. K22 to K28 hold: the egress filter runs first;
   card text reaches a model only through an approving policy; cases and
   feedback stay on the device; the model never states an Apty fact it was
   not given. The version remembered per site (B1) is a host and a version
   only, kept on the device.
3. Nothing the SE could need is removed, only moved. Every action, line and
   badge an answer shows today stays reachable in at most one click (a
   menu, a disclosure, a tooltip). Accessibility stays: every control has a
   name, shows focus and works by keyboard; axe passes in light and dark.
4. Deterministic. The same packs, files and question give the same cards,
   order, route and decision record.
5. Test first. Each package starts with a test that fails on `9fc6533b`.
   Anything crossing the Chrome boundary gets an E2E using `harness.mjs`.
   The layout tests run at the side panel's real sizes (320, 400 and 480 px
   wide; 600 and 900 px tall) with the real header, a case open and the
   Close case form open. Never skip, weaken or delete a test.
6. No new permission, host or network call in the extension. B4 reads the
   same public CDN files the extension already reads.
7. Secrets never enter logs or summaries. Workflow output names missing
   secrets and variables, never their values.
8. New UI strings in `en.json` and `zh.json`.
9. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies` (after
   `pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace`),
   every `audit:*` script, `npm run report:request-size`, `actionlint` on
   changed workflows, and the E2E files you touched (chat-scroll with
   `--test-timeout=600000`). Paste the results into the PR body.

## Part L: panel layout and scrolling

Goal: the conversation gets most of the panel, only the conversation
scrolls, and nothing moves under the SE's eyes. Order: L1, L2, L3, L4, L5.

### L1. One small header and one scroll area (findings 4, 6)

Files: `apps/browser-extension/src/components/browser-chat-header.tsx`,
`investigation/investigation-context-bar.tsx`, `cases/case-strip.tsx`, the
side panel root, `packages/ui/src/components/ai-elements/conversation.tsx`,
`packages/ui/src/components/chatbot/components/message-list.tsx`.

- Header, at most 96 px at any width from 320 to 480 px: row 1, the product
  name and a small pack-status icon (its tooltip says "4.x expires in 56
  days, 5.x expires in 56 days"; it turns amber under 14 days and red when
  a pack is unusable). Row 2, one context line: the site, the case chip,
  the version chip, the setup badge.
- The case chip shows the short case id. Clicking it opens a menu: Copy
  case id, New case, Close case…, Open in Cases. The separate "Case …",
  "Site …", New case and Close case rows go away; nothing they offered is
  lost (hard rule 3).
- One scroll container. The document and the panel root never scroll: the
  root is a flex column at full height with `overflow: hidden`, the header
  and composer are fixed-size, and the message list is the only element
  with `overflow-y: auto` (`min-height: 0` on its flex parents). An
  investigation's details (plan, components, timeline) open inside the
  scroll, not in the header.
- Tests: at 320, 400 and 480 px wide and 600 and 900 px tall, the header is
  at most 96 px; the message list is at least 65% of the panel's height
  with a case open; `document.scrollingElement` cannot scroll; exactly one
  element in the panel can scroll vertically.

### L2. Close case as a dialog (finding 4)

Files: `cases/close-case-form.tsx` and its caller.

- Close case… opens a modal dialog (focus moves into it, Escape and Cancel
  close it, focus returns to the case chip) with the same outcome and "Was
  the finding right?" choices. The chat's height does not change while it
  is open.
- Tests: opening and closing the dialog leaves the message list's height
  and scrollTop unchanged; keyboard only; axe light and dark.

### L3. Nothing jumps when a card changes height (finding 5)

Files: `conversation.tsx`, `kb-layer-switcher.tsx`, `kb-matches-card.tsx`,
the disclosures in the chat ("Why this answer", "More questions", "Other
possible cards", thinking details).

- When the SE switches a layer, opens or closes a disclosure, or a card
  above the viewport changes height, keep the element they clicked (or the
  first visible turn) at the same screen position: measure its top before
  the change and correct scrollTop after it, in the same frame. Do not call
  scroll-to-bottom for a change the SE made.
- Auto-scroll to the bottom only for a new message, and only when the SE
  was already within 48 px of the bottom.
- Tests: switching L1 to L4 on the second of three cards moves that card's
  top by at most 2 px; opening "Why this answer" on a middle turn does not
  scroll; a new answer while the SE reads higher up does not move the view.

### L4. A scroll-to-bottom button that never covers text (finding 7)

Files: `conversation.tsx` (`ConversationScrollButton`).

- Show it only when the SE is more than one screen from the bottom, as a
  small round button in the bottom-right corner of the message list,
  inside reserved space so it overlaps no text. It says how many new
  answers arrived below ("2 new").
- Tests: hidden within one screen of the bottom; its box intersects no text
  node at 320, 400 and 480 px.

### L5. A layout test that matches real use, and a faster long-chat test

Files: new `tooling/e2e/panel-layout.e2e.test.mjs`,
`tooling/e2e/chat-scroll.e2e.test.mjs`.

- panel-layout loads the panel at the sizes above with a real case open,
  three KB answers of three cards each, and the Close case dialog, and
  asserts L1 to L4. Record a short trace for the PR.
- chat-scroll currently needs 10 minutes per file; split it or shrink its
  fixture so every file passes inside the suite's 180 s limit and
  `npm run test:e2e` passes as written. Keep its 300-turn windowing
  assertions.

## Part D: how an answer is delivered

Goal: one clear answer at a glance; everything else one click away. Today a
three-card KB answer shows about 25 controls and lines before the SE reads
a step. Order: D1 to D5. All on top of Part L.

The target shape of a KB answer (invented text):

```
You: the DEMO panel icon is gone

  DEMO panel does not appear                          5.x
  [Settings]  Console   Network   Support
  1. In Admin, check that the DEMO panel is switched on for this environment.
  2. Check that the user is in the panel's segment.
  3. Publish, then reload the page.
  Next: Console ›
  From the KB · 5.x · verified on 5.x code (i)        Helpful   Wrong card   ⋯
  › 2 other possible cards
```

### D1. One best card, the others folded (finding 8)

Files: `apps/browser-extension/src/components/investigation/kb-matches-card.tsx`,
`kb-card-excerpt.tsx`, `kb-layer-switcher.tsx`, i18n.

- Show the first card open at its chosen layer (K27 F6), as numbered steps.
  Fold the others under N other possible cards: one line each (title and
  version badge); clicking one opens it in place of the first and folds the
  first.
- Name the layer tabs Settings, Console, Network, Support (keep "L1" to
  "L4" as their accessible descriptions). Show Not verified once on the
  card when any step on the open layer carries it, and mark the statement
  itself.
- Tests: a three-card answer shows one open card and one fold line; every
  card is reachable in one click; keyboard order is the open card, the
  fold, the actions.

### D2. One source line, one action row (finding 8)

Files: `kb-matches-card.tsx`,
`apps/browser-extension/src/components/cases/turn-action-row.tsx`,
`helped-button.tsx`, `wrong-card-button.tsx`, `support-bundle-button.tsx`,
`packages/ui/src/components/chatbot/components/turn-decision-note.tsx`,
i18n.

- Replace the three chips and the two boilerplate lines (provenance,
  notSent) with one muted line, "From the KB · 5.x · verified on 5.x code",
  whose (i) tooltip holds the rest ("Each title opens its card in
  Confluence. Shown here only; not sent to the AI model.") and the pack's
  expiry.
- One action row per answer: Helpful, Wrong card, and a ⋯ menu with Copy
  answer, Why this answer, Prepare support bundle, Open in Confluence. "Why
  this answer" opens as a small popover with its own Copy.
- The per-answer pack-expiry chip goes (the header shows pack status, L1).
- Tests: a KB answer shows at most 8 interactive controls before anything
  is opened; every control removed from view is in the ⋯ menu or the
  tooltip (hard rule 3).

### D3. Ask the version once per site (findings 8, 9)

Files: `kb-version-control.tsx`, `kb-version-chip.tsx`,
`kb-matches-card.tsx`, i18n (with B1).

- When the version for this site is not known and an answer has cards of
  both versions, show one line above the answer: "Which Apty version does
  acc.autodesk.com run? 4.x 5.x Not sure". Once answered, it does not
  appear again for that site (B1 remembers it), and the answer re-renders
  with that version only.
- "Not sure" keeps both versions, grouped under "4.x" and "5.x" headings
  inside the fold, never interleaved.
- The per-answer mixedVersions line and version picker go; the header's
  version chip changes the version at any time.
- Tests: the question appears once per site per device; choosing 5.x hides
  4.x cards in that answer and the next ones; the chip changes it back.

### D4. A check verdict that leads with what to do (findings 12, 13)

Files: `check-result-card.tsx`, `get-evidence.tsx`,
`no-cause-card-layers.tsx`, i18n.

- First line: the cause, "No cause found in the files", or "No data yet",
  in one sentence. Then What to do: the cause's fix, or the card's Settings
  and Console steps for no cause and no data (B5). Then the evidence route
  as one button. The checks table, the files read and the HAR steps fold
  under Details.
- The same source line and action row as D2.
- Tests: each verdict type puts its one-sentence result and What to do
  above the fold.

### D5. Model answers that say what they are (finding 14)

Files: `turn-decision-note.tsx`, the grounding display
(`packages/ui/src/lib/kb-grounding.ts` and its renderer), i18n.

- A model-only answer carries one line, "AI answer, not from the KB or a
  check", in place of the chips.
- Grounding flags show as a dotted underline on the phrase with a tooltip,
  plus one line "2 phrases are not in the KB", not a list. Product and role
  names (Apty, Apty Studio, Apty Admin, Apty Support, KB owner, Confluence)
  are never flagged (B6).
- Tests: the Widget Activation reply shows the line and flags only "Widget
  Activation".

## Part B: behaviour fixes

Order: B4, B1, B3, B2, B5, B6, B7, B8.

### B4. A check reads the CDN when the connected Client has nothing for this tab (finding 12)

Files: `packages/browser-runtime/src/apty/diagnosis/apty-files.ts`,
`widget-not-visible.ts`, `content-not-visible.ts`, `get-evidence.tsx`,
tests, E2E.

- Today the CDN is read only "when the Client does not answer". Also read
  it when the Client answers but has no record for this tab's site (its
  content script does not run there, or it observed no Apty file for this
  origin). Label the source as today ("Content files read from Apty's
  content CDN…").
- Offer the 4.x service-worker HAR route only when the files or the site's
  version say 4.x. With the version unknown and no files from either
  source, show Get the evidence with both routes and a one-line hint on how
  to tell them apart.
- Tests: a fake Client that is connected but reports nothing for the tab
  leads to a CDN read and a verdict; a 5.x tab is never offered the 4.x
  route; E2E with the fake 5.x CDN and an empty connected Client.

### B1. Remember each site's version on the device (finding 9)

Files: `packages/browser-runtime/src/kb/kb-version.ts` (the in-memory
`known` map), its callers, the store for it, Options' Delete stored data
now, tests.

- Keep the version per host in the extension's local storage (host,
  version, source, date), loaded at start-up, with today's ranking of
  sources (the files over the SE's choice over an inference). Clear it with
  Delete stored data now; drop entries unused for 90 days.
- Set it from the Client's observed files (K27 F7), from CDN files a check
  read (B4), from the SE's choice (D3), and from a file name in the
  question (B3, lowest rank).
- Tests: a version chosen in one chat applies in a new chat and after a
  panel reload; the files override a choice; deleting stored data clears
  it.

### B3. A file name tells the version (finding 11)

Files: `packages/browser-runtime/src/kb/kb-matches.ts`,
`packages/agent-core/src/kb/search.ts` or a small helper beside it,
`apty/diagnosis/pack-kit.ts` (the K13 markers), i18n.

- A question naming a 4.x-only file (flow.json, flow-<id>.json,
  segments.json, rules.json) searches the 4.x pack; a 5.x-only file
  (workflow.json, workflow-<id>.json, segment.json, rule.json) the 5.x
  pack.
- When the site's version is the other one, add one line: "flow.json is a
  4.x file. On Apty 5.x the workflow list is workflow.json.", and show the
  other version's card for that file when the pack has one.
- Tests (synthetic packs): "what does flow.json mean" on a 5.x site gives
  the 4.x card plus the line; on a 4.x site, no line.

### B2. Mix versions only on strong matches (finding 10)

Files: `packages/agent-core/src/kb/index-set.ts`, `search.ts`, tests.

- With the version unknown, take each version's ranked hits as today, but
  keep another version's card only if it is itself covered and its score
  is at least 70% of the best card's. The same rule decides the list under
  "Cards for other Apty versions" after a not_in_version answer.
- Tests (synthetic): a strong 4.x match and a weak 5.x match return only
  the 4.x card; two strong matches return both, grouped by version; the
  not_in_version list holds only the matching other-version card.

### B5. "No data" gives the card's steps (finding 13)

Files: `check-result-card.tsx`, `no-cause-card-layers.tsx`.

- A "no data" verdict shows the card's Settings and Console steps, as K27
  F8 does for "no cause". D4 places them.

### B6. "Ask the AI anyway" does not guess, and grounding ignores product names (finding 14)

Files:
`apps/browser-extension/src/components/investigation/kb-unknown-setting.tsx`
(the Ask the AI anyway button and what it sends),
`packages/agent-core/src/kb/decision.ts` (the "no card" instruction),
`packages/ui/src/lib/kb-grounding.ts`, `packages/ui/src/lib/turn-decision.ts`,
tests.

- The ask-anyway request carries the KB's outcome as a fact ("The Apty KB
  has no setting named 'Widget Activation'.") and the instruction: say the
  KB has no such setting; do not say where a setting with that name might
  be; suggest the KB owner or Studio and Admin in general terms only.
- Add product and role names to the grounding stop list (Apty, Apty Studio,
  Apty Admin, Apty Support, KB owner, Confluence, Chrome, Edge).
- The ask-anyway turn's decision record shows the KB outcome it follows
  ("KB: no setting named Widget Activation"), not "Packs searched: none".
- Tests: a fake provider returning the 22 Nov reply gets its location
  sentence flagged; only "Widget Activation" is flagged as a phrase; the
  record carries the KB outcome.

### B7. "Gone" and "not appearing" mean the same (finding 15)

Files: `packages/agent-core/src/kb/synonyms.ts`, `search.test.ts`, the demo
questions.

- Add "not appearing", "does not appear", "doesn't show", "not showing",
  "not visible", "gone" and "disappeared" to the disappear and missing
  group; keep the collision tests.
- Tests (synthetic): "the DEMO panel icon is gone" ranks the synthetic
  "DEMO panel does not appear" card first, above a "DEMO panel missing for
  some users" card.

### B8. Two lookup leftovers (finding 16)

Files: `packages/browser-runtime/src/apty/diagnosis/lookup.ts`,
`lookup-card.tsx`, i18n.

- A statement whose workflow name contains "in" routes again ("Sign in
  workflow in All Users segment"), without routing any of K28 F1's negative
  rows.
- The heading for an unknown version or a missing Client says so in words
  ("Lookup: the Apty Client is not connected"), never "the Apty unknown
  content files".
- Tests: K28 F1's whole table still holds, plus the two cases.

## Part P: pipeline and KB tooling

Order: P1, P2, P3, P4. Do this part first: it stops the nightly failures
and makes the next rebuild work.

### P1. The nightly job runs only once it is set up (finding 1, fixes #129)

Files: `.github/workflows/kb-packs.yml`, `.github/workflows/kb-pack-health.yml`,
a new `tooling/scripts/kb/pipeline-inputs.mjs` (+ test) that holds the
check now inline in the workflow, `tooling/scripts/kb/pipeline-alert.mjs`,
`docs/release/KB_PACK_DELIVERY.md`.

- A switch. Add the repository variable `KB_PACKS_ENABLED`. A scheduled run
  with it unset ends at its first step with a notice ("KB packs are not set
  up yet; set KB_PACKS_ENABLED to 1 after the steps in
  KB_PACK_DELIVERY.md") and succeeds, opening no issue. A manual run always
  checks the inputs and fails with the names of whatever is missing, as
  today. With the switch on, a missing secret or variable fails the
  scheduled run and opens the issue, as today.
- Same rule for `kb-pack-health.yml`.
- Close the issue automatically. On the first green run after a failure,
  `pipeline-alert.mjs` comments "Green again: <run link>" on the open
  kb-pipeline issue and closes it.
- Move the inputs check out of the inline shell into
  `pipeline-inputs.mjs`, so the three cases are unit-tested: scheduled and
  not enabled (skip, success); manual with missing inputs (fail, names
  only); enabled with missing inputs (fail, names only). Never print a
  value.
- The PR body says "Fixes #129".

### P2. The 5.x cards' new space (finding 2)

Files: `tooling/scripts/kb/sources.json`, `build-kb-pack.mjs` (known
spaces), `docs/release/KB_PACK_DELIVERY.md`, `docs/development/kb-rag.md`,
`README.md`, any doc or test fixture that names `--space JA` for 5.x.

- `sources.json`: 5.x is `"space": "A5PKH"`, root 1496711169 (unchanged).
- The builder knows A5PKH means 5.x (as A4PKH means 4.x), so `--version` is
  no longer required for it. Given `--space JA --root 1496711169`, it stops
  with "The 5.x cards moved to A5PKH; use --space A5PKH".
- Card links come from each card's own URL, so a rebuilt pack links to
  A5PKH. Check that a pack built from JA before the move still opens its
  links (Confluence redirects by page id); if not, rewrite JA links to
  A5PKH for 5.x cards at load.
- Tests: the sources file passes the workflow's matrix; the JA message; the
  docs-links audit.

### P3. Old packs behave like new ones, and say they are old (finding 3)

Files: `packages/agent-core/src/kb/pack.ts`, `index-set.ts` or `search.ts`
(where the index is built), `build-kb-pack.mjs`,
`packages/ui/src/components/settings/knowledge-base-card.tsx`, the
Preflight KB rows, i18n.

- At load, treat any card whose title starts with "start here" as routing,
  whatever the pack says (the K27 F3 rule, applied to old packs too), so it
  is never shown as an answer.
- A classifier revision. The builder writes an optional
  `classifierRevision` (start at 2 for K27's routing rule; raise it
  whenever the page classification changes). When a loaded pack's revision
  is older than the extension expects, its Options row and Preflight say
  "Built before the latest card rules: rebuild this pack for the best
  answers", and the pack is still used.
- Tests: a synthetic pack without the field, holding a four-layer "start
  here" card, never returns it as a hit and shows the rebuild note; a
  current pack shows no note.

### P4. Keep real card text out of the repository

Files: a new `tooling/scripts/kb/check-leaks.mjs` (+ test), `package.json`
script `kb:check-leaks`, `docs/development/kb-rag.md`.

- `pnpm kb:check-leaks --pack <file> [--pack <file>]` reads the packs
  (outside the repository) and scans every git-tracked file for any card
  title or symptom line of four words or more (case-insensitive,
  whitespace-normalised). It prints file, line and page id only, and exits
  1 on any hit.
- Run it against both real packs if you have them (otherwise the KB owner
  does): the earlier task files in `docs/tasks/kb-rag/` quote some card
  titles in their findings. Replace each with its page id.
- When you save this prompt as `docs/tasks/kb-rag/FIXES-K29.md`, replace the
  real card titles in "What the 22 Nov test and issue #129 showed" with
  their page ids before committing.
- Tests: a synthetic pack and a fixture file with one planted title give
  one hit with the right file, line and id; a clean tree gives none.

## Acceptance checks

All must hold; paste the evidence in each PR body.

1. Every finding has a test that failed on `9fc6533b` and passes now. List
   them as finding → test name.
2. Issue #129 (P1): a scheduled run without `KB_PACKS_ENABLED` succeeds with
   the notice and opens no issue; a manual run names the missing inputs;
   the first green run closes the open kb-pipeline issue; the PR body says
   "Fixes #129".
3. 5.x move (P2): `sources.json` says A5PKH; the builder infers 5.x from
   A5PKH and stops on JA with the move message; docs and fixtures no longer
   say JA for 5.x.
4. Old packs (P3): a pack without `classifierRevision` never shows a "start
   here" card as an answer and shows the rebuild note in Options and
   Preflight.
5. Leaks (P4): `kb:check-leaks` finds a planted title in a fixture and none
   in the tree after the fixes; FIXES-K29.md holds page ids, not card
   titles.
6. Layout (L1 to L5): at 320, 400 and 480 px wide and 600 and 900 px tall,
   with a case open: header at most 96 px, message list at least 65% of the
   panel, one scroll container, the document never scrolls; the Close case
   dialog leaves the list's height and scrollTop unchanged; a layer switch
   moves its card by at most 2 px; the ↓ button covers no text and hides
   near the bottom; `npm run test:e2e` passes with its 180 s limit.
7. Delivery (D1 to D5): a three-card KB answer shows one open card, one
   fold line, one source line and at most 8 controls; every control removed
   from view is reachable in one click; the version question appears once
   per site; a verdict leads with its one-sentence result and What to do; a
   model-only answer shows its one line and flags only phrases that are not
   product names.
8. Behaviour (B1 to B8): the version survives a new chat and a reload and
   clears with Delete stored data now; a connected Client with nothing for
   the tab leads to a CDN read; a 5.x site is never offered the 4.x route;
   a weak other-version card is dropped; a file name picks the version and
   adds the line; "no data" shows the card's steps; the ask-anyway reply's
   location sentence is flagged and its record shows the KB outcome; "gone"
   ranks the "does not appear" card first; the two lookup cases pass with
   K28 F1's table.
9. Accessibility: axe passes in light and dark on the header, the case
   menu, the Close case dialog, the folded answer, the ⋯ menu, the version
   question and the verdict; every control works by keyboard.
10. No regressions: every existing unit test and E2E passes; both demo
    evaluations keep Recall@3 and "not covered" precision and recall at
    100%; all `audit:*` scripts, `npm run preflight`, `npm run build` and
    the release dry run are green; no card text, question text or secret in
    any diff, log or summary.

## How to test

```bash
pnpm install --frozen-lockfile && pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace && pnpm build
```

```bash
npm run test:scripts && pnpm --filter @apty/agent-core exec vitest run src/kb && pnpm --filter @apty/browser-runtime exec vitest run src/kb src/apty/diagnosis
```

```bash
pnpm --filter @apty/ui exec vitest run && pnpm --filter @apty/browser-extension exec vitest run
```

```bash
node node_modules/puppeteer/install.mjs && node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/panel-layout.e2e.test.mjs tooling/e2e/chat-scroll.e2e.test.mjs tooling/e2e/kb-matches.e2e.test.mjs tooling/e2e/kb-choices.e2e.test.mjs tooling/e2e/kb-unknown-setting.e2e.test.mjs tooling/e2e/get-evidence.e2e.test.mjs tooling/e2e/cases.e2e.test.mjs tooling/e2e/lookup.e2e.test.mjs
```

```bash
npm run test:e2e && npm run release:dry-run
```

The leak check, with the real packs outside the repository:

```bash
pnpm kb:check-leaks --pack "$(ls -t ~/apty-kb/apty-kb-A4PKH-4.x-*.kbpack.json | head -1)" --pack "$(ls -t ~/apty-kb/apty-kb-*5.x-*.kbpack.json | head -1)"
```

By hand, the 22 Nov session again (Chrome, side panel at its default width,
a 5.x tenant tab, both packs, then an Anthropic key): ask "what does
flow.json mean", "workflow not working", "widget is missing", "element is
not found", "the drop-off metric looks wrong", "where is the Widget
Activation toggle" (then Ask the AI anyway) and "help icon is gone". Open a
case, switch layers, open Close case…, and scroll for a minute. Record a
short screen recording for the PR and compare it with the 22 Nov one. In
GitHub: run KB packs by hand without the switch (it names the missing
inputs), and check that the next scheduled run succeeds quietly.

## Out of scope

- Setting up the pipeline for real: the secrets, the variables,
  `KB_PACKS_ENABLED`, the pack host and where the jobs run are IT's and the
  owner's (`KB_PACK_DELIVERY.md`).
- Rebuilding and redistributing the real packs: the KB owner runs
  `kb:pack` for 4.x and, with P2, for 5.x from A5PKH. P3 makes the old
  packs behave meanwhile.
- KB content: rewriting the 13 skipped 5.x pages (including the
  workflow.json card) and the NOT VERIFIED statements.
- The Apty Client: a bridge that runs on every tenant site is the Client
  team's; B4 only stops the Agent giving up when the Client has nothing.
- New features: no new check packs, no dense vectors, no feedback upload.
