# Apty element selection, DES and hit testing in DOM Health

DOM Health scores how reliably Apty can find and use the elements of an
application. To do that it runs Apty's own algorithms, ported from the
Apty DAP source (`lib-client-element-identification`,
`lib-client-utilities`). An earlier version reconstructed them from the
minified Studio build 63. Every behavior below has now been checked
against the source, and the port follows the source where the two
disagreed.

| What | Apty source | Port |
| --- | --- | --- |
| Selector generation (capture) | `selector.ts`, `match.ts`, `optimize.ts`, `pattern.ts`, `css.ts` | `apty-selector.ts` `captureSelector` |
| Lookup (playback) | `element-identification.ts` `getIdentifiedElement`, `containers.ts` `selectElementRoot` | `apty-selector.ts` `playSelection` |
| Ignore / Partial / Priority defaults | `options.ts`, `pattern.ts` | `health-attribute-classification.ts` |
| Dynamic Element Selection (DES) | `path.ts`, `find.ts`, `strategies.ts`, `diff.ts` | `des-engine.ts` |
| Hit test | `element-visibility.service.ts` | `health-hit-testing.ts` |

## What the Apty 5.x player actually does

Studio stores, per step, the CSS selector its picker generated
(`pickedSelector`), one selector per shadow host above the element
(`shadowRootSelectors`) and one per frame level (`iframesPath`). The
player queries the stored selector and takes **the first rendered match,
else the first match**. It does not search for the element again.

DES, the scored path matching in `find.ts`, is a fallback the player
keeps off. The application mapper hard-codes
`useDynamicElementSelectionAsFallback: false`, and 5.x steps store no
path. DOM Health therefore scores the stored selector and its lookup.
DES is kept to say what that fallback would do.

## Capture: `captureSelector` (`match` + `optimize`)

`match` walks up from the element to the root:

1. **Global**: add the element's attributes one at a time in priority
   order (`checkAttributes`). As soon as the tag plus the attributes so
   far is unique under the root, the walk ends there. Otherwise, if the
   tag alone is unique (`checkTag`), it ends there.
2. **Local**: otherwise, make this level unique within its parent, trying
   in turn:
   - its attributes;
   - its tag;
   - for the target only, a descendant: `:has(> a[data-uid="…"])`, with
     descendants that carry a priority attribute tried first, at most 200,
     and none that is positional;
   - finally its position, `> :nth-child(n)`.

   Then the walk moves to the parent.

"Unique" is `elementMatches`: one match, or exactly one *rendered* match
when not strict. Frame selectors use strict uniqueness.

`optimize` then drops every level the selector does not need, and tidies
the first and last levels. The tidy-up steps, in order:

- reduce attributes to presence (`[id]`), except attributes the
  application declared as identity, meaning its configured priority and
  partial-selector attributes;
- remove attributes;
- turn `>` into a descendant combinator;
- trim `:has`;
- turn `nth-child` into `nth-of-type`;
- drop the longest classes.

Two consequences matter for scores:

- The only element of its tag reduces to the bare tag. On a page with
  one button, the stored selector is `button`.
- Studio captures against `document`, and `document.querySelectorAll`
  cannot see into a shadow root. Inside a shadow root no level is ever
  globally unique and nothing is optimized away. The selector is the full
  chain of locally unique levels up to the shadow root, e.g.
  `div button[name="go"]`.

The optimizer's 1-second-per-query bailout is not ported, so results do
not depend on timing.

## Playback: `playSelection`

The player looks the element up in this order:

1. Open each shadow host in turn, taking the **first** match of its
   selector, through `host.shadowRoot`.
2. A missing host, or a closed root (`shadowRoot` is `null`), makes Apty
   fall back to the document.
3. Query the element's selector and take the first rendered match, else
   the first.

## Attribute classification

The defaults (`options.ts` `defaultIgnore`) are deliberately coarse:

- the attributes `style`, `data-reactid`, `data-react-checksum` and
  `tabindex`, which an application re-enables by listing them in its
  priority (`OVERRIDABLE_IGNORED_ATTRIBUTES`);
- always: `apty-observer-added`, `data-apty-qa` and `data-apty-qa-state`;
- `id` and `for` values with two or more consecutive digits;
- names starting `xmlns:` or containing `lnid`;
- class tokens starting `tether`.

Corrections against the build-63 reconstruction:

- Names containing `apty` are **not** ignored.
- Classes take two passes. The attribute ignore sees the whole `class`
  value, and a hit drops every class on the element. Then each token goes
  through the class ignore. The reconstruction passed the whole value to
  the class ignore and never applied `tether*` per token.
- A partial selector part that keeps the start or end of a class value is
  rendered `[class^="…"]` / `[class$="…"]`, never `.part`.
- With no priority configured, the library's default is
  `['id', 'class', 'href', 'src']`. Application-type presets replace it:
  - Generic and Oracle: `aria-label,title,href,id`;
  - Salesforce: `href,title,id`;
  - Workday: `data-automation-id,id,href`.

A Partial Selector is checked first for each attribute. A non-empty
result bypasses every ignore rule. Each returned part becomes `^=`, `$=`
or `*=` by where it sat in the value. The suffix check runs before the
prefix check, and a part equal to the whole value stays exact.

### The Agent's audit profile (`health-audit-profile.ts`)

DOM Health audits with `AUDIT_DES_CONFIG`, Apty's defaults extended
through Apty's own hooks:

- Angular build-numbered and version attributes are ignored.
- Generated ids (`looksDynamic`) are ignored.
- Private attributes (`value`, secret-shaped values) are never used.
- Duplicate ids are not used for the elements that share them.
- State, environment, build and generated class tokens are dropped. This
  now goes through the per-token class hook, so the remaining tokens stay
  `.token` classes. The port hands the hook the whole class value, so it
  can recognise a styled-components partner next to its `sc-` id.

Reports name the profile.

## DES: `findElement` (the dynamic fallback)

The fallback works in three steps:

1. **Fingerprint**: `buildElementPath` follows `createPath`. Each level,
   up to `<body>` or a scope root, records its tag, every non-ignored
   attribute and class, and its `nth-child`.
2. **Exact path**: `findElement` first queries the path unchanged. A
   single rendered hit is returned.
3. **Strategies**, run in order:
   1. `checkSimplifyDynamic`: drop the values `isValueDynamic` flags (all
      digits, three digits in a row, or more than half digits);
   2. `checkSimplifyNth`: drop the nth pseudo-classes;
   3. `checkContainers`: remove one ancestor at a time;
   4. `checkDirectElement`: the last pattern alone, unmodified first, then
      minus every subset of one or two of its fields.

   After each strategy, the first rendered candidate scoring at least
   0.92 is accepted. Once the strategies are exhausted, or 50 candidates
   are held, the result is the first rendered candidate scoring at least
   0.90, else the best such candidate, else none.

Scores, from `diff.ts`:

```
arrayDiffScore(a, b)   = 2 × |intersection| / (|a| + |b|)    (1 when both are empty)
patternDiffScore(A, B) = (7 × tag + attributes + classes + pseudo) / 10
diffScore(pathA, pathB) = (containers + 3 × element) / 4
```

Containers are aligned greedily. `containerMaxScore` reports a best match
after the first one position early, so the next ancestor may match the
same container again. The port keeps that, because the score has to be
the one Apty computes. Fidelity fixes made against the source:

- `checkDirectElement` tries the unmodified leaf first;
- the container index follows the source;
- `getScopeRootForElement` uses `closest()`, the element itself included.

`checkContainersScore` uses Apty's threshold of 75, which Studio reads as
0.75. 5.x steps store no containers, so it never fails in practice.

## Hit test (`ElementVisibilityService`)

The hit test runs in this order:

1. `checkVisibility` with opacity. A transparent element is hidden here,
   though selection's rendered check ignores opacity.
2. Nothing is sampled when the rectangle lies entirely outside the
   viewport.
3. A 3x3 grid is sampled at the cell centres: 1/6, 1/2 and 5/6 of the
   width and height.
4. Each point uses `elementsFromPoint` of the element's **own** root.
   `document.elementsFromPoint` stops at a shadow host.
5. `apty-studio-extension`, `apty-content-items` and `apty-widget` are
   looked through.
6. A point passes when:
   - nothing is there;
   - the top hit is `apty-visibility-ignore-element` content;
   - the top hit is the element, or inside it;
   - the top hit is anywhere inside the element's parent. Composite
     fields overlay their own trigger icons.
7. The element is visible at 6 of 9 points (`2 / 3`).

DOM Health adds two things. Overlays from the ignored-root policy are
looked through, and a rendered element with no width or height is
`zero-size`.

The classifications follow the point count:

| Points | Classification | Apty's verdict |
| --- | --- | --- |
| 9 | fully targetable | visible |
| 6–8 | partially targetable | visible |
| 1–5 | mostly occluded | not visible |
| 0 | fully occluded | not visible |

The previous version sampled 25/50/75%, passed any ancestor of the
element, failed points with no hit, treated `aria-hidden` as hidden and
passed at 5 of 9.

## DOM Health's evidence layer (`health-selector-engine.ts`)

`resolveElement` captures the selector as Studio would, then looks it up
in the element's own root as the player would:

| Lookup result | Outcome |
| --- | --- |
| nothing | `NOT_RESOLVED` |
| another element | `WRONG_TARGET` |
| the element, first among several rendered matches | `AMBIGUOUS` |
| the element, selector positional anywhere | `POSITIONAL_ONLY` |
| the element, a partial selector part | `RECOVERED_BY_PARTIAL` |
| the element, an ancestor level or a `:has()` descendant | `RECOVERED_BY_CONTEXT` |
| the element, several conditions on its own level | `RECOVERED_BY_IGNORE` |
| the element, one condition or the tag | `DIRECT_SUCCESS` |

`resolveInComposedTree` handles elements inside shadow roots:

- It grades the element by its weakest hop.
- It replays the whole selection from the top of the document, because
  hosts are opened by their first match.
- An element inside a closed shadow root is `INACCESSIBLE`. Apty's picker
  stops at the host, and its lookup cannot open the root.

### Cross-state replay

Each element's stored selection is replayed at later snapshots and
application states, through `ElementRef` v2 `selection`, with
`verifyStoredSelection`. The lookup is the player's. The element it
returns must carry the same logical fingerprint. Verdicts:

| Verdict | When |
| --- | --- |
| `HOST_NOT_RESOLVED` | A host has no open root |
| `NOT_RESOLVED` | The lookup returns nothing |
| `WRONG_TARGET` | The lookup returns another element |
| `AMBIGUOUS` | The element came first among several rendered matches |
| `POSITIONAL_STABLE` | The selector depends on position |
| `RECOVERED_STABLE` | Only the rendered preference picked the element out of several matches |
| `DIRECT_STABLE` | None of the above |

A version 1 ref, with DES paths only, is still replayed through
`findElement`.

### Frame selectors

The collector also generates the strict frame selector Studio stores for
each `<iframe>` and `<frame>` of a document (`iframesPath`). It counts
those that depend on position or on `src`, and the score reports them as
the `frame-selectors` risk.

## Performance

Capture runs many uniqueness queries per element. `isElementRendered` is
cached per collection round (`resetDesPerformanceCaches`), and replay
clears the cache first. jsdom evaluates positional selectors tens of
times slower than Chrome, so unit tests that only check coverage avoid
positional fallbacks.
