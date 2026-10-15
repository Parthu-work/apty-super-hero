# Real-tenant validation (athenaOne and Infor LN)

DOM Health was built from redacted DOM exports and tested in Chromium on
stand-ins of the application shapes. It has not been run on a live
tenant (see "Known limitations" in
[`dom-health-architecture.md`](dom-health-architecture.md)). This protocol
collects the evidence that decides the open questions. Nothing in it tunes
a threshold; tuning happens after bundles come back.

## Before you start

- Use a **test tenant or non-PHI data only**. The bundle is built from an
  allow-list and strictly redacted, but the screens you open still show
  their data to you and to the AI provider if you chat while testing.
- Load the extension build under test. In Settings → Troubleshooting turn
  on **Developer tools**. That shows the route probe in the DOM Health card
  and the threshold-overrides field.
- Leave **DOM Health: threshold overrides** empty unless the Apty
  engineering team asks you to try a value. Every override in effect, and
  every one rejected, is listed in the audit result and the bundle.
- Leave the page script on (Settings → Troubleshooting, "Track client-side
  routing…"); without it routing cannot be measured.

## Screens

**athenaOne**

1. The frameset home (the `GlobalNav` / `GlobalWrapper` / `Status` frames).
2. Patient Registration (the Nimbus panel in a shadow root).
3. A screen reached by a `pushState` route (open one from the menu; the
   URL path changes without a page load).

**Infor LN**

1. The Infor OS Portal shell, before opening LN.
2. LN content after a menu click (the app frame keyed by `data-osp-id`).

On each screen:

1. Click **Check DOM Health** in the DOM Health card and wait for the
   result.
2. On the last screen of each application also run **Audit Application**
   (Safe link discovery first; Deep state discovery only on a test tenant).
3. Start the **route probe**, click through two or three menu entries
   yourself, then stop it.
4. Click **Export validation bundle**. Read the JSON in "Review before
   sharing", then **Download**. Name the file after the screen.

## Checks

Note each as pass or fail, with the bundle field that shows it:

| Check | Where in the bundle |
|---|---|
| No "none of the frames responded" | `page.frameAccessibility.framesFailed` below `framesTotal`; each failed frame has an `error` |
| The application frame is scored; navigation and status frames are not | `page.frames[].role` is `application` with a `score` for `GlobalWrapper` / the LN frame, `chrome` without one for the others |
| Pendo and chat launchers are counted as overlays | `page.overlays[]` lists their matchers with `evidence` |
| Same-URL screens are found as separate states | `application.states.count` above 1 with `application.traversal.mode` `click-first` on LN |
| The audit stays within budget | `page.performance.withinBudget` is `true`, `partialReasons` empty |
| The route probe identifies screens | `routeProbe.analysis.hint`, and which hashes change between steps |

Also note, by looking at the page, what the bundle cannot say: whether
selected menu items carry `fe_is-selected` or `fe_is-active`, and whether
Pendo opened inside a frame.

## Infor LN re-run with 0.1.0 (prepared, not run)

The first LN bundle led to four owner-approved rule changes. This re-run
checks them on the same tenant. A person with LN test-tenant access runs
it; no one has yet.

1. Build: the `apty-agent-v0.1.0.zip` release package (or
   `npm run build` at the release commit), loaded unpacked in a fresh
   Chrome profile. Note the commit and Chrome version.
2. Settings: Developer tools on, threshold overrides empty, page script on,
   redaction Strict.
3. Screens: the two LN screens above, plus the screen where the first
   bundle showed hidden menu items.
4. On each screen, the four steps above (Check DOM Health, Audit
   Application on the last screen with Deep state discovery, route probe,
   export the bundle).

Record, per change, pass or fail and the bundle field:

| Change from the first LN bundle | Pass when | Where |
|---|---|---|
| A click that opens nothing is explored, not a failure | Its page has `status: explored-no-new-state`; `pagesExploredNoNewState` is at least 1 and `pagesNotDiscovered` is 0 | Bundle: `application.pages[]`, `application.coverage` |
| An empty `about:blank` frame is a placeholder | `framesPlaceholder` is at least 1 and that frame is not counted in `framesFailed` | Bundle: `page.frameAccessibility` |
| Duplicate ids appear as a risk in the application view | The risks list names duplicate ids | DOM Health card, application result (not in the bundle) |
| Hidden menu items are left out of hit testing | They are counted as hidden, and none of them as not targetable | DOM Health card, hit-test details (not in the bundle) |

Also record the six checks in "Checks" above.

**Where:** add a row to the table below in a pull request, and send the
bundles through the channel in "What to send back". Never commit a bundle.

| Date | Tester | Commit | Chrome | Screens | Four changes (pass/fail each) | Six checks | Bundles sent to |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## What the bundle holds, and what it does not

Holds: schema `apty-dom-health-validation/1`, extension and Chrome
versions, hostnames, URL templates (origin, path with identifiers masked
as `:id`, hash route; never a query), the frame tree with keys from
structural attributes only (`data-osp-id`, `id`, `name`; a title key is
kept as a hash), roles and why, frame failures, counts and coverage,
confidence caps, overlay matches with their evidence level, virtualized
list counts, timings against the budget, every threshold with its value,
default and whether it is unverified, active and rejected overrides, and
the route probe's signals as hashes and counts.

Never holds: element text, input values, page titles, record numbers,
cookies, full URLs or queries. Every string goes through the DOM Health
exit redaction and strict contract redaction whatever the redaction mode
setting is.

## What to send back

The downloaded bundles, one per screen, and the pass/fail table above with
anything the page showed that the bundle could not. Send them through the
channel the Apty engineering team gives you, not in a public issue.

## After the bundles come back

Engineering turns each bundle into a fixture skeleton:

```bash
node tooling/scripts/bundle-to-fixture.mjs athena-registration.json athena-registration
```

That writes `<name>.html` (the frame tree and overlay placeholders, hosts
replaced with `*.example.test`) and `<name>.values.json` under
`packages/dom-snapshot/src/__tests__/fixtures/erp/`, and a
`<name>.fixture.test.ts` stub with one `it.todo` per check, beside the
other fixture tests. It refuses to overwrite files. Fill the skeleton
from a redacted DOM export and continue with section 9 of the
[onboarding runbook](dom-health-onboarding-runbook.md). Only then are
thresholds changed, in `packages/browser-runtime/src/apty/dom-health-thresholds.ts`,
with the bundle that justifies each change.
