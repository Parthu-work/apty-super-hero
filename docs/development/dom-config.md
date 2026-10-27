# DOM Config: DOM analysis to Apty DOM settings

DOM Config turns several captures of each page of an application into the
values an SE enters in Apty's DOM Settings screen: ignore conditions,
attribute priority, ignore DOM events, Shadow DOM support, DOM change
debounce and max z-index. It replaces running the DOM analysis console
script by hand, diffing its output in a diff checker and deciding by eye
what to ignore.

It is delivered in steps:

| Step | What | Status |
|---|---|---|
| R1 | Pure engine: validate, diff, classify, generate rules, derive settings, warnings, Markdown; importer for the console script's JSON | Done |
| R2 | In-page collector and behavior probe | Done (see [Collector and behavior probe](#collector-and-behavior-probe-r2)) |
| R3 | Automatic crawl with several runs per state | Done (see [Automatic crawl](#automatic-crawl-r3)) |
| R4a | Side panel card: start options, live progress, Stop, report (Ignore conditions, Settings), copy and export | Done; a page since the UI redesign (see [Side panel page](#side-panel-page-r4a)) |
| R4b | Manual capture, import, page detail, Iframes, Coverage and Warnings tabs | Done (see [Manual capture, import and the held capture](#manual-capture-import-and-the-held-capture-r4b)) |

## Where the code is

`packages/browser-runtime/src/apty/dom-config/`, pure functions with no
`chrome.*`, no DOM and no clock:

| Module | Does |
|---|---|
| `types.ts` | Profile (schema 1 and 2), run, page, rule, setting and report shapes |
| `import-profile.ts` | `parseDomProfile`, `buildPageCapture`: validation of pasted or loaded JSON |
| `flatten.ts` | One run as flat maps of tags, values and class tokens, within the size caps |
| `noise.ts` | What is Apty's, an extension's or an overlay vendor's, using `DEFAULT_IGNORED_ROOTS` |
| `diff-runs.ts` | Runs of a page compared; page status |
| `classify.ts` | One bucket per value |
| `regex.ts`, `rule-match.ts` | Pattern generalization, and how the engine evaluates its own rules |
| `generate-rules.ts` | Rules, rejected rules, manual review, items Apty's defaults cover |
| `derive-settings.ts` | Attribute priority, Shadow DOM, max z-index, debounce, ignore events |
| `report-sections.ts`, `warnings.ts` | Iframes, coverage, weak selectors, noise, warnings, assumptions |
| `build-report.ts` | `buildDomConfigReport`: the whole pipeline |
| `render-markdown.ts` | `renderDomConfigMarkdown` |

## Input

A **profile** is what the console script prints (schema 1): `tags`,
`attributes` (name, then value, then count), `maxZIndex`, `shadowRoots`
keyed by host tag, and `iframes` keyed by the frame's location or, for a
frame it cannot read, `Cross Origin N (src: …)`. Schema 2, written by the
collector in R2, adds `zIndexSources`, `frames`, `shadow`, `probe`, `meta`
and optional `elementFingerprints`.

A **run** is one profile with its label (`initial`, `after-reload`,
`repeat`), capture date (copied from the input, never read from a clock),
URL shape and flags (`partial`, `stateMismatch`). A **page** holds its runs.

The importer rejects with instructions and never quotes the input (a JSON
parser's own error message quotes the text around the fault):

- text the console cut short (`truncated`), text that is not JSON, JSON that
  is not an object;
- a profile without `tags` or `attributes`;
- a section that does not have the script's shape.

**Deviation from D8.** D8 lists `maxZIndex`, `shadowRoots` and `iframes` as
required. The console script (Appendix A) writes each of them only once the
page has something to put in it: a page without iframes has no `iframes`
key, and one without a non-zero z-index has no `maxZIndex`. Rejecting them
would reject complete output, and Appendix A says the importer accepts the
script's output. The importer therefore accepts them as absent, validates
them when present, and returns `absentSections` so the UI can say so. A
truncated paste fails JSON parsing, which is what catches truncation.

The legacy frame key `Cross Origin N (src: …)` is parsed for its `src`; a
key of `null` gives no `src`, never an invented one.

## Noise (D4)

Noise is the confirmed list in `packages/dom-snapshot/src/ignored-roots.ts`,
extended rather than duplicated. This step added:

- Apty: `class-prefix apty-`, tags `apty-widget`, `apty-content-items`,
  `apty-focus-footer`, and `attribute-prefix data-apty-` (measured, pMD runs).
- Password managers: `jumpcloud` and `jcpwm-` (id and class prefixes, and
  `jcpwm-` as an attribute prefix), `data-myki-`, `data-form-preloader`.
- Extensions: `src-prefix chrome-extension://`.

Two matcher kinds are new. `src-prefix` makes a root like the existing
kinds: an element whose `src` is an extension resource is extension
content, so DOM Health now leaves it out too. `attribute-prefix` never makes
a root: a password manager writes its attributes onto the application's
own inputs, and dropping those inputs from DOM Health would be wrong. The
matching itself is one function, `matchIgnoredRootTarget`, which
`matchIgnoredRoot` calls for elements and the engine calls one value at a
time.

An icon with an inline `z-index` at or above 999999 is extension noise; it
is checked by value, not by a matcher. D4's unconfirmed entries
(`data-qa*`, `data-emotion`, `data-s`, `_goober`) are reported when seen and
never applied.

A schema 1 profile has values, not elements, so an element inside an Apty
subtree whose own values carry no marker cannot be recognised. When Apty is
present in some runs of a page and not in others, the report warns that
differences between those runs may include Apty's elements. The R2
collector removes noise subtrees as a whole.

### Adding a noise entry

Add a `matcher(kind, value, owner, evidence)` line to
`DEFAULT_IGNORED_ROOTS` with the right evidence tier and a comment saying
where it was seen. Use `attribute-prefix` for an attribute another product
writes onto the application's elements. Owners starting `Apty` count as
Apty; `PASSWORD_MANAGER` and `BROWSER_EXTENSION` count as extensions; any
other owner is an overlay. Add a case to
`packages/dom-snapshot/src/__tests__/overlays-and-duplicate-ids.test.ts`.

## Comparing runs (D1)

Every pair of runs of a page is compared: values added, removed or with a
different count, and tag counts. Noise differences are kept apart. A value
has **changed** when it is not present in every eligible run; count changes
alone are shown but are not a reason to ignore anything. A schema 1 profile
has no element identity, so this cannot tell an attribute that changed from
data that changed (different rows), and every such rule says so
(`set-diff`). When both runs carry element fingerprints and one shows the
same element with another value, the rule is `element-diff`.

Runs that are `partial`, over the size caps, or marked `stateMismatch` are
shown but never feed observed-change rules. Page status: `stable`
(identical apart from noise), `changing`, `unreliable` (a run that cannot be
trusted), `single-run`.

## Buckets (R1.4)

Every id value, class token and other attribute value goes in exactly one
bucket, first match wins:

| Order | Bucket | Test | Rule |
|---|---|---|---|
| 1 | Noise | D4 | none for values; a review rule for a password manager's attribute names |
| 2 | Covered by defaults | `DEFAULT_IGNORE` | none; listed as already ignored |
| 3 | Observed change | not in every eligible run | main, `observed_change` |
| 4 | Pattern | two or more values on the page differing only in digit runs, or an attribute name with a generated number | main, `pattern` |
| 5 | Record-specific | 5+ digits, a GUID, an ISO timestamp or a 16+ hex id, in a URL or a `data-*` value; the port of a `scheme://host:port` does not count (nor as a PII digit run) | record-specific group, off by default |
| 6 | State-driven | `aria-*`, `tabindex`, `disabled`, `selected`, `style`, state classes | review, `heuristic` |
| 7 | Layout-only | `width`, `height`, `align`, `valign`, `border`, `cellpadding`, `bgcolor`, `colspan`, `rowspan`, `nowrap` | review, `heuristic` |
| 8 | PII-bearing | email, phone shape, 5+ digit run | main, `pii`, by shape only |
| 9 | Stable | none of the above | kept; may enter attribute priority |

Where this deliberately differs from the existing helpers:

- `looksDynamic` (`health-dynamic.ts`) is not used. It is a single-observation
  heuristic for DOM Health; here, "pattern" is defined by the table.
- `classifyUnstableClass` is used only for its `state` kind. Its
  `environment` and `build` kinds (browser, theme, release classes) are not
  buckets in this table, so those classes stay stable.
- `isUnstableAttributeName` marks a single Angular encapsulation name
  (`_ngcontent-ng-c<n>`) as a pattern even when the page has only one; a
  version attribute without digits in its name (`ng-version`) is classified
  by its values like any other.
- `ui-*` state classes are read as jQuery UI's `ui-state-*`; structural
  `ui-widget` or `ui-dialog` stay identity. ag-Grid's row and cell state
  classes come from general knowledge of its markup, not a customer export.
- Apty's default class rule (classes starting `tether`) is evaluated per
  token; Studio applies it to the whole class value.

## Rules (D7, D3)

A rule is a list of conditions, `{category, operator, value}`, combined with
ALL. An id or class rule is an `Attribute Name Equals id|class` condition
plus an `Attribute Value` condition. Patterns escape metacharacters, write
digit runs as `\d+`, are anchored `^…$` and use a plain `|` for
alternation. These are assumptions about Apty until open questions 1 and 2
are answered.

A literal taken from page data (a regex fragment, a `Contains` value, an
`In` list, an example) must be identifier-shaped (letters, digits,
`_ - . :`, at most 32 characters) with no PII shape. If it is not, no rule is
written: the attribute goes to **Needs manual review**, with a count and no
values. Record and PII rules use fixed templates (`^.*\d{5,}.*$` and
similar), which contain no page data.

For a changed URL, the rule names the query parameter that changed for the
same link (`href Contains nocache`). Changed values that differ only in
digits get a pattern (`autocomplete Regex ^off_\d+$`). When every value of a
non-id, non-class attribute changed, the attribute is ignored by name; when
some stayed, it goes to manual review.

**Over-breadth guard.** A rule that would match a value seen unchanged in
every run of a page (at least two runs compared) is rejected and listed with
the reason. Values on single-run pages are not proven stable and do not
block a rule.

**Compaction**, only where the result matches exactly the union of the
parts: several names into one `In`, several values into one `In`, several
patterns with a shared prefix into one alternation
(`^ui-(?:id-\d+|tab-\d+)$`). Rules are deduplicated across pages, with
their page lists merged.

## Settings (D5)

| Setting | How | Basis |
|---|---|---|
| Attribute priority | Attributes stable on most pages: test attributes, then `id`, then `name`, then by uniqueness (distinct stable values / occurrences); at most 6; compared with `DEFAULT_PRIORITY` | derived |
| Shadow DOM | On for application shadow roots; on by convention when only Apty or extension roots exist; off when none were seen | measured / default |
| Max z-index | 2147483646, or the application's highest + 1 (at most 2147483647) when it already uses more; noise and the extension icon excluded and listed | derived / default |
| DOM change debounce | `clamp(p90 burst length × 1.2, 200, 1500)` ms with probe data; 500 ms otherwise | derived (heuristic) / default |
| Ignore DOM events | Events the probe saw above 20 per second; otherwise empty, "none measured" (an automatic crawl has no human input) | measured / default |
| Container score threshold | 75 (reference configurations) and 0.5 (the reconstructed model), both shown, neither converted | default |
| Click-advance | Not measured; keep Apty's value | default |

**Attribute priority order.** R1.6 lists `name` before `id`; Appendix C's
worked example, the golden test, gives `id,name,col-id,placeholder,data-ref,href`.
The engine follows the worked example, which also matches Apty's default
order, where `id` comes first.

In a schema 1 profile only the highest z-index of each scope is known. When
it equals an inline z-index at or above 999999 in the same run, it is taken
to be the extension icon's (an assumption) and excluded; the application's
highest is then known only from runs without the icon.

## Iframes, coverage, warnings

Each frame is listed with its real `src` (as a URL shape), whether it is
cross-origin, whether it is an application or an extension frame, and
whether it was analyzed and if not why. Application frames need handling
in Apty.

Coverage is the checklist of states SEs most often miss (entry forms, detail
pages, list and grid pages, modals and dialogs, popups, dropdown panels,
tooltips, side panels, print and report views, embedded documents,
click-only states). The engine suggests captured pages whose markup looks
like each kind; whether a kind was captured is the SE's answer. The
Markdown ends with what was not captured.

Warnings: weak selectors (with counts), PII counts only, person names not
detectable, incomplete and state-mismatched runs, single-run pages, no test
attributes, rejected rules, Apty present in some runs only, truncations,
unconfirmed noise, items covered by defaults, closed shadow roots, large
DOMs, rules beyond the limit.

## Determinism, size and privacy

- **D9.** No clock, no randomness, a total order everywhere (code-unit
  string order, never `localeCompare`). Pages, runs and object keys in any
  order give byte-identical JSON and Markdown; a test checks this.
- **D10.** Caps in `limits.ts`: 20,000,000 characters per profile, 200
  pages, 8 runs per page, 5,000 distinct values per attribute (the most
  frequent kept), 512 characters per value (the rest replaced by a hash so
  values stay distinct), 8,000,000 characters of values per run, 256
  characters per pattern, 400 rules. Everything cut is listed under
  Truncations; an attribute cut in a run feeds no observed-change rule.
- **D2, D11.** Email, phone and digit-run shapes never reach the report: diffs
  show `[PII value hidden]`, rules use shape templates, examples must pass the
  D3 check, errors never quote input. URLs are kept as shapes: the path
  through the strict path policy (`:id`, `:email`), the query reduced to
  parameter names. Page titles are never stored. Person names have no shape
  and are not detected: one can appear in a page's diff, never in a rule, an
  example or the Markdown.

## Collector and behavior probe (R2)

### `collectDomProfile` (`packages/dom-snapshot/src/dom-profile-collector.ts`)

Runs in the frame responder, one frame at a time, within the same budget
as the DOM Health collector (`collector-budget.ts`: 50,000 elements, 2,500
shadow roots, 6 s, yielding every 16 ms, below the 8 s per-frame message
timeout). It walks the composed tree (`walkComposedTree`) and only reads.

On the shared fields (`tags`, `attributes`, `maxZIndex`, `shadowRoots`)
it writes what the console script writes; a jsdom test and an e2e test
run the script on the same document and compare. Where it differs, on
purpose:

- Noise subtrees (`DEFAULT_IGNORED_ROOTS`) are left out whole and listed
  in `meta.excludedRoots`; the script reads them as page content.
- Every shadow root of a host tag is read and merged under that tag; the
  script reads only the first. Closed roots are read where
  `chrome.dom.openOrClosedShadowRoot` exists (`meta.closedShadowRootsVisible`);
  `shadow` lists each host as `open` or `closed`, never a guess.
- Child frames are not entered. Each one is profiled by its own
  responder, which runs in every frame (`all_frames`, `match_about_blank`,
  `match_origin_as_fallback`), so a cross-origin frame is read too, where
  the script prints a placeholder. `frames` records each frame element
  from this document's side: its `src` as a URL shape, and whether this
  document can read it (`blocked-cross-origin`, `about:blank`, `srcdoc`,
  `not-loaded`, or `noise`).
- Values are bounded: a value over 400 characters keeps its start, then
  `…[length#hash]` of the rest; an attribute with more than 5,000 distinct
  values stops growing and is named in `meta.truncatedAttributes`.
- Maps are keyed by page data, so they have no prototype: a value such as
  `constructor` or `__proto__` is just a key.

It adds `zIndexSources` (each element with a z-index of 1000 or more: tag,
short id and class, whether the z-index is inline), `meta` (URL shape,
viewport, Apty and extension presence, element count, duration, `partial`
with reasons) and `schema: 2`.

**Element fingerprints are not collected.** A structural path changes
whenever rows or content change, which is exactly when D1 needs it; a
per-attribute value hash is derived from the value, so a short value can
be recovered by guessing; and one record per element would make each
message as large as the page. Changes stay `set-diff`.

### Frames of one state (`collect-state-profile.ts`)

`collectStateProfile(tabId)` lists the frames (`getFrameTree`), joins each
to its element (`collectFrameOwnersByFrameId`), sends
`collect-dom-profile` to each by frameId in parallel and nests the
results as the script nests readable frames: under the parent's
`iframes`, keyed by the frame's URL shape. A frame that did not answer
keeps the script's `Cross Origin N (src: …)` key with no content and makes
the state `partial`. Extension pages and overlay frames are listed, never
read. `frames` in the merged profile has one record per child frame (its
`src` attribute and URL as shapes, readable or why not), and the inventory
gives each frame's role (`frameRole`) and why it was or was not read.

### Behavior probe (`dom-config-probe.ts`)

`captureBehaviorProbe(tabId, { windowMs })` arms every frame
(`dom-config-probe-arm`), waits the window (3 s by default), captures and
disarms. In each frame a `MutationObserver` on the document and every
shadow root present when it is armed records callbacks; callbacks less
than 100 ms apart form one burst (duration and mutation count). Mutations
inside noise subtrees are not counted. Hover, pointer, scroll, wheel,
resize and touch events are counted only when they fire, as events per
second. An automatic capture has no human input, so event rates are
usually zero and the report says "none measured" (D6). A shadow root
attached after arming is not watched.

## Automatic crawl (R3)

### The shared driver (`apty/application-crawl.ts`)

DOM Config reuses Audit Application's crawl rather than forking it. The
traversal that used to live inside `runApplicationDomHealthAudit` (link and
control discovery, the queue, the state graph, restoration by URL or by
replay from the seed, the traversal strategy, the hard limits) moved, code
unchanged, into `crawlApplication(tabId, { visit, ... })`. The only
per-state work, which was `collectDomHealthAudit` at two sites, is now the
`visit` callback. `runApplicationDomHealthAudit` is a thin caller whose
visitor runs the DOM Health audit and the seed-path replay, and maps the
crawl's rows back to `PageAuditRecord`s. The existing audit and scoring
tests (48) and the DOM Health e2e files pass unchanged.

The driver adds three things the audit does not use:

- `signal` (an `AbortSignal`), checked between states; the result says
  `aborted`.
- `revisit()` on the visit context: a fresh visit to the state being
  visited (D13). A state reached by URL is loaded again with `navigateTab`
  (never `tabs.reload`, so no POST is resubmitted) and its fingerprint
  compared with `compareStateFingerprints`. A state reached by a click is
  restored by replaying its recorded path from the seed, with a
  fingerprint check at every hop. Anything but `same` leaves the graph's
  live state unknown (`StateGraph.forgetCurrentState`), so the next click
  is restored first and no control on the wrong screen is attributed to
  the state.
- `unexplored`: the work still queued when a limit or the signal stopped
  the crawl.

A capture right after a load that misses a frame (comparison `uncertain`)
or fails outright is taken once more after the DOM settles before a
restoration hop, the seed check, a revisit or the capture before a click
is judged; one late frame used to fail the restoration.

### `runDomConfigCapture(tabId, options)` (`dom-config/crawl.ts`)

| Option | Default |
|---|---|
| `discoveryMode` | `application-safe` (never silently deep); `page` captures only the seed state |
| `maxPages` | 20 |
| `maxTotalMs` | 600,000 |
| `runsPerState` | 2, at most 4 |
| `probe`, `probeWindowMs` | on, 3,000 ms |
| `ignoredRoots` | Settings → Troubleshooting entries |

Per state: run 1 `initial` as reached (after `waitForDomStable`), the
behavior probe on run 1, run 2 `after-reload` after `revisit()`, runs 3 and
4 `repeat` with no navigation. A run 2 whose fingerprint is not `same` is
marked `stateMismatch` (it and the repeats after it), the page's
inventory row says why, and the engine keeps those runs out of
observed-change rules. A state whose first run fails is recorded `failed`
and the crawl goes on; one that loses a later run is a single-run page.
At the end the tab is navigated back to the seed URL and
`returnedToSeed` says whether the seed state came back.

A state the crawl reaches that shows a page already captured under another
URL is not captured again: `pageIdentity` (`route-key.ts`) is the state's
route identity without the query parameters whose value the URL template
turned into a placeholder, so `/home` and `/home?nocache=1700000000123`
are one page while `?view=visits` and `?view=orders` stay two. Such a state
is listed `skipped`, "duplicate of <URL shape>", is not counted against
`maxPages` and is not explored further. The graph's own state fingerprint
keeps the query, so Audit Application still treats them as two states.

Page ids are the URL shape (`toUrlShape`: the strict path policy, query
names only, D11), plus `[state-N]` for a state reached by a click on the
same URL; titles and control texts are not used. The outcome holds the
capture, the inventory (`audited`, `failed`, `skipped`,
`not-discovered`, `not-explored`, with reasons), the per-state frame
inventory, the limits reached, and the engine's report and Markdown
(`buildReportFromCapture`, also exported for re-running the analysis on
the same capture). Progress phases: `discovering`, `capturing` (state
index and run label), `probing`, `revisiting`, `restoring`, `analyzing`.

Safety is the audit's, unchanged: safe mode follows only same-origin
`<a href>` links that pass `isSafeToDiscover`, and lists menu, tab and
tree controls as `not-discovered` without clicking them. Deep mode clicks
only candidates that pass the allowlist and the content script's
re-verification. Nothing submits a form or types.

### `captureCurrentState(tabId, options)`

For states only a person can open (a modal, an entry form, an opened side
panel, a record): adds one run of the tab exactly as it is to the named
page of the in-memory capture, creating the page (`origin: "manual"`) when
needed. It never navigates, clicks or reloads; for `after-reload` the SE
reloads the page first. The run records the state fingerprint, and a run
whose fingerprint another page already holds returns a `duplicate-state`
warning instead of silently making a second page of the same state. It
shares the collector, the run model and the engine's caps with the crawl,
and refuses a run beyond `maxRunsPerPage`. The input capture is not
changed; a new one is returned.

### Known limits

- In deep mode the nav anchors inside a `<nav>` are also click candidates,
  as in the audit. A click on one starts a navigation that the crawl does
  not wait for, so the fingerprint taken after it depends on timing: the
  page it leads to can appear again as `<page> [state-N]`, and its fresh
  visit usually comes back `state-mismatch` (kept out of the rules). It
  also makes a deep crawl several times slower than a safe one.
- Results live in memory only (D12); nothing is written to storage.

## Side panel page (R4a)

`apps/browser-extension/src/components/investigation/dom-config/`, the DOM
config page (`dom-config-page.tsx`), which the menu, the composer's "/"
list and the start screen's "See all" open.

- **Setup.** Scope as option cards: this page only (`maxPages: 1`, safe
  mode), the whole application in safe mode (links only, the default) or
  in deep mode (also clicks menus and tabs; Start stays disabled until the
  SE confirms that it clicks on the live application). "Advanced options"
  shows a summary of the current values and opens runs per page (2 to 4),
  the page and time limits (engine defaults: 20 pages, 10 minutes) and the
  behavior probe. A notice says the tab will navigate and load pages more
  than once and that unsaved input can be lost; the hint that results are
  held in the panel only (D12) is under Start.
- **Running.** "Capturing page n of m" (the last capturing progress, kept
  while the crawl discovers or revisits), the current URL shape, one
  sentence for the current action in a polite live region, a progress bar,
  the run and the elapsed time against the time limit, and one row per
  page (its URL shape, never its title) with its runs; a chip per run
  shows only for a failed run or a different state. The run's events carry
  no run failure or state mismatch, so those appear only once the outcome
  arrives. "Stop capture" aborts through the `AbortSignal`; the results
  built from what was captured say they are partial, as they do when a
  limit was reached.
- **Results.** Whether they were exported (a warning until Copy all or an
  export), the partial and return-to-start notices, a summary (pages, runs
  each, the crawl's time and scope), "Proposed settings" (ignore
  conditions and the five settings, each opening its existing view) and
  "Details" (Pages, Iframes, Coverage, Warnings with their counts). The
  ignore-conditions view shows IDs, classes, attributes by name and by
  value, each rule shown as Apty's builder would hold it (ASSUMPTION D7);
  review rules excluded until ticked; record-specific rules behind the
  "Guides target a specific record" switch; collapsed lists of what Apty's
  defaults already cover, what needs manual review and the rejected rules.
  The settings view shows each value with its basis as text and icon and a
  Copy button, the attribute priority compared with Apty's default order,
  the debounce marked a heuristic, both container score threshold values,
  then "What was not measured" and the open questions.
- **Copy and export.** Copy on each value, "Copy as table" per section
  (tab-separated, for a spreadsheet), and "Export results": Markdown, JSON
  or "Copy all". All of them use `{...report, rules: includedRules}`, so an
  excluded rule appears in no copy and no export. JSON is the engine
  report, not a reference-config format. Re-run analysis calls
  `buildReportFromCapture` on the held capture; it never captures again.
- **Ask about these.** A new chat with a draft question and the Markdown
  export as a removable chip, redacted as a tool result is in the current
  mode (`redactToolOutput`); nothing is sent until Send.
- **Tab lock.** DOM Config and DOM Health take `tab-lock.ts`'s lock for the
  tab they run on; the other page's Start is disabled and says why. Tool
  runs the chat agent starts are not covered.

## Manual capture, import and the held capture (R4b)

The SE's runbook is [`dom-config-runbook.md`](dom-config-runbook.md).

- **One held capture.** The store holds one `ApplicationCapture`
  (`capture`) and the SE's coverage marks (`coverageMarks`); the report is
  always `buildReportFromCapture(capture, { ignoredRoots, coverage })`. The
  crawl's own result (`outcome`: limits, Stop, return to the start page)
  is kept apart as crawl metadata, and its banners show only when a crawl
  is held. A crawl sets the capture; manual capture and import replace it
  with the new capture the engine returns, which adds to it (the engine
  never changes its input). The report phase starts as soon as the capture
  holds a page, with or without a crawl. Manual capture and import are
  offered when nothing runs, never during a crawl.
- **Replace on Start.** A crawl starts from an empty capture. When the held
  capture has a manual or imported page, Start first shows "Starting
  replaces the N pages already captured" and runs only once the SE
  confirms; a capture of crawled pages only is replaced without asking.
  Clear results is the explicit reset; Run again opens setup.
- **Manual capture.** "Capture current state": a page name (typed by the
  SE, at most 80 characters, never prefilled from the page), the run kind
  and the probe. It captures the tab in front (`useCurrentTarget`), not the
  crawl's tab, takes the tab lock for the time it reads, and calls
  `captureCurrentState` with the held capture: it never navigates, clicks
  or reloads. The result, the `duplicate-state` warning (naming the other
  pages) and the engine's error (the 8-run limit included) are read out in
  a polite live region. Without a tab, on a browser page or while DOM
  Health holds the tab, it is disabled and says why. The only prefill is
  "Capture another run" in the Warnings view, which opens it with that
  page's name.
- **Import.** The console script (`DOM_CONFIG_CONSOLE_SCRIPT`, verbatim) is
  one Copy away, with a note on what it cannot do. Runs are pasted or
  loaded from files, each with its run kind, and become one page through
  `buildPageCapture` with `origin: "import"`. Each failing run is listed by
  position with the engine's message, the missing sections and what to do;
  the valid runs of the same page are kept and only the failing ones stay
  in the form. A page name already held appends the runs, up to 8 runs a
  page; the rest are named as left out.
- **Page detail.** A page row opens (a button with `aria-expanded`) to its
  runs (kind, URL shape, element count, partial and different-state
  marks), what changed between each pair of runs as the engine lists it
  (PII-shaped values already hidden), Apty and extension differences in a
  collapsed group, max z-index, shadow hosts and iframe count. "Download
  raw profile" saves one run's profile JSON from the held capture, after
  an inline "This file contains page data" confirmation.
- **Details.** Iframes (by kind, application iframes needing handling
  first), Coverage (each of the 11 kinds with its status and suggested
  pages, and a mark: captured, not applicable or planned; no mark is "not
  captured". A mark re-runs the analysis; the engine does not check it)
  and Warnings (every warning, warn-severity first, the weak selectors and
  the pages not ready). Each row's description gives its count, the
  Warnings row the number to act on.
- **Pages with one run.** No "generate anyway" switch: such a page already
  takes part. In the engine's terms, its values still feed pattern rules
  (value shapes) and record-specific rules, but it shows no value
  changing, so it gives no observed-change rule, and its values are never
  `verified` stable, so they cannot reject a rule (`classify.ts`,
  `generate-rules.ts`). The Warnings view says so.
- **Exports.** Markdown and JSON come from the engine report built with
  the coverage marks, so the Coverage and Iframes sections of the Markdown
  are the engine's own; Copy all adds the Iframes and Coverage tables.

## Open questions

The report lists them every time: how Apty's builder expresses id and class
rules; the Regex flavor and matching mode, and whether `In` is
comma-separated; which event names Ignore DOM events accepts; the max
z-index ceiling; whether 75 and 0.5 are the same setting; whether DOM
Settings adds to or replaces the built-in defaults; the reference-config
format; the unconfirmed noise entries; persistence across restarts; bundling
the reference configs.

## Decision record

**DOM Config is a deterministic engine, not a model.** Following the DOM
Health decision, the settings come from a fixed rule engine over captured
profiles, with every value labeled measured, derived or default and every
rule carrying its evidence. It extends the existing noise list
(`DEFAULT_IGNORED_ROOTS`, with two new matcher kinds) rather than keeping a
second one, reports what Apty's reconstructed defaults already cover instead
of repeating it, and never writes page data that fails the identifier check
into a rule. Results are held in memory only. Deviations from the brief, each
explained above: the console script's lazily written sections are accepted
as absent; `id` precedes `name` in the attribute priority, as in the worked
example.

**The crawl is Audit Application's, not a second one (R3).** The traversal
was extracted from `application-audit.ts` into a driver that takes the
per-state work as a visitor, rather than copied, so discovery, safety
checks, restoration and limits stay one implementation. The audit's tests
pass unchanged. Click-based discovery stays opt-in (`application-deep`),
and a fresh visit is a navigation or a replay of recorded clicks, never a
reload.
