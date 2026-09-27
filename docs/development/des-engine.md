# Apty Dynamic Element Selection (DES) engine

This documents `packages/dom-snapshot/src/des-engine.ts` — the single,
authoritative algorithm behind DOM Health's "automatic selection accuracy"
metric.

## This is a reverse-engineered reconstruction, not an invention

An earlier session built a from-scratch DES engine (Jaccard similarity
across 6 weighted axes, 5 named strategies, a 70-point threshold with a
5-point ambiguity gap, flat `{attribute: string}` Ignore/Partial rule
lists, a `data-testid`-first default attribute priority) without access to
any real Apty source. That engine was internally consistent and
well-tested, but a side-by-side comparison against the real Apty Studio
extension (`studio-extension_63`'s `workflowPreview.js`/`main.bundle.js`
webpack bundles — property and function names are unmangled there, not
invented here) showed it diverged from the real product in nearly every
load-bearing detail. This file replaces it with a faithful reconstruction
of the real algorithm, recovered by reading the actual shipped bundle.
Every constant, function name, and behavior below is cited to the real
module it came from; anywhere the real bundle's exact per-branch behavior
could not be recovered with confidence, that is stated explicitly rather
than guessed at.

**What is confirmed, byte-level-faithful:** attribute/class capture and
classification (`initAttributes`/`addAttribute`, module 65913), the
default Ignore heuristic and default Attribute Priority (`defaultIgnore`/
`initOptions`, module 92317), selector string generation
(`patternToSelector`/`pathToSelector`, module 5757), the runtime recovery
search (`find()`/`checkInitialPath`/`strategies`, modules 15906/81948),
and the scoring model (`diffScore`/`patternDiffScore`/`arrayDiffScore`,
module 17851).

**What is an honestly-labeled best-effort reconstruction, not a byte-exact
port:** the minimal-selector-generation algorithm's exact per-level trim
ordering (real `match()`/`optimize()`, modules 39842/59772) — the real
code has a live 1-second-per-step timing budget and a dual attribute/
text-content-first-node special case whose exact interaction could not be
fully disambiguated from the minified bundle alone. `generateMinimalSelector`
in this file preserves the documented *intent* (grow attributes in
priority order until the selector-so-far is live-unique; fall back to a
bare tag match, then to `nth-child`; climb one ancestor level and repeat)
without claiming to reproduce every real quirk.

**What is DOM Health's own addition, not part of the real algorithm at
all:** classifying a resolved element against known ground truth into
`WRONG_TARGET`/`NOT_RESOLVED`/an honest `AMBIGUOUS` risk flag. Real Apty's
own `find()` has no such categories — it is a single ranked candidate pool
with a top-1 pick above a score floor, full stop. See "DOM Health's
evidence layer" below.

## Two distinct real algorithms

Real Apty runs two different algorithms for two different jobs, and this
file reconstructs both:

1. **Capture** (`buildElementPattern`/`buildElementPath`) — builds a FULL
   descriptive pattern per DOM level (every non-ignored attribute, class,
   and pseudo-fact), never early-exiting. This is what a stored
   `ElementPath` actually contains (real `createPath`, module 61503), and
   what candidate patterns are diffed against during recovery.
   `generateMinimalSelector` separately builds the MINIMAL unique CSS
   selector a Studio user would actually see (real `match()`/`optimize()`)
   — a different, early-exiting algorithm from the same underlying
   attribute/priority machinery.
2. **Recovery** (`findElement`) — given a captured `ElementPath` (live or
   stored) and a root to search, finds the best-matching live element,
   faithfully reproducing real `find()`'s exact strategy order and
   acceptance thresholds.

## Pattern / Path shape

`ElementPattern` (real `createPattern`, module 65913) is deliberately not
tag+id+class:

```ts
interface ElementPattern {
  relates?: "child";       // combinator to the parent level
  tag: string;
  attributes: PatternAttribute[];  // { name, value?, selectionType? }
  classes: PatternClass[];         // { class, selectionType, length }
  pseudo: PatternPseudo[];         // { name, value? } — nth-child, contains, ...
}
```

`selectionType` is `"exact" | "prefix" | "suffix" | "partial"` — set
whenever a configured Partial Selector function anchors on a substring of
the original value rather than the value itself (classified by whether the
original starts/ends with the returned substring).

**Order is baked into every pattern, not a separate concept.** Real
`initNthChild` (module 65913) pushes a `{name: "nth-child", value: <1-based
index among ALL sibling elements>}` pseudo entry onto every captured
pattern, unconditionally — CSS `:nth-child`, not per-tag `:nth-of-type`.
This has a real, confirmed consequence: **the literal captured path always
has positional information available as an implicit tiebreaker**, even
when no attribute distinguishes an element from its siblings. `find()`'s
own first strategy (`checkInitialPath`) can therefore succeed trivially via
embedded position alone — this is genuine real-algorithm behavior, not an
artifact of this reconstruction (see "A confirmed, reportable real-world
finding" below).

`ElementPath` is `ElementPattern[]`, root-to-leaf order (outermost
ancestor first, target element last) — matching real `createPath`'s
`unshift`-while-walking-up construction.

## Attribute classification — Ignore Selector, Partial Selector, Attribute Priority

Reconstructed from real `initAttributes`/`addAttribute` (module 65913) and
`defaultIgnore`/`initOptions` (module 92317) in
`health-attribute-classification.ts`.

**Shape**: Ignore Selector and Partial Selector are **functions keyed by
attribute name**, never a flat rule list:

```ts
type IgnoreFn = (name: string, value?: string, defaultFn?: IgnoreFn) => boolean;
type PartialFn = (name: string, value: string) => string | string[] | undefined;
```

**Precedence** (real `addAttribute`): for a given attribute, the **Partial
function is checked first**; only when it returns nothing does the Ignore
function get consulted at all. A Partial function returns the STABLE
SUBSTRING(S) to anchor on — not a boolean — and the engine classifies each
returned substring's relationship to the original value as prefix/suffix/
partial by whether the original starts/ends with it.

**Real default Ignore heuristic** — far coarser than "looks
machine-generated":

- A small attribute-name blocklist: `style`, `data-reactid`,
  `data-react-checksum`, `tabindex`, `apty-observer-added`.
- `id`/`for` values containing **2+ consecutive digits anywhere** — not a
  UUID/hex-run/all-numeric heuristic, just a bare digit-run check.
- Any attribute name containing `lnid` or `apty`, or prefixed `xmlns:`.
- Classes literally prefixed `tether` (a popup-positioning library Apty
  special-cases) — **nothing else about a class is excluded by default**.

Nothing else is excluded by default: an arbitrary `data-*` attribute, a
non-id/for attribute containing digits, or a class token that merely
*looks* generated is **included** by default unless Studio configuration
adds a rule for it.

**Real default Attribute Priority**: `["id", "class", "href", "src"]` —
**no built-in preference for `data-testid`/`aria-label`/`name`/`role` at
all**. Those only get tried before everything else when Studio
configuration adds them via `partialSelectorAttributes`, which always goes
first regardless of the priority list's own order (real `initAttributes`).

**A confirmed, reportable real-world finding**: because there is no
automation-hook preference by default, an incidentally-unique
framework-hashed class (e.g. styled-components' `sc-htpNat`) will be
selected over a `data-testid` automation attribute unless the customer's
Apty Studio configuration explicitly prioritizes it. `des-engine.golden-fixtures.test.ts`
has a test demonstrating exactly this on a synthetic Autodesk-style
fixture, plus the paired test showing the correct selector once
`partialSelectorAttributes: ["data-testid"]` is configured.

## The runtime recovery heuristic (`isValueDynamic`) is separate from Ignore

Used only during recovery (`findElement`'s first relaxation strategy),
never at capture time: `isValueDynamic(value)` is real Apty's cruder,
different check (module 81948) — a bare digit string, any run of 3+
consecutive digits, or more than half the characters being digits. This
means a value can be captured normally (not excluded by `DEFAULT_IGNORE`)
and still get relaxed away later if the literal captured selector fails to
resolve.

## Selector generation

`patternToSelector`/`pathToSelector` (real module 5757) always render the
**tag together with its attributes** — there is no special-casing that
drops the tag when an `id` alone would be unique. A real Apty selector for
`<button id="save-button">` is `button[id="save-button"]`, never a bare
`#save-button`. `pathToSelector` also explicitly clears the **first**
node's `relates` combinator before joining (every captured node carries
`relates: "child"` unconditionally; only selector generation later decides
whether a node ends up needing a leading `> `).

## Recovery — `findElement` (real `find()`, module 15906)

1. **`checkInitialPath`**: build one selector from the entire captured path
   as-is, `querySelectorAll`, cap at 50. If exactly one match and it is
   rendered, accept immediately — no scoring needed.
2. Otherwise, score every candidate via `diffScore` (below), then run
   exactly **four** relaxation strategies in order, re-scoring and
   re-ranking after each:
   - **`dropDynamicValues`** — drop attribute/class values `isValueDynamic`
     flags, at every level of the path.
   - **`dropPositionalPseudo`** — drop `nth-child`/`nth-of-type` pseudo
     entries at every level.
   - **`dropOneAncestor`** — drop exactly **one** ancestor level at a time
     (never cumulative), stripping combinator/pseudo info from the rest,
     unioning matches across every single-drop attempt.
   - **`leafFieldCombinations`** — leaf only, no ancestor context; every
     size-≤2 combination of dropped attribute/class/pseudo fields.
   After each strategy, the first RENDERED candidate scoring **≥0.92**
   is accepted immediately.
3. Once every strategy is exhausted or the pool hits the 50-candidate
   ceiling: take the best-scoring RENDERED candidate if it clears **0.90**;
   else the single best-scoring candidate overall if it clears 0.90; else
   `null`.

**There is no `AMBIGUOUS`/`WRONG_TARGET` state in the real algorithm** — a
unique top-scorer above the floor simply wins, full stop.

**A confirmed, reportable real-world finding**: `find()` explicitly prefers
a *rendered* candidate over an unrendered one at equal or higher score.
This means a hidden true target can lose to a visible, structurally
identical twin — `des-engine.test.ts` has an invariant test proving this
exact scenario is real, faithfully-reproduced algorithm behavior, not a
bug in this port.

## Scoring — `diffScore`/`patternDiffScore`/`arrayDiffScore` (real module 17851)

A **Dice-coefficient-style diff ratio** (`2 × exact-match-intersection /
(|a| + |b|)`), **never Jaccard**:

```
arrayDiffScore(a, b) = 2 × |exact-equality intersection of a and b| / (|a| + |b|)

patternDiffScore(A, B) = (7×tagMatch + 1×attrScore + 1×classScore + 1×pseudoScore) / 10
  — tag weighted 7x; attributes/classes/pseudo each weighted 1x.
  — pseudo carries BOTH order (nth-child) and text-content (:contains)
    signals at the same weight as any other pseudo fact — there is no
    separate "order" or "accessibility" axis.

diffScore(pathA, pathB) = (1×ancestorSequenceScore + 3×patternDiffScore(leaf)) / 4
  — the leaf is weighted 3x the whole ancestor chain.
```

`ancestorSequenceScore` is a **greedy sequential best-match alignment**
(each ancestor from the shorter chain matched to its best-scoring
remaining candidate further along the longer chain, consuming forward —
never backward), not a naive index-paired comparison. This is what lets an
inserted or removed ancestor wrapper degrade the score gracefully instead
of catastrophically.

## DOM Health's evidence layer (`health-selector-engine.ts`)

`resolveElement` combines two real algorithms, each answering a different
question, then adds one evidence layer DOM Health needs that the real
product doesn't expose:

- **`findElement`** answers "does this resolve to the correct live element
  at all" — `WRONG_TARGET` (the real algorithm's actual pick differs from
  the known live target), `NOT_RESOLVED` (real `find()` returned `null`),
  and this package's own **`AMBIGUOUS`** risk flag (the top two
  above-floor candidates score within 0.03 of each other — a deliberately
  thin margin chosen to flag genuine fragility, not every ordinary
  multi-candidate search) all come from it.
- **`generateMinimalSelector`** answers "how was it identified" —
  `DIRECT_SUCCESS`/`RECOVERED_BY_PARTIAL`/`RECOVERED_BY_IGNORE`/
  `RECOVERED_BY_CONTEXT`/`POSITIONAL_ONLY` come from it, because real
  Apty's own `checkInitialPath` always has `nth-child` baked into its
  literal path (see above), so "which raw `find()` strategy technically
  produced the winning candidate" does NOT cleanly separate "identified by
  a stable attribute" from "identified only by position."
  `generateMinimalSelector` — which tries non-positional identification
  first and only falls back to `nth-child` when nothing else works — is
  the correct instrument for that distinction:
  - No ancestor climb, single attribute, exact match → `DIRECT_SUCCESS`.
  - No ancestor climb, single attribute, non-exact (`selectionType !==
    "exact"`, i.e. a configured Partial Selector function actually fired)
    → `RECOVERED_BY_PARTIAL`.
  - No ancestor climb, multiple attributes combined (none alone was
    unique) → `RECOVERED_BY_IGNORE`.
  - Every level's own disambiguation was purely positional (no attribute
    EVER contributed at any level, even after climbing) → `POSITIONAL_ONLY`
    — checked *before* the ancestor-climb check, since a climb whose every
    level fell back to `nth-child` is still purely positional, not
    "context recovery".
  - An ancestor climb where some level's own attribute genuinely helped →
    `RECOVERED_BY_CONTEXT`.

This mapping is DOM Health's own reporting taxonomy, not literally Apty's
internal state — it is derived honestly from the real algorithm's actual,
observable decisions (which attribute/level actually carried the
disambiguation), never invented independently of it.

## Frame and Shadow DOM boundaries

Unchanged from the previous design and still correct: `root.querySelectorAll`
naturally cannot see into a different `Document`, so passing the correct
frame's document/open-shadow-root as `root` is sufficient. An open shadow
root is just another `ParentNode`. A closed shadow root is a real browser
security boundary this engine cannot see through — callers that already
know a target lives behind one pass `ResolveElementOptions.inaccessibleReason`,
and the result is `INACCESSIBLE`, never silently converted into a failure.

## Known limitations and explicit scoping decisions

- **`generateMinimalSelector`'s exact trim ordering is a best-effort
  reconstruction**, not a byte-exact port — see above.
- **`checkContainersScore`/`getContainerSelectors`** (real module 74456 —
  a runtime "is a previously-resolved selector still contextually sound"
  gate, checking whether enough originally-captured ancestor-container
  selectors still resolve to something) are implemented and tested, but
  **not yet wired into `health-collector.ts`'s per-round resolution flow**
  — each round currently re-resolves fresh via `findElement` rather than
  verifying a stored round-1 selector+containers snapshot against round 2/3.
  Wiring that in is a real, valuable extension (closer to how Apty
  actually re-checks a target at runtime) that was not in scope for this
  pass.
- **Real Autodesk/Infor LN/Athena validation has not been performed**
  against a live instance of any of these applications — this sandboxed
  session has no browser, credentials, or network path to one. The golden
  fixtures in `des-engine.golden-fixtures.test.ts` are synthetic DOM shapes
  inspired by publicly-observable patterns in that class of application,
  never claimed to be captured from, or to represent, any real customer
  DOM.
- **The real Apty Studio/Client extensions expose no cross-extension API**
  for a third-party tool to pull live selector configuration from — see
  `docs/integrations/apty/README.md` and `DECISIONS.md` for the confirmed,
  Apty-side-only fix this requires. DOM Health's `ResolveElementOptions.desConfig`
  is the clean adapter boundary for when that configuration becomes
  available (from a real Studio export, a future integration, or manual
  entry) — it is real, tested plumbing, not a placeholder.
