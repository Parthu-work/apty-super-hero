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
| R1 | Pure engine: validate, diff, classify, generate rules, derive settings, warnings, Markdown; importer for the console script's JSON | This document |
| R2 | In-page collector and behavior probe | Not started |
| R3 | Automatic crawl with several runs per state | Not started |
| R4 | Side panel card, progress, report, import and export | Not started |

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
| 5 | Record-specific | 5+ digits, a GUID, an ISO timestamp or a 16+ hex id, in a URL or a `data-*` value | record-specific group, off by default |
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
