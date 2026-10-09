# DOM Health: onboarding a new application

A short checklist for pointing DOM Health at an application it has not
seen. Each step says what to look at, where the code lives, and what
evidence to keep. The design is in `dom-health-architecture.md`; the
selector engine and the audit profile are in `des-engine.md`.

## 0. Ground rules

- Every new pattern, threshold or matcher cites the real value it came
  from in its docstring. One from general knowledge is marked unverified.
- Customer data never enters the repository. An export used as a fixture
  is redacted first: user names, tenant, practice and patient
  identifiers, tokens, customer hostnames. Use fake values of the same
  shape (`FAKETENANT000000_TRN`, `4242424`, zero GUIDs, `*.example.test`).
  See `packages/dom-snapshot/src/__tests__/fixtures/erp/README.md`.

## 1. Probe the routing signals

Turn on **Settings → Troubleshooting → Developer tools**, open the
application, and use the **Route probe** in the DOM Health card. Click
through about ten screens. For each click the probe records, per frame:

- the URL;
- the title;
- the owning frame element (`name`, `id`, `title`, `data-osp-id`);
- the first heading and active navigation item;
- the first API call or frame load;
- the `pushState` count.

Save the shareable report. It holds hashes and redacted text only.

Read the analysis:

- **URL changes per screen** → URL-first will work; `urlTemplate` must
  map two records of one screen to one template (step 3).
- **Only the heading or nav changes** → click-first; the traversal picks
  it automatically when the seed has few link targets or most transitions
  keep the URL (`traversal-strategy.ts`). Clicking still needs
  `discoveryMode: "application-deep"`.
- **Nothing changes** → identity rests on structure alone and every state
  is reported `low` confidence. Look for a heading or nav marker to add
  (step 4).

## 2. Frame identity

Run a single-page audit and open **Frames** in the card. Every frame
should have a stable key; `keySource: "position"` means none was found.

- An application that marks its frames with an attribute of its own (as
  Infor OS Portal does with `data-osp-id`): read it in
  `health-route-probe.ts` `frameOwnerOf`, carry it in
  `FrameOwnerAttributes` (`frame-identity.ts`), and add it to `frameKey`
  ahead of `title`, with a docstring citing the observed value.
- A frame name with counters or GUIDs: check `stableFrameName` strips them.
- Navigation or status frames: add their stable name to
  `CHROME_FRAME_NAMES` in `frame-identity.ts`. Hidden helper frames: extend
  `SHIM_PATTERN`.
- The shell around the application (no form controls, holds the app
  frame) is classified `chrome` automatically and not scored.

## 3. URL templates

Check the frame inventory's `urlTemplate`. Tenant, session, record and
per-user values must not appear:

- a tenant or session parameter with a new name: pass it in
  `UrlTemplateOptions.dropParams`, or extend `IDENTITY_FREE_PARAM_NAMES`;
- a tenant segment with a recognisable shape: extend `templateSegment`
  (see `INFOR_TENANT`);
- per-user parameters (theme, locale, version): extend
  `ENVIRONMENT_PARAM`.

## 4. Screen identity

In an application audit, `stateGraph.routeConfidence` counts states by
confidence. `low` states were identified by structure alone.

- A design-system "selected" class not matched by `ACTIVE_ITEM_SELECTOR`
  (`health-state-signature.ts`): add it with the observed value.
- A breadcrumb not matched by `BREADCRUMB_SELECTOR`: same.
- Content that changes on its own (a toast or ticker without ARIA live
  semantics): make sure it is excluded, or the states will multiply. The
  under-trigger bias must hold: a phantom state is worse than a missed
  one.

## 5. Generated and unstable values

Check `metricDetails.automaticSelection` and the element table for
selectors built on generated values.

- Generated ids or classes: add a pattern to `health-dynamic.ts` (ids) or
  `classifyUnstableClass` (class tokens), with the real value in the
  docstring, and a classifier test against it.
- Unstable attribute names: extend `isUnstableAttributeName`
  (`health-audit-profile.ts`).
- Never change `health-attribute-classification.ts` or `des-engine.ts`:
  they reproduce Apty Studio. The audit profile extends them through
  their hooks.

## 6. Overlays

Open **Frames and excluded content** in the card. Content that is not the
application (a guidance tool, chat, consent banner) must be listed as
excluded.

- For one customer: add a matcher in **Settings → Troubleshooting → DOM
  Health: content to leave out** (`id:prefix`, `class:prefix` or
  `tag:name`, one per line).
- For everyone: add it to `DEFAULT_IGNORED_ROOTS` in
  `packages/dom-snapshot/src/ignored-roots.ts`, with its evidence
  (`measured` with the observed value, or `unverified`).

## 7. Privacy check

Before sharing any result from a new tenant:

- search the tool result for the tenant id, practice or account numbers,
  user names and tokens;
- if the application marks private content for its own session replay
  with a marker not in `PRIVATE_CONTAINER_SELECTOR` (`health-privacy.ts`),
  add it.

## 8. Performance

Check `performance` in the result:

- `partialReasons` must be empty on a normal page;
- `longestSliceMs` should stay near `limits.sliceMs`.

A page past the limits returns a labelled partial result. Raise a limit
only with the measured page size in the commit message.

## 9. Lock it in

Add a redacted fixture of the new shape under
`packages/dom-snapshot/src/__tests__/fixtures/erp/`, with its measured
values in `values.ts`. Add the tests that fail without your change, and
an end-to-end stand-in in `tooling/e2e/dom-health-apps.e2e.test.mjs` if
the application has a new shape.
