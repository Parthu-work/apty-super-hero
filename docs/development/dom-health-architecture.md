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

## Privacy boundary

Every result leaves through `redactDomHealthOutput`
(`dom-health-redaction.ts`), at the exit of `runDomHealthAudit` and
`runApplicationDomHealthAudit`. That covers the agent tool, the side panel
and the stored conversation. Page titles are replaced. URLs lose
credentials, secret- and tenant-named parameters, and identifier-shaped
path segments. Sensitive-named attribute values are blanked. Other text goes
through `redactSensitiveText`. The application audit itself navigates and
replays with the unredacted result (`collectDomHealthAudit`), which never
leaves the service worker.

## History API evidence

`pushState` and `replaceState` are counted in the page's own world.
`page-hooks.ts` is installed by the MAIN-world console bridge and wraps
`History.prototype` at document_start; it also counts `popstate` and
`hashchange`. The frame responder runs in the isolated world, which cannot
see the page's calls. It receives running totals as DOM events and asks
for them once on install, so calls made while it was still loading are
not lost. `tooling/e2e/dom-health-routing.e2e.test.mjs` fails against the
previous isolated-world patch.

## Route probe (developer tool)

**Settings → Troubleshooting → Developer tools** adds a route probe to the
DOM Health card (`route-probe.ts`, `health-route-probe.ts`). The developer
clicks through the application. After each trusted click, once the page
settles, the probe records for every frame:

- the frame URL;
- `document.title`;
- the owning frame element's `name`, `id`, `title` and `data-osp-id`, mapped
  to the frame with `chrome.runtime.getFrameId`;
- the first API call or frame load after the click (path only, from
  resource timing);
- the first heading and active navigation item, read through shadow roots;
- the `pushState` total.

`analyzeRouteProbe` reports how many clicks changed each signal and hints
URL-first, click-first or undetermined. The probe never clicks. It shows
redacted text, and the saved report keeps page text only as hashes.

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

### Click-based discovery is opt-in via an explicit `discoveryMode`

`runApplicationDomHealthAudit`'s `discoveryMode` option (`"page"` |
`"application-safe"` | `"application-deep"`, default `"application-safe"`)
is the only thing that can turn a detected candidate into an actual click —
it replaces an earlier boolean `allowClickDiscovery` flag with an explicit,
named scope so a caller (including the `run_application_dom_health_audit`
agent tool) states its intent rather than the audit silently defaulting to
the deepest option. `"page"` audits only the seed state — no link
discovery, no candidate discovery, no navigation away from it at all.
`"application-safe"` (the default) discovers same-origin links and
DETECTS but never clicks non-anchor candidates. Only `"application-deep"`
allows an actual click. When clicking is off (`"page"`/`"application-safe"`),
every detected candidate is recorded with `status: "not-discovered"` and a
reason — visible in the inventory, never silently dropped, never
autonomously acted on. When `"application-deep"` is set, a click is followed by a
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

## Same-URL states are a real discovery tree, with backtracking (`state-graph.ts`)

The click-discovery design above was originally a flat FIFO queue: every
safe-navigation candidate found on a state was queued as soon as that
state was audited, then drained strictly first-in-first-out. That broke
for exactly the same-URL, menu-driven shape it exists to explore: clicking
into state B (there is no other way to reach a same-URL state) leaves the
*live* browser tab sitting in B's DOM. A second, later-dequeued click
recorded from state A — e.g. a sibling menu item — would then either match
nothing in B's unrelated markup, or silently match a different element
that happened to share the same recorded path. Sibling branches were lost
or corrupted, not actually explored.

`state-graph.ts`'s `StateGraph` tracks every discovered state as a node
(identified by its `AuditStateFingerprint`, never by URL alone) and every
transition as an edge carrying real evidence: the triggering click or
navigation, the before/after fingerprint, whether the URL stayed the same,
and how many `pushState`/`replaceState`/`popstate`/`hashchange` calls
fired across it. Every non-seed node remembers the edge that first
discovered it, making the graph a spanning tree for restoration purposes
even though later transitions between already-known states are also
recorded as evidence.

Before `application-audit.ts` acts on a queued click candidate, it checks
whether the live tab is already showing the state that candidate was found
on (`graph.getCurrentStateId() === item.sourceStateId`). If not,
`restoreToState` replays the exact path of transitions from the seed state
back to it — a pure-URL path is restored with one direct navigation (cheap
and always available since a literal URL never needs backtracking at all);
a path containing any click short-circuits to a hard reset (re-navigate to
the seed URL, which reliably reinitializes a real SPA) followed by
replaying each recorded click in order, verifying the resulting fingerprint
against what was originally recorded at every hop. A hop that doesn't
reproduce its recorded fingerprint fails the whole restoration immediately
— the branch is recorded `not-discovered` with the reason, never silently
skipped and never treated as if the state had been reached. Every
restoration attempt (success or failure) is returned in
`ApplicationAuditResult.restorations`; the full discovery tree is returned
in `ApplicationAuditResult.stateGraph`.

History-API evidence (`pushState`/`replaceState`/`popstate`/`hashchange`,
patched once per content-script load in `content/index.tsx`) is promoted
from purely diagnostic telemetry into an actual discovery signal: a click
whose structural fingerprint comparison alone reads `"same"` is still
counted as a real transition when a nonzero history-event delta was
observed across it (a client-side route genuinely changed even though this
audit's narrow structural signature didn't capture it) — never used to
affect the DOM Health score itself, only the discovery decision.

## Coverage is "observed", never "total"

`ApplicationCoverage.coverageLabel` is always `"OBSERVED_COVERAGE"` — this
audit has no way to know how many states/pages an application actually
has, so it never claims total application coverage. `discoveryMethod`
records the effective `discoveryMode` for a given run (`"single-page-only"`
/ `"anchor-links"` / `"anchor-links+navigation-controls"`).
`pagesNotDiscovered` counts detected-but-unexplored candidates explicitly,
separate from `pagesFailed`/`pagesSkippedUnsafe`. `framesDiscovered`/
`framesInspected`/`framesInaccessible` roll up frame-level coverage across
every audited state.

### Application-level evidence gating (`INCOMPLETE_EVIDENCE`)

Real per-element evidence on the states that WERE audited (clean selector
resolution, high stability) is never enough on its own to call the
**application** well-evidenced — that was the root cause behind a report
like "92/100" on an application that was never actually comprehensively
explored. `application-scoring.ts`'s `determineApplicationEvidenceState`
downgrades an otherwise-healthy per-element evidence state to
`INCOMPLETE_EVIDENCE` — which, like `NO_EVIDENCE`/`FAILED`/`INACCESSIBLE`,
is never scoreable (`isScoreMeaningful` returns `false` for it) — whenever:

- at least one backtracking restoration failed (whatever state lay beyond
  that failure point was never reached, let alone audited), or
- real navigation candidates were detected but this run never got beyond
  the seed state (`notDiscovered > 0 && audited < 2`), or
- a large, statistically meaningful share (>50% of at least 5 known
  states/candidates) of everything this run knew about was never actually
  explored.

When gated, the result still reports a full risk (`id:
"evidence-incomplete-application-coverage"`) naming exactly which signal
tripped it, but `score`/`grade` are `null`/`"NOT_ASSESSED"` — an honest "we
don't know enough" beats a clean-looking number.

### Scoring weights favor resolution/stability over presentation signals

`dom-health-scoring.ts`'s `WEIGHTS` puts more than half the total weight on
`automaticSelection` (0.30) + `selectorStability` (0.30) combined, with
`ambiguityRisk` (0.12, folding in same-snapshot wrong-target candidates)
above the presentation-layer signals (`hitTestTargetability` 0.06,
`domVolatility` 0.04, `accessibilitySignal` 0.02). This is deliberate: a
page that resolves every selector perfectly against today's DOM but whose
captured paths mostly fail (or land on the wrong element) when replayed
against other real application states must not be diluted back up to
"excellent" just because everything else about it — hit testing, DOM
volatility, accessible names — happens to be clean.

## Cross-STATE selector-stability validation (real DES replay, never a re-query)

`health-collector.ts`'s stability tracking stores, per logical
(fingerprint-correlated) element, the real Apty-style `ElementPath`
captured for it at the previous state (`RegistryEntry.path`) — not a
selector string. On the next state, `health-selector-engine.ts`'s
`verifyStoredElementPath` REPLAYS that exact stored path through the
unmodified, real DES `findElement` recovery pipeline (`checkInitialPath`
then the four real relaxation strategies) against the new live DOM, then
verifies the result's logical fingerprint matches what was originally
captured. This is deliberately never "regenerate a fresh selector at the
new state and compare it to the old one" — two independently-generated
selectors can differ for reasons that have nothing to do with whether the
original element is still findable; replaying the same stored path is the
only way to answer "is Apty's own selection actually reliable across the
states a user really moves through."

The resulting `StabilityVerdict` is intentionally more granular than a
binary stable/broken: `DIRECT_STABLE` (resolved via `checkInitialPath`
alone), `RECOVERED_STABLE` (needed a real attribute-level relaxation
strategy), `POSITIONAL_STABLE` (only the last-resort, most
position-dependent relaxation strategy found it — never treated as
equivalent to an attribute-anchored match), `WRONG_TARGET` (resolved to
some element, but not the right one — always a failure, never folded into
"stable"), `NOT_RESOLVED`, `DETACHED`, `AMBIGUOUS`, `INACCESSIBLE`, plus
the pre-existing `NEW`/`UNKNOWN` for elements with no prior-state evidence
yet.

### Shadow DOM: `ElementRef` (`element-ref.ts`)

An `ElementPath` records no root, and `buildElementPath` stops at a shadow
boundary. A shadow element's path is therefore only valid inside its own
shadow root. The frame responder used to replay every sample against
`document` (defect D-1), which cannot find any of them. In the Infor LN
export, 68 of the 74 interactive elements sit inside shadow roots.

Samples now carry an `ElementRef`:

- `hostChain`: one full `ElementPath` per shadow host, document first, each
  resolved in its parent root through the normal `findElement` recovery;
- `path`: the element itself, inside the innermost root;
- `frameKey`;
- a version marker.

`replayElementRefs` walks the host chain, entering each root through
`shadowRootOf` (closed roots included), and verifies the element in the
innermost root. A chain that breaks reports `HOST_NOT_RESOLVED` with the hop
index and that host's selector. The application report counts these
(`crossStateEvidence.hostChainBroken`) and lists a few examples. A sample in
the pre-`ElementRef` shape (a bare `path`) is migrated to a document-rooted
ref and counted as `legacySamples`.

Each element is also graded across its hosts (`resolveInComposedTree`).
The outcome is the weakest of the element's own hop and each host's. So a
control that is unique only inside a one-element shadow root, behind a host
that can be found only by position, is reported `POSITIONAL_ONLY`, not
`DIRECT_SUCCESS`. Its `bestSelector` is the hops joined with ` >>> `, which
is diagnostic text, not one CSS selector. The cross-snapshot fingerprint
(`computeComposedFingerprint`) includes the hosts too, so identical
controls in sibling shadow roots no longer collide as `AMBIGUOUS`.

## Known limitations (honest, not hidden)

- **Restoration always resets to the seed URL for any click-involving
  path**, even when only the last hop actually needs replaying — correct,
  but not the cheapest possible strategy (a real browser-history `back()`
  is never used, since an enterprise SPA's same-URL clicks are not
  guaranteed to push a history entry at all).
- **A state is deduplicated purely by structural fingerprint equality.**
  Two genuinely different application states that happen to produce an
  identical fingerprint (same title/active-nav-item/heading-sample/
  container-counts) would be treated as the same node — a real, accepted
  tradeoff of the same signature design documented above, not new to the
  state graph.
- **`waitForDomStable` watches the top frame and its shadow trees, and
  child frames only while they are still loading** (e.g. a frameset content
  frame after a menu click), then for at most three quiet windows. A loaded
  embed that never goes quiet (ads, chat widgets) does not delay the audit;
  an SPA re-render inside an already-loaded child frame is not waited on.
  Only shadow roots that exist when the wait starts are observed.
- **Closed Shadow DOM is reached through `chrome.dom.openOrClosedShadowRoot`**
  (Chrome 88+, content scripts only). Outside an extension content script,
  for example in the jsdom unit tests, only open roots are traversed.
- **Frame responders** live in a React-free content script
  (`frame-responder.ts`) in every frame. A frame with no live responder
  (the declared script never ran, or it belongs to an extension instance
  from before a reload) gets the responder injected with
  `chrome.scripting.executeScript` and the message retried once. Frames
  Chrome never lets extensions script (`chrome-error://`, the PDF viewer,
  the Web Store) still report a per-frame failure.
- **No real Infor LN, Athena, or Autodesk validation has been performed** —
  see the delivery report for this phase. The frame-addressed-messaging,
  same-URL-state, and state-graph/backtracking fixes are validated by
  unit/integration-style tests that construct the exact shapes described (a
  menu frame separate from a content frame; a same-URL branching menu tree
  requiring backtracking to avoid losing a sibling state), not by a live
  run against any of these applications.
- **Canonical evidence-model unification across every DOM Health entry
  point (side panel, agent tool, application/page/frame audit), a UI
  redesign of the report, and reformalizing the Apty Studio/Client
  integration adapter were not attempted in this pass** — this pass's
  scope was the confirmed state-discovery/backtracking root cause only; see
  the delivery report's "remaining limitations" for the full list.
- **This later pass (cross-state selector-stability replay, explicit
  `discoveryMode`, application-level `INCOMPLETE_EVIDENCE` gating, and the
  resolution/stability-dominant scoring weights above) still has not been
  validated against any real Infor LN/Athena/Autodesk application** — the
  same honesty caveat above still applies; only the described unit/
  integration-style fixture tests exercise these paths.
- **The full `AptyExtensionAdapter` interface (runtime metadata / imported
  Studio configuration / live selector verification against a real Apty
  Client), a 9-point hit-test breakdown surfaced in the report, and
  frame/shadow-DOM evidence enrichment beyond what's described above were
  not attempted in this pass either** — out of scope; not claimed as done.
