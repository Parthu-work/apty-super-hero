# Apty DOM Health — frame, state, discovery, and evidence model

This documents the architecture behind `packages/dom-snapshot`'s
`health-*` modules and `packages/browser-runtime/src/apty`'s DOM Health
orchestration, after the frame-aware/evidence-honest rework. It exists so
a future change doesn't have to re-derive these decisions from the code.

## Why this rework happened

A forensic audit found that the previous implementation worked on
single-document, `<a href>`-navigated sites (e.g. a modern marketing/product
site) but produced misleading or degenerate results on enterprise
applications shaped like Infor LN: a menu frame separate from the content
frame, navigation that swaps content in place without changing the URL, and
(worst case) a scoring bug that reported a *healthy* score for a page the
audit had actually failed to see. Four root causes, all fixed here:

- **RC-1 — frame-targeting race.** Every DOM Health message was sent via
  `chrome.tabs.sendMessage(tabId, message)` with no `frameId`, while the
  content script is registered `all_frames: true`. On a multi-frame page,
  every frame's content script received and answered the same message, and
  the caller got back whichever response arrived — not necessarily the
  frame with the real UI.
- **RC-2 — legacy `<frame>`/`<frameset>` blindness.** The collector only
  ever recursed into `<iframe>`, and did so by reaching into
  `iframe.contentDocument` from the parent's own script — blocked by the
  browser's same-origin policy for cross-origin frames, and simply wrong
  for `<frame>` either way.
- **RC-3 — zero evidence scored as healthy.** When zero interactive
  elements were found, every metric's zero-denominator default (100)
  combined into a ~90+ composite score, with only a `LOW` confidence label
  as any hint something was wrong.
- **RC-4/RC-5 — discovery and navigation assumed URL-driven, anchor-only
  routing.** Page discovery only followed literal `<a href>` elements, and
  the application audit's only navigation model was
  `chrome.tabs.update` + `tabs.onUpdated("complete")`. A menu-driven
  application that changes state without a URL change was invisible to
  both.

## Frame model

`packages/browser-runtime/src/apty/frame-tree.ts` enumerates the tab's real
frame tree via `chrome.webNavigation.getAllFrames` — the browser's own
authoritative record of every frame, whether it came from an `<iframe>` or
a legacy `<frame>` (both are separate browsing contexts to the browser; the
DOM tag that hosts them doesn't matter at this layer at all). Every frame
gets an `AuditFrame`: `frameId`, `parentFrameId`, `url`, `origin`, `depth`,
whether the browser itself reported a navigation error, and whether it's a
bare `about:blank` placeholder.

Every message this feature sends is addressed to one explicit `frameId` via
`sendFrameMessage` — never a broadcast. This is a deliberate choice over
reusing the CDP/`chrome.debugger` frame-tree infrastructure that
`automation/iframe-manager.ts` uses elsewhere in this codebase: attaching
the debugger shows a "this page is being debugged" banner and carries a
heavier lifecycle, which would be an unrequested UX change for a feature
meant to run silently from the side panel. `chrome.webNavigation` needs no
attach step and is sufficient because this design never needs to map a
specific `<iframe>`/`<frame>` DOM element back to its `frameId` — each frame
audits only its own document, addressed directly.

The content script itself cannot determine its own `frameId`/`parentFrameId`
/`depth` (`chrome.webNavigation` isn't available inside a content script's
isolated world). The orchestrator, which already knows all of it from
`getFrameTree`, hands it down in the request payload instead of asking the
content script to guess.

## Capture and aggregation

`frame-audit.ts`'s `captureApplicationState` messages every reachable frame
in parallel (`collect-dom-health-frame-bundle`) and returns one
`FrameCaptureResult` per frame — `captured`, `failed`,
`skipped-about-blank`, or `skipped-navigation-error`, never silently
dropped. `aggregateFrameSnapshots` sums every captured frame's counts into
one `DomHealthSnapshot`-shaped result for the existing scoring pipeline,
tagging each element report with the frame it came from.

Because every round explicitly addresses `frame.frameId`, and each frame
runs its own content-script JS realm (so `health-collector.ts`'s
cross-snapshot registry is already scoped per frame), a frame's round-1
snapshot is only ever compared against ITS OWN round-2 snapshot — never a
different frame's. This structurally rules out cross-frame correlation
contamination without needing frame identity baked into the fingerprint
comparison itself.

## Evidence state (never confusing "no data" with "good data")

`dom-health-scoring.ts`'s `EvidenceState` is orthogonal to the score:

| State | Meaning | Score |
|---|---|---|
| `HEALTHY_EVIDENCE` | Real elements analyzed, every frame answered | real number |
| `PARTIAL_EVIDENCE` | Real elements analyzed, but a frame could not be inspected | real number, with a risk noting the gap |
| `NO_EVIDENCE` | Every frame answered, genuinely zero interactive elements | `null` |
| `INACCESSIBLE` | Zero elements found, AND coverage is known incomplete | `null` |
| `FAILED` | Not even one frame responded | `null` |
| `NOT_ASSESSED` | The audit never attempted collection (e.g. unsupported URL) | `null` |

`score: number | null` and `grade` includes `NOT_ASSESSED` specifically so a
consumer (the UI, a tool caller) cannot accidentally treat "we don't know"
as a passing grade. The gate lives in `determineEvidenceState` +
`isScoreMeaningful`, applied identically at the single-page level
(`dom-health-scoring.ts`) and the application level
(`application-scoring.ts`).

## State model (same-URL transitions)

A "state" is not defined by URL alone. `state-fingerprint.ts` combines every
frame's `FrameStateSignature` (from `@apty/dom-snapshot`'s
`health-state-signature.ts` — URL, title, a bounded heading sample, the
active/selected navigation item, and coarse semantic-container counts) into
one whole-tab fingerprint. `compareStateFingerprints` reports `same`,
`different`, or `uncertain` (when a frame couldn't be inspected at one of
the two points compared) and — critically — WHY, so a state-transition
decision is itself evidence, not a black box.

This signature deliberately ignores live-updating content (a clock, a
counter, a toast) by only sampling headings/`role=heading`, the
`aria-current`/`aria-selected`/`.active`-class item inside a nav-like
container, and structural container tag/role counts — so a real menu click
that changes which screen is showing is detected, while a background
mutation is not mistaken for a new state.

## Discovery (anchor-only was the old limit)

`health-links.ts`'s `collectDiscoverableLinks`/`isSafeToDiscover` (unchanged)
still discover literal `<a href>` targets. Alongside them,
`collectSafeNavigationCandidates`/`isSafeNavigationCandidate` do read-only
detection of non-anchor navigation controls — menu items, tabs, tree nodes —
but ONLY inside a narrow container allowlist (`nav`,
`[role=navigation|tablist|menu|menubar|tree]`), never inside a `<form>`,
never a submit-like control. **Finding** a candidate never clicks it.

Both discovery functions now run across every frame in the tab
(`page-navigation.ts`'s `collectPageLinks`/`collectSafeNavigationCandidates`),
tagged with the frame they came from — the fix that lets a menu frame
separate from the content frame actually get discovered.

### Click-based discovery is opt-in, off by default

`runApplicationDomHealthAudit`'s `allowClickDiscovery` option (default
`false`) is the only thing that can turn a detected candidate into an
actual click. When it's off (the default for every caller today), every
detected candidate is recorded with `status: "not-discovered"` and a
reason — visible in the inventory, never silently dropped, never
autonomously acted on. When enabled, a click is followed by a
before/after state-fingerprint comparison: `same` → `not-discovered`
("this control didn't produce a new state"), `uncertain` →
`not-discovered` with that reason, `different` → audited as a real new
state (its own URL is reused since the URL didn't change; the fingerprint
comparison's reasons become the state's `transitionReason`). A `domPath`
(an nth-of-type ancestor chain, directly usable as a CSS selector) is
re-verified as still safe by the content script immediately before
clicking — defense in depth, never trusting the earlier read-only pass
alone.

This is a deliberately conservative design given the risk of executing
real clicks against a live enterprise application. It is NOT a general
click-discovery engine; it will not explore an application whose
navigation controls fall outside the container allowlist above.

## Coverage is "observed", never "total"

`ApplicationCoverage.coverageLabel` is always `"OBSERVED_COVERAGE"` — this
audit has no way to know how many states/pages an application actually
has, so it never claims total application coverage. `discoveryMethod`
records whether click-discovery was enabled for a given run.
`pagesNotDiscovered` counts detected-but-unexplored candidates explicitly,
separate from `pagesFailed`/`pagesSkippedUnsafe`. `framesDiscovered`/
`framesInspected`/`framesInaccessible` roll up frame-level coverage across
every audited state.

## Known limitations (honest, not hidden)

- **No backtracking after a click-discovered state.** Click-discovery
  follows one path forward; it does not attempt to return to a sibling
  menu item after auditing a state reached by a click. Exploring a whole
  menu tree this way would need an explicit "go back" strategy, which is
  not implemented.
- **`waitForDomStable` only watches the top frame.** A debounced re-render
  inside a non-top content frame is not directly waited on by this signal;
  each frame's own snapshot collection still measures real, live evidence
  regardless, but the "is the page done mutating" heuristic is top-frame
  only.
- **Closed Shadow DOM remains genuinely invisible** — a real browser
  security boundary, not a gap in this design.
- **No real Infor LN or Autodesk validation has been performed** — see the
  delivery report for this phase. The frame-addressed-messaging and
  same-URL-state fixes are validated by unit/integration-style tests that
  construct the exact shapes described (a menu frame separate from a
  content frame; a same-URL click that changes the active nav item), not
  by a live run against either application.
