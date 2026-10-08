# ERP regression fixtures

Small, redacted extracts of real customer DOM exports. The DOM Health work
packages test against them, so every heuristic is checked against
markup production actually emitted. They are not the exports themselves.
Each file keeps the structure that matters (tags, attributes, generated
identifiers, shadow roots, slots, frames) and drops the rest: most SVG path
data, inline CSS and repeated rows.

`values.ts` holds the generated and structural identifier shapes from the
same exports, together with the counts measured on them.

## Provenance

| Fixture | Source | Kept because |
|---|---|---|
| `infor-portal-workspace.html` | Infor OS Portal top document, LN workspace (837,654-byte export attached to the DOM Health brief) | Angular `_ngcontent-ng-c*` / `_nghost-ng-c*` attributes; `portal-workspace` with `ygtrackview` / `ygtype`; the LN app iframe with `title`, a counter + GUID `name`, a tenant- and session-bearing `src` and `data-osp-id`; `is-chrome is-mac theme-new-light` on `<html>`; SVG `clip0_*` ids; the export's duplicate-id layout (15 values duplicated page-wide, 9 of them within one root) |
| `infor-ids-shadow.html` | Same LN export: the theme switcher, GenAI button and About dialog | IDS Enterprise components with declarative shadow roots nested 3 deep, `<slot>` projection (label text in the host's light DOM, control in the shadow root), the only `<h1>` inside an `ids-text` shadow root |
| `athena-frameset.html` | athenaOne global frameset export (pasted into the brief) | `GlobalNav` / `GlobalWrapper` / `Status` iframes with no `src` (navigated from script), the `javascript:` URL assignment for `GlobalWrapper`, `top[...]` frame references, a `shimiframe`, react-aria portal ids, package-version classes, inline Datadog and Pendo scripts |
| `athena-forge-panel.html` | athenaOne "Patient Registration (New)" panel export | A Nimbus micro-frontend inside an open shadow root of a plain `div`; react-aria ids in both forms, react-select ids, Emotion `fe-c-*` classes, styled-components `sc-*` pairs, `fe_is-disabled` / `fe_is-required`, a bare-GUID `clipPath` id, Pendo badges inside and outside the shadow root, PHI-adjacent form fields (`#legalSex`, `firstName`, `dob`) |
| `athena-search-state.html` | athenaOne search-menu-state export | The post-interaction state: the selected `Patients` menu component, sized `shimiframe`s, the search menu rows, `standards preview-background` on `<html>` |

## What was redacted

Replaced with obviously fake values of the same shape:

| Real value | Replacement |
|---|---|
| athenaOne username (`p-` + name) in the Pendo visitor id and the task notifier text | `p-fakeuser` |
| Practice id (7 digits) in URL paths, the title and the Pendo account id | `4242424` |
| Practice name and department in `document.title`, and the practice location in the version easter egg | `Example Practice - Texas`, `EXAMPLE SPECIALTY CENTER`, `EXSC North Branch` |
| Datadog client token (`pub` + 32 hex) and application id (GUID) | `pub` + 32 zeros, a zero GUID |
| Pendo API key and guide-media paths | zero GUIDs on `example.test` hosts |
| Patient-search text in the search menu | `123456` |
| Infor tenant id (16 characters + `_TRN`) in `inforTenantId` / `inforSessionId` | `FAKETENANT00000_TRN` |
| Infor session GUID, workspace GUID in the frame `name` and `data-osp-did` | zero / sequential GUIDs |
| Customer hostnames (tenant region hosts, CDN tenant paths) | `*.example.test` |
| Two 16-character masthead button ids, possibly tenant-specific | `QWERT0YUIOP1ASDF`, `ZXCVB2NMLKJ3HGFD` |

Input `value` attributes were already empty in every export and stay
empty. No patient data was present in the forms.

## Deliberate differences from the exports

- `infor-ids-shadow.html`: `hidden` was removed from `ids-theme-switcher`,
  so its button counts as rendered in jsdom. The popup menus keep their real
  `hidden`, so a selected item in a closed menu can be tested as not
  visible.
- `ids-about` (the About dialog holding LN's only `<h1>`) is a closed
  modal in the export, hidden by IDS stylesheets that jsdom does not load.
  In jsdom it counts as rendered; in the real portal the top document
  shows no heading at all.
- `infor-portal-workspace.html` shortens the masthead, tab bar and dashboard
  toolbar, but keeps every element that carries one of the 15 duplicated
  ids, in the same root as in the export.
- The brief says `safari` is on the root element of the search-menu
  export. It is on `#tasknotifier`; the fixture keeps it there.
- The brief's LN example frame is Factory Track (`data-osp-id="ft"`). The
  attached export contains the LN frame (`data-osp-id="LN"`) instead.
  `values.ts` carries the brief's Factory Track shape separately and marks
  it as not present in the attachment.

## Loading in tests

jsdom does not parse `<template shadowrootmode>`. Use `loadErpFixture()`
from `load-fixture.ts`. It parses the file into the test document and
attaches every declarative shadow root, nested ones included.
