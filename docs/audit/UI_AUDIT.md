# UI Audit (v5 mega-prompt session)

This is a **partial** audit, not the full WP21 matrix (every screen × every
state × 3-7 viewports × 2 themes with a CI-gated screenshot baseline). It
covers what this session actually built and verified: the WP16 styling fix,
and what the new screenshot harness (`tooling/e2e/screenshot-harness.mjs`)
could reach without a real installed extension or a configured LLM
provider. Read this alongside the Phase 0 table in
`docs/development/PROJECT_PROGRESS.md`, which says what WP16-WP21 did and
did not cover.

## Method and its limits

`tooling/e2e/screenshot-harness.mjs` launches the pre-installed Chromium
(via `playwright-core`), serves the built `apps/browser-extension/dist`
over a local static HTTP server, injects a mocked `window.chrome` (storage
falls back to empty results, `tabs`/`bookmarks`/`management` etc. return
empty arrays, listener registration methods are no-ops), and screenshots
each page. This means:

- It renders the **same HTML/JS/CSS** a real extension load would, so it's
  valid evidence for layout, spacing, fonts, and the tab-highlight/CSS
  regression WP16 exists to catch.
- It does **not** load a real installed MV3 extension: no
  `chrome-extension://` origin, no side-panel host chrome, no service
  worker, no real Chrome storage, no configured LLM provider. So it can
  only show the **empty/not-configured** state of the side panel (Welcome
  screen with suggestion cards, DOM Health card, input area) and every tab
  of Options with **no saved settings** — not a populated conversation, not
  History with entries, not Skills with content, not a live Apty Client
  connection, not an in-progress/streaming/error chat state.
- Real extension-boundary behavior (cross-extension messaging,
  `chrome.management`, a real installed Client, `chrome.runtime.reload()`
  keeping the connection) still needs the real-Chrome e2e harness WP8
  describes, which is **not implemented** — see the Phase 0 table.

## What was captured this session

14 screenshots: side panel at 320/360/420px, options page at
360/768/1280/1600px, each in light and dark. Full machine-readable report
at `tooling/e2e/screenshots/report.json` (gitignored — regenerate with
`pnpm --filter @apty/browser-extension build && node
tooling/e2e/screenshot-harness.mjs`).

| Screen | Viewports | Console errors/warnings | Horizontal scroll |
|---|---|---|---|
| Side panel (empty/Welcome) | 320, 360, 420 px × light/dark | 0 on 5 of 6; 1 informational 404 on the very first navigation only (see below) | None |
| Options — General tab | 360, 768, 1280, 1600 px × light/dark | 0 | None |
| Options — AI Configuration tab | (checked manually at 1280px light, not part of the automated 14) | 0 | None |

**The one flagged issue**: a single `Failed to load resource: 404` on
`sidepanel light 320px` only — the very first page the harness navigates
to in a fresh browser context. It reproduced without a paired
`requestfailed`/`http 4xx` entry from Playwright's own network listeners,
which is the signature of a browser-internal probe (most likely a
`favicon.ico` auto-request) rather than anything the app itself requested;
it did not recur on any of the other 13 captures. Treated as a harness
artifact, not a product bug, but not chased further — flagging here rather
than silently dropping it, per the "never fabricate" rule.

## Before/after: the WP16 root cause

Measured directly (not estimated): the built stylesheet was **37 KB**
before the `@source` fix and **~93 KB** after, and the
`data-[state=active]:bg-background` (Radix Tabs' active-tab rule) went
from absent to present. This is the single biggest visual fix in this
round — every `packages/ui/src` component (Settings, chat components, the
Tabs primitive) went from ~2% of its utility classes being real CSS to
100% (verified by `tooling/scripts/check-tailwind-sources.mjs`, which
requires ≥99% coverage and now reports 100.0% of 377 scanned tokens).

Screenshots (sent alongside this delivery):
- `options-light-1280.png` — General tab, fully styled: card borders,
  spacing, the Language/Theme selection grids, the (new) truthful Privacy
  statement.
- `options-ai-tab-light-1280.png` — AI Configuration tab with the BYOK
  gate toggle removed: the model list and configuration form are visible
  immediately, no toggle to find first. The active tab ("AI
  Configuration") is visibly highlighted against the three inactive tabs —
  this is the exact class family (`data-[state=active]:*`) that was
  missing before the WP16 fix.
- `sidepanel-dark-360.png` — dark mode, DOM Health card's two-row header
  (title never squeezed, actions wrap instead of overlapping — the prior
  round's WP13 fix, now visually confirmed under a *working* stylesheet
  for the first time), Back button correctly absent (no conversation yet).

## Findings from this session's work, beyond the screenshot harness

1. **Font 404s the build itself didn't catch.** The first attempt at
   bundling Inter (`@import "@fontsource/inter/400.css"` inside
   `tailwind.css`) produced valid-looking CSS with correct `@font-face`
   rules, but the referenced `.woff2` files were never copied into `dist/`
   — Tailwind's own `@import` bundling inlines third-party CSS without
   rewriting its relative `url()` paths to be resolvable from the new
   output location, so Vite's asset pipeline couldn't find them. The
   *build* succeeded either way (no error), and a `grep` for `https://`
   would have missed it too (these are local 404s, not remote calls). Only
   the screenshot harness's network-error logging caught it. Fixed by
   copying the specific woff2 files into `apps/browser-extension/assets/
   fonts/` and writing plain `@font-face` rules referencing them directly,
   which Vite resolves and hashes normally. **Lesson for future sessions**:
   a CSS-only check ("does the stylesheet mention the font?") is not
   sufficient; a running-browser check is needed, which is exactly why
   WP16 asks for the harness in the first place.
2. **`useAgent`'s catch-all logged the single most common screen
   (not-configured) as `console.error`.** Every fresh install hits this on
   the very first render, so a WP21-style "zero console errors/warnings"
   CI gate would fail on the default state of the product, not on an edge
   case. Narrowed to only log genuinely unexpected model-factory failures.
3. **`mode-indicator.tsx`'s animations were pure documentation.** The
   `animate-mode-pulse`/`animate-transition-enter-*` classes it applies
   had their `@keyframes`/class definitions written only as a code comment
   ("this should be added to your global stylesheet"), never actually
   added anywhere. Whether this component is even mounted anywhere in the
   shipped app is separately unclear — a grep found it exported from the
   package's public API but not imported by `apps/browser-extension`.
   Added the real CSS since it was cheap and correct either way, but this
   is a candidate for removal if a future audit confirms it's dead code.
4. **`not-prose` is currently a no-op.** Used defensively in four
   `ai-elements` components (`reasoning.tsx`, `tool.tsx`,
   `chain-of-thought.tsx`, `sources.tsx`) to cancel inherited typography-
   plugin styling, but `@tailwindcss/typography` isn't installed and bare
   `prose` is never applied anywhere in this codebase or by Streamdown
   (checked its bundled source directly) — so today, neither class does
   anything. Left as-is (allow-listed in the CSS coverage guard, with a
   comment) rather than pulling in a new plugin dependency to make a
   currently-inert defensive class start doing something nobody asked for;
   flagging it here so a future session with more context on whether this
   defensive styling is actually needed can decide.
5. **A first-run edge case in Settings' provider seeding.** `SettingsPage`
   only seeds the three built-in provider entries (OpenAI/Anthropic/
   Google) into the model list when `storageAdapter.load` returns a
   non-null settings object — i.e. when *some* settings object was already
   written, even an empty one. On a genuinely fresh install with no
   settings key at all (which is what the screenshot harness's mocked
   storage simulates), the AI Configuration tab shows "No providers found"
   with zero built-in entries to select from, rather than three disabled
   ones ready to enable. Visible in the AI-tab screenshot above. Not fixed
   in this session — flagging it as a real, previously-undocumented
   first-run rough edge (whether this exact path is reachable in a real
   browser depends on whether `chrome.storage.local` ever returns a truly
   absent key vs. an empty object on first extension install, which this
   session could not verify without a real Chrome extension load).

## What this audit does not cover (see Phase 0 table for the full list)

No coverage of: History (empty or populated), Skills (any state), the Apty
Integration tab's peer-connection states, an in-progress/streaming/error
chat turn, dialogs, keyboard-only walkthroughs, colour-contrast checks,
axe accessibility scans, or any state that requires a configured LLM
provider or a connected Apty Client. No CI quality gates (screenshot
regression baselines, axe, console-error-fails-the-test, keyboard walk)
were wired up — the harness exists and works, but nothing calls it from CI
yet. This is explicitly out of scope for what this session attempted; see
`docs/development/PROJECT_PROGRESS.md`'s Phase 0 table for what remains.
