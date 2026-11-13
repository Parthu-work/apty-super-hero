# 4.x element and page-readiness rules (KB-RAG K26 E0)

**Status: partial, not written.** This file is E0 of
[FIXES-K26.md](../tasks/kb-rag/FIXES-K26.md): the findings from reading the
4.x player (apty-assist `player3.0/`) that the 4.x ports of
element-not-found and page-readiness must follow. It needs the code, and the
code was not available when K26 was implemented (13 Nov 2026):
`aptyInc/apty-assist` could not be attached to the session (no access), and
no checkout was next to this repository. Under K26's hard rule ("never
invent an Apty file shape"), nothing below is filled in from memory or by
analogy with 5.x, and E1 to E5 were not started.

## What this repository already knows about 4.x steps

- The 4.x step file fixture
  (`packages/browser-runtime/src/apty/diagnosis/fixtures/content-4x/flow-18515.json`)
  holds a step's `id` and `title` only: no stored element, no selector.
- The 4.x check packs cite apty-assist `player3.0` at
  `bbb4cbc518a9b1c84055d33ba56822aa7d58ca17` (player 4.30.0, K21 F4) for the
  widget, flow, segment and app-data rules (`content-not-visible-4x.ts`,
  `widget-not-visible-4x.ts`). None of those citations covers how a step's
  element is stored or resolved.
- element-not-found stops at the version gate for 4.x
  (`element-not-found.ts`, rule SEL-00, reason `version4x`), and
  page-readiness has no 4.x path.

## What E0 must find, with file and line in player3.0

| Question | Found | Where |
| --- | --- | --- |
| Which content file holds a step's stored element, and which fields | Not yet | — |
| The selector kinds (CSS, XPath, text, custom script, others) | Not yet | — |
| How the player resolves a step's element: order of attempts | Not yet | — |
| Frames and shadow roots | Not yet | — |
| Wait and retry timing | Not yet | — |
| What it does when several elements match | Not yet | — |
| What it treats as a page not ready to select on, against what DOM Health measures | Not yet | — |
| Which content files the Extension-mode player fetches through its background (the K15 evidence path for each) | Not yet | — |

## How to finish

1. Check out apty-assist next to this repository, read-only, at the commit
   the 4.x packs cite (or a newer one, and update every 4.x citation):

   ```bash
   git clone --no-checkout https://github.com/aptyInc/apty-assist ../apty-assist
   ```

   ```bash
   git -C ../apty-assist checkout bbb4cbc518a9b1c84055d33ba56822aa7d58ca17 -- player3.0
   ```

2. Fill the table above, one row per finding, each with `file:line`.
3. Then run E1 to E5 of FIXES-K26.md in order: synthetic 4.x steps in the
   E0 shape (`fixtures/content-4x/`), the adapter to element-probe's target
   type, `element-not-found-4x.ts` (rules E4X-00 onward), page readiness for
   4.x where E0 shows the same risk (R4X-00 onward), the `cards-4x.ts`
   entries (A4PKH cards or drafts under `docs/kb-drafts/4x/`), and the tests,
   with a snapshot of today's 5.x outcomes taken before the change.
