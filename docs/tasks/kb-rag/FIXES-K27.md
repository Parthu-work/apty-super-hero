# KB-RAG K27: fixes from the first real-pack test, pilot readiness and enhancements

17 Nov 2026 · Apty Customer Success

## Status

**DONE, with partial steps.** Every package of Parts F, U, R and E1 to E4 is built and tested. Partial, with what finishes each: the real-pack regression grid and "10 routing left out" (KB owner: `pnpm kb:eval --self-check --pack <rebuilt 4.x pack>` and the grid in "Real-pack regression grid"); Edge runs (`npm run build && npm run test:e2e:edge` on a machine with Edge); SMOKE_TEST rows 18 to 35 by hand in branded Chrome and Edge; the tester's 4.29.13 diff for 4X-BRIDGE.md; macOS zsh; the p95 scroll-handler time. Owner decisions are listed under R1 and R7 below.

## How to run this prompt

This is a complete, self-contained implementation prompt for a coding agent.
Do every work package in the order given, until every acceptance check
passes. Do not stop at a plan and do not skip a package. Where a step cannot
be done in your environment (no real packs, no Chrome policy, no Edge), do
everything else, mark that step partial, and say exactly what is left and
the command that finishes it.

- **Base:** `origin/main` at `d9860bd` (15 Nov 2026) or later. It holds K10
  to K26.
- **Parts, in order:** F (fixes), U (stable scrolling), R (pilot readiness),
  E (enhancements). One branch and one PR per part against `main`
  (`claude/kb-rag-k27-fixes`, `-ui`, `-ready`, `-enhance`); one commit per
  package, each green on its own. Never commit to `main`. Part E is a menu:
  do E1 to E4 in this run, and build E5 to E10 only if the pilot asks for
  them.
- Save this prompt as `docs/tasks/kb-rag/FIXES-K27.md` in the first commit
  and keep its status line current. Re-read it after any context
  compaction; never guess scope.
- **Evidence base:** the first real-pack test, 17 Nov 2026. Packs: Apty 4.x
  (118 cards) and 5.x (112 cards) built with `kb:pack`, signed by key
  `348cdb36b45e1bdf`, imported in Chrome on macOS. Client: a locally patched
  Apty Client 4.29.13 dev install on the Infor LN PRD tab. Provider:
  Anthropic. Real packs and real questions stay outside the repository
  (`~/apty-kb/`).

## What the first real-pack test showed

The KB route works on real cards; the model fallback, the tool budget, case
handling and the chat screen do not yet.

What worked and must not regress: the right first card for the flicker
symptom (1509785934), the flow.json meaning question (1509786022, network
layer first) and "element is not found" (1509720182); both signed packs load
and show key and expiry; Strict redaction is locked while a pack is loaded;
"KB text sent to AI" stayed at 0; the setting-name guard fired; the licence
question was not answered with invented prices; the Client answered
`inspect_extension_network` on the LN tab.

| # | Finding | Evidence | Fixed in |
|---|---------|----------|----------|
| 1 | Anthropic rejects requests: too many strict tools. | "Too many strict tools (22). The maximum … is 20" on file-name questions. `selectRelevantTools` offers 23 tools for any question naming a file and 16 otherwise. About 9,000 tokens per request before any tool result (system prompt 3,402, 22 tools 5,562). | F1 |
| 2 | The model invents Apty settings after the KB says none exists. | An unknown setting gave "No KB card names that setting. Asked the AI model." and then a made-up menu path. | F2 |
| 3 | "Start here" pages with four layers are stored as full cards and shown as answers. | 10 in the 4.x pack; "element is not found" ranks 1509786748 second. The builder tests the routing title only for pages with no layers. | F3 |
| 4 | One case spans several sites. | N3R4 ran on two hosts and versions; 57JK on three. `case-recorder.ts` reuses the open case whatever the host. | F4 |
| 5 | A natural lookup question gets no file tools, so the model says it cannot. | "is workflow X present in segment Y": 16 tools, no `inspect_extension_network`. | F5 |
| 6 | Excerpts often show the support layer. | Layer 4 was the excerpt for 3 of 12 shown cards. | F6 |
| 7 | The decision record and the cards shown disagree, and the version stays unknown. | The record lists 1496351614 (5.x tree) while the screen shows 1509752943; "Apty version: unknown" on a tab whose Client reported 4.x file names. | F7 |
| 8 | A check with no cause is a dead end. | "No cause in the files" with a bare link; "Packs searched: none" hard-coded for check routes; "Confidence: likely" on a no-cause result. | F8 |
| 9 | The planner mislabels the symptom and asks three questions at once. | A flicker symptom produced the "Tooltip not showing" plan, stopped at 2 of 10 steps. | F9 |
| 10 | "Why this answer" cannot be copied when collapsed and is missing from exports. | Pastes show four empty bullets; the export has no decision lines. | F10 |
| 11 | Small gaps. | Timeline has no dates; Options pack rows hide skipped pages; support bundle offered for an empty case; Cases table has no site column. | F11 |
| 12 | Broad symptoms get three file-mirror cards, not a question. | "workflow not working" returned three mirror cards although a routing page exists. | E3 |
| 13 | Endless scrolling in a long chat. | `message-list.tsx` renders every turn inside `use-stick-to-bottom` with `resize="smooth"`; no windowing, no `content-visibility`, no `overflow-anchor`. | U1 |
| 14 | Open items on main. | Two redaction gaps; the K25 audit commit `ebdd69e` never reached GitHub; the KB owner's key is not in `KB_OWNER_PACK_KEYS`. | R1 |
| 15 | Documented commands fail on the tester's machine. | `pnpm -s …` is rejected; `read -p` is bash syntax in a zsh terminal. | R2 |

## Hard rules

1. No KB content in the repository. Tests use synthetic cards with invented
   titles and settings. Real page ids are fine; real titles, symptom lines
   and card text are not, including in comments, fixtures, commit messages
   and the PR body. `npm run audit:kb-pack` stays green.
2. No security regression. K22 holds: the KB egress filter runs first on
   every model request; KB text reaches a model only through an approving
   policy; the case, feedback and send records stay on the device; nothing
   new is sent to a provider.
3. Every answer names its source, and the model never states an Apty fact
   it was not given. A model answer on a turn with no returned card must not
   describe an Apty setting, menu path, price or feature; it says it does
   not know.
4. Deterministic. The same packs and question give the same ranking,
   coverage, status and decision record.
5. Test first. Each change starts with a test that fails on `d9860bd`.
   Anything crossing the Chrome boundary also gets an E2E in `tooling/e2e/`
   using `harness.mjs`. Never skip, weaken or delete a test.
6. No new permission, host or network call. `agent-core` stays
   platform-free and dependency-free. For U1, use CSS (`content-visibility`,
   `overflow-anchor`) and in-house windowing; if a library is unavoidable,
   run `npm run check:dist-licences` and justify it in the PR.
7. New UI strings in `en.json` and `zh.json`; every new surface passes axe
   in light and dark and works by keyboard alone.
8. Real packs stay outside the repo. The regression grid is run by the KB
   owner against real packs; in-repo tests use the synthetic and large
   synthetic packs.
9. Before each commit run `npm run preflight`, `npm run build`,
   `npm run lint:dependencies` (after
   `pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace`),
   `npm run audit:architecture`, `npm run audit:tools`,
   `npm run audit:kb-pack`, `npm run audit:settings-readers`,
   `npm run report:request-size`, and the E2E files you touched. Paste the
   results into the PR body.

## Part F: the fixes

Order: F3, F1, F2, F5, F4, F6, F7, F8, F9, F10, F11.

### F3. "Start here" pages are routing, whatever their layers (finding 3)

Files: `tooling/scripts/kb/build-kb-pack.mjs`, `packages/agent-core/src/kb/search.ts`,
`index-set.ts`, the self-check in `eval-kb.mjs`, tests.

- Classify any page whose title, after the "RAG Card:" prefix, starts with
  "start here" (case-insensitive) as routing, before looking at layers. A
  routing card keeps its title and symptom, has no chunks, and is never
  returned as a hit.
- The builder summary and the self-check count them.
- Tests (synthetic): a four-layer "Start here" page becomes routing; it never
  appears in search; the self-check excludes it; a normal card whose title
  merely contains "start here" later stays full.

### F1. A tool budget every provider accepts (finding 1)

Files: `packages/agent-core/src/tools/provider-schema.ts`,
`apps/browser-extension/src/services/ai-provider.ts`,
`packages/browser-runtime/src/tools/tool-relevance.ts` and `index.ts`,
`tooling/e2e/request-budgets.json`, `docs/development/REQUEST_ANATOMY.md`, tests.

- A hard cap: `maxStrictTools` in the provider rules (Anthropic: 20). Over
  the cap, the 20 most relevant are strict and the rest are sent without
  strict; each tool still validates its input with its own schema.
- Fewer tools per question: route-based sets. A file-meaning or KB question
  offers `search_kb` and the Client file-read tools only (8 or fewer); a
  symptom question offers the investigation basics (12 or fewer); the full
  set only once an investigation has started. Record tool count and tokens
  before and after in the request-size report.
- Conformance test: for every probe question, on every provider, selected
  tools stay within the provider's rules and the route's target.
- E2E: a fake Anthropic endpoint returns the real error for more than 20
  strict tools; both file-name questions get an answer.

### F2. The model never invents Apty settings (findings 2 and 11)

- `unknown_setting` is answered by the KB, not the model: "The KB has no
  setting called "X".", the closest cards labelled "closest cards, they may
  not mention it", and "Check Studio or Admin, or ask the KB owner." No
  model request. An **Ask the AI anyway** button sends the question with the
  fixed instruction below.
- Every model turn without a returned card carries: "The Apty KB has no card
  for this. Do not describe Apty settings, menus, paths, prices or features.
  Say you do not know, and suggest the KB owner or Studio and Admin." Also
  for `not_covered`, `no_pack`, `pack_unusable` and `error` outcomes on
  configuration, how-to or product questions.
- Label: a model answer on a turn with no returned card shows "Not from the
  KB or a check".
- Ground: run the K18 grounding check on those turns; a menu-path-like or
  Title Case setting phrase is flagged "Not found in the KB".

### F5. Lookup questions get the tools (finding 5)

- Offer the Client file-read tools when a message pairs workflow, flow,
  segment, rule or launcher wording with present, exists, contains, belongs,
  assigned, "in the", or names a content file in either version's spelling.
- Prompt: "You can read the Apty Client's content files with
  inspect_extension_network. Never say you cannot look up workflows,
  segments or rules."

### F4. A case belongs to one site (finding 4)

- Bind to the host: a turn on a different host leaves the old case
  untouched; it opens a new case if it starts one, else attaches to nothing.
- Show it: the investigation bar shows case id and host (with an alias
  option), cards from another host collapse with "From <host>", the Cases
  table gains a Site column, and a New case button.
- Bundles are single-site.

### F6. Show the right layer (finding 6)

- For a symptom question with no layer hint, the excerpt is the best of
  layers 1 to 3. Layer 4 only on support or escalation wording, or when
  layers 1 to 3 all score zero. A file question still shows layer 3 first.
- A layer switcher (1 to 4) per card.

### F7. The record shows what was shown; the version is resolved early (finding 7)

- The decision record's card ids are exactly the ids rendered.
- With the tab version unknown, search both packs and show both labelled.
- Resolve the version at conversation start and on every tab or host change
  from the Client's observed resources (K13 markers) and show a version chip.

### F8. A check with no cause still helps (finding 8)

- A no-cause verdict shows the card's title and its layer 1 and 2 excerpts.
- "Packs searched" for a check route lists loaded packs, or says "KB not
  searched: a check answered (…)".
- Replace "Confidence: likely" on a no-cause result with "The rules read
  these files correctly; no cause found in them."

### F9. The plan matches the symptom and asks one question (finding 9)

- A "flicker or jump" plan category; a turn ends with at most one question;
  a plan that stops early says why.

### F10. "Why this answer" can always be copied and exported (finding 10)

- A Copy button copies the lines even when collapsed; an error turn shows its
  record; every chat export includes each turn's lines.

### F11. Small gaps (finding 11)

- Timeline shows date and time and sorts by time; Options pack rows show
  routing, stub, not-in-version and skipped counts (optional
  `source.skipped`); Prepare support bundle disabled with "Nothing to bundle
  yet: run a check or open a KB card" for an empty case.

## Part U: stable scrolling in long chats

### U1. The chat scrolls the same way at 5 turns and at 500 (finding 13)

Reproduce first with a 300-turn E2E fixture. Expected changes:
`resize="instant"` for content growth; no programmatic scroll once the user
has moved up more than 24 px; `content-visibility: auto` on turns older than
the newest 30; `overflow-anchor: auto`; heavy parts render only when
expanded; trees capped at 200 nodes with Show more; above 100 turns render
the newest 60 and Show earlier messages. Acceptance: scrollTop constant
(within 1 px) for 5 s after the last input at 320, 400 and 480 px, light and
dark; no ResizeObserver loop error; DOM nodes under 15,000; p95 scroll
handler under 8 ms.

### U2. Keyboard and screen-reader pass on the new controls

## Part R: what makes it ready for a pilot

- **R1.** Close the open items on main: redaction gaps (network-capture body
  preview; relative and non-http URLs in free text), the lost K25 audit
  (`ebdd69e`), the KB owner's key (document `trustedPackKeys` as the pilot
  route until the owner confirms the production key).
- **R2.** Commands that work on every SE's machine: no `pnpm -s`, a pnpm
  10.33.x line with corepack steps, zsh forms of `read`.
- **R3.** A first-run checklist in the side panel.
- **R4.** Pilot measures kept on the device (`firstVerdictAt`, counts, CSV).
- **R5.** Performance budgets.
- **R6.** Browsers (Edge) and accessibility runs.
- **R7.** Release hygiene.
- **R8.** `docs/se-guide.md` and `docs/support-runbook.md`.
- **R9.** `docs/integrations/apty/4X-BRIDGE.md`.

## Part E: how the working mode can be enhanced

E1 to E4 in this run: one answer card with source chips; a layered card the
SE can walk through; ask, do not guess, on a broad symptom (routing
`options`); answer lookup questions from the files without a model. E5 to
E10 only if the pilot asks for them.

## Acceptance checks

1. Every finding has a test that failed on `d9860bd` and passes now.
2. Anthropic works (F1).
3. No invented settings (F2).
4. Routing (F3).
5. One case, one site (F4).
6. Lookups (F5, E4).
7. Layers (F6).
8. Record equals shown, version resolved (F7).
9. F8, F9, F10, F11 pass their package tests.
10. Stable scrolling (U1).
11. Readiness (R1 to R9).
12. Part E: E1 to E4.
13. Real-card regression (KB owner) — partial without the packs.
14. No regressions (on `d9860bd`: agent-core 655, browser-runtime 2,005, ui
    483, browser-extension 679, MCP bridge 72, KB tooling 84).
15. No card text anywhere in the diff.

## Real-pack regression grid (KB owner)

Run with `pnpm kb:eval` and in the extension against the real packs in
`~/apty-kb/`; record ids only.

```bash
pnpm kb:eval --self-check --pack "$(ls -t ~/apty-kb/apty-kb-A4PKH-4.x-*.kbpack.json | head -1)"
```

```bash
pnpm kb:eval --pack "$(ls -t ~/apty-kb/apty-kb-A4PKH-4.x-*.kbpack.json | head -1)" --questions ~/apty-kb/questions-4x.json --by-category
```

## Progress

| Package | State | Notes |
|---------|-------|-------|
| F3 | done | Builder classifies "Start here" titles as routing before layers. KB owner: rebuild the 4.x pack and run the self-check; expect "10 routing left out". |
| F1 | done | Route-based tool sets (file 8, symptom 12, investigation full) and a 20-strict cap for Anthropic. `tool-schemas.test.ts`, `tool-budget.e2e.test.mjs`. |
| F2 | done | `unknown_setting` answered by the KB with closest cards and no model call; a fixed instruction on no-card model turns; "Not from the KB or a check" label; menu paths flagged. `kb-unknown-setting.e2e.test.mjs`. |
| F5 | done | Content lookups ("is workflow X in segment Y", content file names in either spelling) get the Client file-read tools within the file budget; the prompt says the model can read them. |
| F4 | done | Cases bind to the tab's host (`otherSite`, `siteKeyOf`); a turn on another host opens its own case or none. Case strip shows the site (alias option) and New case; Cases table has a Site column; cards from another site fold under "From <site>"; bundles leave out another site's check. `case-host.e2e.test.mjs`. |
| F6 | done | Per card, the shown chunk is the best of layers 1 to 3 unless the question asks about support or no other layer matched; a file question keeps layer 3 first. Each KB card has a layer switcher (L1 to L4). KB owner: confirm no layer 4 excerpt on grid rows 1 to 5. |
| F7 | done | The record lists exactly the shown card ids (`renderedPageIds`). Each site's version is resolved from the Client's observed files (K13 markers) before the KB search, once per site, and shown as a chip ("4.x, from the Client's files"); the SE's choice overrides it. Unknown keeps searching both packs, labelled (K25 A3). |
| F8 | done | A no-cause verdict shows the card title and its layers 1 and 2 from the loaded pack; the check record says "KB not searched: a check answered (4.x and 5.x loaded)"; "Confidence: likely" becomes "The rules read these files correctly; no cause found in them." |
| F9 | done | A "flicker or jump" plan (selection method, position over time, animations, frames) matched before the tooltip plan; the prompt asks for at most one question per turn and says why a plan stopped. |
| F10 | done | A Copy button beside "Why this answer" copies its lines while collapsed; an error turn keeps its record; a copied or downloaded reply carries the lines. |
| F11 | done | Timeline shows date and time, sorted by time; Options pack rows show routing and skipped counts (builder writes optional `source.skipped`); Prepare support bundle is disabled for an empty case. |
| U1 | done | Reproduced with `chat-scroll.e2e.test.mjs` (300 turns): 15,462 DOM nodes, and the page shrank 136 px per code block for seconds after load, because Streamdown puts `content-visibility: auto; contain-intrinsic-size: auto 200px` on every code block. Fixed by overriding that, `resize="instant"`, `overflow-anchor: auto`, and a window (newest 60 of a chat over 100 turns, Show earlier messages keeps position). Turn-level `content-visibility` was tried and removed: its estimate moved the scroller at 480 px. Trees already open only their root and page 100 children (test added). Passes at 320, 400 and 480 px, light and dark. Partial: by-hand Chrome and Edge run; p95 scroll-handler time not measured. |
| U2 | done | Layer switcher, Copy on "Why this answer", Show earlier messages, Ask the AI anyway, New case and the site label pass axe in light and dark (`chat-scroll`, `kb-unknown-setting`, `case-host` E2E). |
| R1 | done | Body preview redacted in the mode it is read in (Strict keeps JSON shape only); relative and non-http URLs in free text masked like absolute ones; both leave Known limitations. `ebdd69e` is not in the repository, so K25 was audited again: [K25-AUDIT.md](K25-AUDIT.md); its two gaps (missing tests G1, G2) are fixed. `allowDemoPacks` is a proposal, not implemented. The KB owner's key: `trustedPackKeys` documented as the pilot route; `KB_OWNER_PACK_KEYS` stays empty until the owner confirms the production key. |
| R2 | done | No `pnpm -s`; pnpm 10.33.x check with corepack; bash and zsh forms of the token prompt. Checked in Linux bash and zsh 5; macOS zsh by hand is left to an SE. |
| R3 | done | "Before you start" checklist in the panel (packs per version with expiry, AI key or no-key mode, Apty Client, policy), buttons to the fixing Options section; `first-run.e2e.test.mjs` from a fresh profile. |
| R4 | done | `firstVerdictAt` and its route on the case; Feedback shows counts by version and outcome and the median time to first verdict; CSV export with numbers only. |
| R5 | done | `perf-budgets.e2e.test.mjs` (large synthetic pack, both versions): first KB answer 524 ms from panel open, warm p95 163 ms, index build 148 ms, search p95 3.5 ms, heap 41 MB with a 300-turn chat. CI runs it. |
| R6 | partial | `E2E_BROWSER=msedge` and `npm run test:e2e:edge`; axe in both themes on every surface added since K22. Edge is not installed here: run `npm run test:e2e:edge` on a machine with Edge. |
| R7 | partial | Explicit-any baseline 579 to 576; version 0.2.0; CHANGELOG; PRIVACY.md and the store listing cover packs, signing, cases, bundles and pilot measures; SMOKE_TEST rows 30 to 35 added. Left for people: rows 18 to 35 by hand in branded Chrome and Edge; owner items D6 (icons), W8 (Web Store ID), GitHub secret scanning and push protection, the customer application domains to narrow `<all_urls>`. |
| R8 | done | [`docs/se-guide.md`](../../se-guide.md) and [`docs/support-runbook.md`](../../support-runbook.md). |
| R9 | partial | [`4X-BRIDGE.md`](../../integrations/apty/4X-BRIDGE.md) gains the hand patch and the five review points; the tester's diff is not attached. |
| E1 | done | Source chips on every reply (Check, KB card, Model; version and how decided; pack expiry); a turn action row through a new `turnActions` slot that offers only what can run and is not already on the turn's card (Prepare support bundle today; Run the check waits for E5). |
| E2 | done | Named layers, per-layer NOT VERIFIED, and Next from settings to contact support on every KB card. |
| E3 | done | The builder stores a routing page's links as `options`; a broad question a routing card covers shows up to four choices; choosing one shows that card; a specific question never does. `kb-choices.e2e.test.mjs`. |
| E4 | done | "Is workflow X in segment Y", "show workflow X", "which environment is this tab", "which workflows are hidden from the widget" answered from flow.json/segments.json (4.x) or workflow.json/segment.json/app-urls.json (5.x) in a table, names matched ignoring case and punctuation, one question on two matches, no guess on none, zero model requests. `lookup.e2e.test.mjs` passes for both versions. |
| E5 to E10 | not started | Built only if the pilot's measures (R4) call for them. |
