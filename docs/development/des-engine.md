# Apty Dynamic Element Selection (DES) engine

This documents `packages/dom-snapshot/src/des-engine.ts` — the single,
authoritative algorithm behind DOM Health's "automatic selection accuracy"
metric. It replaced an earlier ad hoc heuristic (formerly all of
`health-selector-engine.ts`) that tried attribute candidates one at a time
in a fixed order and called `querySelectorAll` returning something "a
success." That heuristic is gone; `resolveElement` in
`health-selector-engine.ts` is now a thin adapter that delegates entirely to
`runDes` below, so there is exactly one selection algorithm in this package.

## Why this exists

An automatic-selection accuracy number is only meaningful if "success" means
something specific: **the selector resolves, uniquely, to the actual element
the caller meant** — not "some selector was constructed," not "one element
matched by chance," and not "an element matched that happens to be a
different one entirely." DES makes that distinction structural rather than
incidental: every result carries a verified `IdentityVerdict`, and an
outcome can never be `RESOLVED` without one.

## Core model: ElementPattern / ElementPath

`buildElementPattern(el, config)` captures the identity-relevant facts about
one element — never every DOM attribute indiscriminately:

- `tag`
- `attributes`: every classifiable single-valued attribute present
  (`id`, `aria-label`, `name`, `role`, every `data-*`), each run through
  attribute classification (below)
- `classInfo`: the `class` attribute, classified per-token then rolled up
- `relationship`: parent tag, parent id, parent's stable class tokens
- `order`: 1-based index and count among same-tag siblings
  (`nthOfType`/`siblingCountOfType`)
- `role`, `accessibleName`, and a bounded `textSample` (a similarity signal
  only — never used to build a selector predicate)

`buildElementPath(el, config)` wraps the target's own pattern together with
its ancestor chain (innermost first, bounded by `DesConfig.maxAncestorDepth`,
default 4). This is deliberately **not** an XPath-style string: keeping each
ancestor's own classified pattern lets every strategy reason about *which
level* changed between two DOM states, instead of only being able to compare
opaque serialized paths.

## Attribute classification (never "digits = dynamic")

`health-attribute-classification.ts`'s `classifyAttribute`/
`classifyClassAttribute` assign one of four classifications to every
attribute, each with a human-readable `reason`:

| Classification | Meaning |
|---|---|
| `STABLE` | Doesn't look machine-generated; safe to use as-is. |
| `PARTIAL_MATCHABLE` | Looks generated, but has a genuine stable leading substring (e.g. `widget-582917` → prefix `widget`). |
| `IGNORED` | Excluded by a configured Ignore Selector rule. |
| `DYNAMIC` | Looks generated with no safe stable prefix — never used as a selector predicate. |

"Looks generated" (`health-dynamic.ts`'s `looksDynamic`, unchanged, reused)
requires a UUID, an all-numeric value, a trailing 4+ digit or 6+ hex run, or
a known framework-generated prefix — never merely "contains a digit." A
value like `field-1` or `fld-vendor-00214`'s `name="vendor"` sibling
attribute stays `STABLE`; only the genuinely generated-looking value gets
partial-matched or dropped.

Precedence when both a configured Partial and Ignore rule could apply to
the same attribute: **Partial wins** — an attribute deliberately configured
as partially matchable is still usable via its stable prefix, even if an
Ignore rule also lists it.

### Apty Studio configuration concepts (simulated locally)

`DesConfig` carries three configuration concepts that change engine
*behavior*, not just cosmetics:

- **Ignore Selector** (`ignoreSelectors: [{ attribute }]`) — the named
  attribute is never used as a selector predicate, full stop.
- **Partial Selector** (`partialSelectors: [{ attribute }]`) — the named
  attribute is matched by its stable prefix even when the heuristic alone
  wouldn't have flagged it as dynamic-with-prefix, and takes precedence over
  an Ignore rule for the same attribute (see above).
- **Attribute Priority** (`attributePriority: { order }`) — overrides
  `DEFAULT_ATTRIBUTE_PRIORITY_ORDER` entirely when provided:
  ```
  data-testid, data-test-id, data-automation-id, data-automationid,
  data-apty*, id, data-*, aria-label, name, role, class
  ```
  An attribute absent from the effective order is tried last (never
  silently invisible to selector generation) — see
  `priorityRankOf`.

## The five strategies

`runDes` runs these in order, in `STRATEGIES`, stopping at the first
genuine `RESOLVED`:

1. **`checkInitialPath`** — tries the target's own single stable/partial
   attribute alone (no ancestor context yet). Deliberately has **no**
   positional fallback: adding one here would let position win before
   `checkSimplifyDynamic`'s combined-stable recovery ever gets a chance
   (verified by a regression test that pins this ordering).
2. **`checkSimplifyDynamic`** — tries a single `PARTIAL_MATCHABLE`
   fragment (an otherwise-dynamic value's stable prefix), then a
   *combination* of more than one `STABLE` attribute together when no
   single one is unique alone. The legacy adapter reports the former as
   `RECOVERED_BY_PARTIAL` and the latter as `RECOVERED_BY_IGNORE` (the
   "ignore the noisy attribute, combine the rest" behavior).
3. **`checkSimplifyNth`** — relaxes ordering: builds a selector from the
   target's relaxed leaf fragment plus relaxed ancestor fragments (no `nth`
   qualifiers), then ranks whatever matches by structural similarity when
   more than one candidate comes back. This is what recovers from sibling
   reordering/insertion/removal. Whether an ancestor's own attribute
   genuinely contributed is tracked independently of whether the *leaf's*
   attribute did — an ancestor's stable id/class is real context regardless
   of match count (that is the strategy's whole point), but the leaf's own
   attribute is only credited when it was already unique among the
   matches; once ranking had to pick a winner among candidates sharing that
   same leaf attribute, it was structural similarity (which folds in
   order), not the shared attribute, that actually disambiguated.
4. **`checkContainers`** — progressively drops ancestor levels (outermost
   first), trying both `>` and descendant combinators, and both a plain
   leaf fragment and an `nth-of-type`-augmented variant (plain tried
   first, so a genuine attribute-only success is never mislabeled as
   positional). Ends with a last-resort full `nth-of-type` chain through
   every ancestor for fully-duplicated-sibling cases (e.g. a template that
   repeats the same `id`/`class` at every level) — reported with **no**
   `attributesUsed`, which is what marks it as genuinely positional rather
   than contextual.
5. **`checkDirectElement`** — no ancestor context at all; broadens by
   dropping up to two of the target's weakest (lowest Attribute-Priority)
   fragments, ranking every match by structural similarity. Bounded by
   `DIRECT_ELEMENT_CANDIDATE_CEILING` (500) for performance, with the cap
   reported explicitly in the evidence `reason` rather than silently
   truncated.

Every strategy attempt — successful or not — is recorded as a
`StrategyAttemptEvidence`: the strategy name, the selector tried, how many
candidates matched, how many cleared the threshold, the best similarity
seen, which attributes were used/removed, an outcome tag, and a
human-readable reason. This is compact structured evidence, never a raw DOM
dump.

## Structural similarity

`computeSimilarity(target, candidate)` is deterministic and documented, not
tuned per fixture. Weights sum to 100:

| Axis | Weight | Method |
|---|---|---|
| Tag match | gate | Mismatch forces `total` to `0` regardless of every other axis — two different tags are never "the same element." |
| Stable attributes | 35 | Jaccard over `{name=value}` pairs from `STABLE` attributes. |
| Partial attributes | 10 | Jaccard over `{name=stablePrefix}` pairs from `PARTIAL_MATCHABLE` attributes. |
| Classes | 15 | Jaccard over stable class tokens. |
| Accessibility | 10 | Role equality (5) + accessible-name equality (5). |
| Relationship | 20 | Parent tag match (10) + parent id/class Jaccard (10). |
| Order | 10 | Closeness of `nth-of-type` index, proportional to sibling count — never a hard cliff. |

## Acceptance threshold and ambiguity

`DesConfig.similarityThreshold` (default 70) is the minimum score a
candidate must reach to be considered at all. `DesConfig.ambiguousGap`
(default 5) governs ties: if the top two above-threshold candidates score
within this gap of each other, the result is `AMBIGUOUS`, never a coin-flip
pick of the higher one. `rankAndClassify` distinguishes:

- **resolved** — a clear, above-threshold, uniquely-best candidate whose
  identity verifies.
- **ambiguous** — either a genuine score tie, or identity verification
  itself couldn't distinguish the top candidate (`AMBIGUOUS_TARGET`).
- **wrong-target** — the best-ranked candidate is unique and clears the
  threshold, but identity verification says it is not the actual target.
- **below-threshold** — nothing cleared the bar at all; the strategy keeps
  broadening (or the next strategy runs) rather than accepting a weak
  match.

`DesOutcome` also distinguishes `NOT_RESOLVED` (nothing matched at any
strategy, at any threshold) from `INACCESSIBLE` (the target lives behind a
boundary DES cannot search at all — see Shadow DOM below) — these are never
conflated.

## Target identity verification

A selector matching *something* is never treated as success. `verifyIdentity`
distinguishes:

- **`CORRECT_TARGET`** — the candidate `===` the live target element (the
  ordinary single-snapshot case), or its `computeIdentityFingerprint`
  matches an `expectedFingerprint` supplied for cross-snapshot testing.
- **`WRONG_TARGET`** — a unique, above-threshold candidate that is
  demonstrably not the target.
- **`AMBIGUOUS_TARGET`** — identity verification itself can't distinguish
  the top candidate (folded into `AMBIGUOUS` by `rankAndClassify`).
- **`UNKNOWN_IDENTITY`** — no ground truth available at all (a genuine
  production cross-snapshot resolution with nothing stored to check
  against). The match is still reported, but its identity is honestly
  unknown, never claimed correct without evidence.

**Production code must never rely on live JS object identity across
snapshots** — a page reload or re-render invalidates every previously-held
element reference. `computeIdentityFingerprint(pattern)` is the
logical-identity fallback: tag, role, accessible name, a sorted signature of
non-`id` `STABLE` attributes, the text sample, and `nthOfType` — deliberately
excluding `id` (the attribute most likely to be regenerated by a framework
on re-render). This is the same fingerprint
`health-selector-engine.ts`'s `computeElementFingerprint` and
`health-collector.ts`'s cross-snapshot element registry use, so DES's
identity model and this package's snapshot-to-snapshot stability tracking
never drift apart into two different definitions of "the same logical
element."

`recoverElementFromPath(root, storedPath, config, options)` is the
production-realistic cross-snapshot entry point: it runs the same five
strategies against a previously-captured `ElementPath` with no live target
object at all.

## Frame and Shadow DOM boundaries

DES never crosses a frame boundary implicitly. `root.querySelectorAll`
naturally cannot see into a different `Document`, so passing the correct
frame's document/open-shadow-root as `root` is sufficient — there is no
separate "frame check" to get wrong. `runDes`'s live-element check is
deliberately **not** `target instanceof Element`: an element from a
different frame/document has its own realm's `Element` constructor, and
`instanceof` is unreliable across realms. `nodeType === 1` is a plain data
property, safe across realms, and is what actually gates whether `target`
is treated as a live element or a stored `ElementPath`.

Shadow DOM: an **open** shadow root is just another `ParentNode` — callers
pass it as `root` and DES searches it normally. A **closed** shadow root is
a real browser security boundary DES cannot see through; callers that
already know a target lives behind one pass `RunDesOptions.inaccessibleReason`,
and the result is `INACCESSIBLE` — never silently converted into a
`NOT_RESOLVED` failure, and never faked as a resolution.

## DOM Health integration

`health-selector-engine.ts`'s `resolveElement(root, el, options)` builds a
`DesConfig` from `DEFAULT_DES_CONFIG` (plus an optional
`maxAncestorDepth` override), calls `runDes`, and maps the rich `DesResult`
onto the narrower `ElementResolution` shape `health-collector.ts` already
aggregates into `DomHealthSnapshot.elementReports` — every legacy
outcome/strategy pair is a genuine, distinguishable DES result, not a lossy
guess:

| DES outcome / strategy | Legacy outcome |
|---|---|
| `RESOLVED`, `attributesUsed` empty | `POSITIONAL_ONLY` |
| `RESOLVED` via `checkInitialPath` | `DIRECT_SUCCESS` |
| `RESOLVED` via `checkSimplifyDynamic`, one attribute | `RECOVERED_BY_PARTIAL` |
| `RESOLVED` via `checkSimplifyDynamic`, combined attributes | `RECOVERED_BY_IGNORE` |
| `RESOLVED` via `checkSimplifyNth`/`checkContainers` | `RECOVERED_BY_CONTEXT` |
| `RESOLVED` via `checkDirectElement` | `POSITIONAL_ONLY` |
| `AMBIGUOUS` | `AMBIGUOUS` |
| `WRONG_TARGET` | `WRONG_TARGET` |
| `INACCESSIBLE` | `INACCESSIBLE` |
| `NOT_RESOLVED` | `NOT_RESOLVED` |

Because `health-collector.ts` calls `resolveElement` for every interactive
element it inventories, DOM Health's automatic-selection accuracy metric is
now, transitively, a direct rollup of real verified DES outcomes — not
selector-uniqueness. `dynamicAttributeNames`/`stableAttributeNames` in the
legacy shape are aggregated from every strategy attempt's
`attributesRemoved`/`attributesUsed` across the whole run, not just the
winning one, so a caller can see everything DES tried, not only what
finally worked.

## Performance

A naive per-element `nthOfType`/sibling-count computation is O(siblings)
per call — O(N²) across N same-tag siblings (a table of rows, a repeated
list). `getSiblingInfo` computes every sibling's order info for a given
parent in one pass, cached per-child in a `WeakMap` (`resetDesPerformanceCaches`,
called at the start of every `collectDomHealthSnapshot` round so a later
round that legitimately mutated the DOM is never served stale counts).
`patternFor` additionally short-circuits rebuilding a candidate's pattern
when the candidate is provably the live target this run already built a
pattern for. `checkDirectElement`'s candidate ranking is bounded by
`DIRECT_ELEMENT_CANDIDATE_CEILING` (500); when hit, the cap is reported
explicitly in the evidence rather than silently truncating results. No
strategy performs an unbounded `O(elements × full-DOM × strategies)` scan:
every candidate set comes from a specific `querySelectorAll` call scoped by
the fragments/ancestors that strategy is trying, never "every element in
the document, tried against every other element."

## Known limitations

- Cross-snapshot identity without any stored fingerprint or live reference
  is honestly `UNKNOWN_IDENTITY` — DES cannot invent certainty it doesn't
  have.
- `checkContainers`'/`checkDirectElement`'s multi-candidate ranking uses
  the same fixed similarity weights as everything else; there is no
  per-application tuning knob beyond `DesConfig`'s documented fields.
- Real Autodesk/Infor LN validation has not been performed against a live
  instance of either application — see the Phase 2 delivery report's
  "REAL-WORLD VALIDATION BLOCKED" section. The golden fixtures in
  `des-engine.golden-fixtures.test.ts` are synthetic DOM shapes inspired by
  publicly-observable patterns in that class of application, not captured
  from, or claimed to represent, any real customer DOM.
