/**
 * Identifier shapes observed in real customer DOM exports, for classifier
 * and identity tests. These are the generated / structural values only,
 * never the customer data around them (see README.md for what was
 * redacted), so a pattern test asserts against a value production actually
 * emitted rather than one written to fit the pattern.
 *
 * Sources:
 * - "LN export": the attached Infor OS Portal top document (837,654 bytes),
 *   measured with a parser that tracks declarative shadow roots.
 * - "athena exports": the three athenaOne exports pasted into the DOM Health
 *   brief (global frameset, Patient Registration panel, search-menu state).
 * - "brief 2.1": values quoted in section 2.1 of the brief from an Infor
 *   export that was not attached (the Factory Track app frame).
 */

/** Infor OS Portal / LN. */
export const INFOR = {
  /** Classes on `<html>` in the LN export: browser, OS and theme. */
  rootEnvironmentClasses: ["is-chrome", "is-mac", "theme-new-light"],
  /** Angular view-encapsulation attribute names; the number is per build. 508 occurrences in the LN export (170 as attributes, 25 distinct, the rest in inline CSS). */
  angularScopedAttributes: [
    "_ngcontent-ng-c1137233439",
    "_nghost-ng-c1137233439",
    "_ngcontent-ng-c2000688275",
    "_nghost-ng-c349936244",
  ],
  /** Angular animation-namespace class on the active tab (`portal-tab-item`), same per-build number family. */
  angularAnimationClass: "ng-tns-c349936244-0",
  /** SVG `<clipPath>` ids. The current heuristic flags `clip0_111_14045` but not `clip0_5976_20`. */
  svgClipIds: [
    "clip0_111_14045",
    "clip0_5976_20",
    "clip0_72104_27321",
    "clip0_99_3829",
  ],
  svgGradientId: "paint0_radial_99_3829",
  /** 16-character ids on two masthead buttons (tenant-specific values replaced with same-shape fakes). Stability across sessions and tenants unknown: they are recorded, not classified. */
  opaqueButtonIds: ["QWERT0YUIOP1ASDF", "ZXCVB2NMLKJ3HGFD"],
  /** The LN application iframe as exported (tenant/session/GUID values replaced with same-shape fakes). */
  lnFrame: {
    title: "LN",
    name: "LN_44_11111111-2222-4333-8444-555555555555",
    ospId: "LN",
    srcParams: ["inforTenantId", "inforSessionId", "LogicalId"],
  },
  /** The Factory Track app frame quoted in brief 2.1 (export not attached; tenant/GUID replaced with same-shape fakes). */
  factoryTrackFrame: {
    title: "Factory Track",
    name: "ft_45_22222222-3333-4444-8555-666666666666",
    ospId: "ft",
    src: "https://ft.example.test/WSWebClient/session/open?tenant=FAKETENANT000000_TRN",
  },
  /** Attribute names that are not valid CSS identifiers, emitted by Angular template refs and an IDS template. */
  invalidCssAttributeNames: ["#frameview", '"'],
  /** Version-carrying attributes on the root and Angular host. */
  versionAttributes: [
    "data-sohoxi-version",
    "data-ids-enterprise-ng-version",
    "ng-version",
  ],
  measured: {
    exportBytes: 837_654,
    idAttributes: 990,
    classAttributes: 541,
    classTokens: 805,
    angularScopedOccurrences: 508,
    openShadowRoots: 251,
    maxShadowNesting: 3,
    slots: 358,
    /** Page-wide: the same id value appears more than once anywhere in the document, shadow roots included. */
    duplicateIdValuesPageWide: 15,
    /** Root-scoped: duplicated within one document or shadow root, the only kind that breaks `#id` lookups. */
    duplicateIdValuesWithinARoot: 9,
    formControlsInTopDocument: 0,
    elements: 3788,
  },
} as const;

/** athenaOne. */
export const ATHENA = {
  /** react-aria ids, both the `:r0:` and the long `:IXP0RLQXNUQr6:` forms. */
  reactAriaIds: [
    "react-aria6837631407-:r0:",
    "react-aria1032512484-:r1:",
    "react-aria6745925057-:IXP0RLQXNUQr5:",
    "react-aria6745925057-:IXP0RLQXNUQr6:",
  ],
  /** react-select instance ids (instance token, then a role suffix). */
  reactSelectIds: [
    "react-select-94dJfC-input",
    "react-select-TXQoB6-live-region",
    "react-select-94dJfC-placeholder",
    "react-select-b2qe-m-input",
  ],
  /** A bare GUID used as an SVG `clipPath` id. */
  bareGuidId: "f1e87cfe-2c7c-4555-baab-9c1c28c334a9",
  /** Emotion (CSS-in-JS) classes: the hash is mid-token, the stable stem (when any) is the suffix. */
  emotionClasses: [
    "fe-c-7pg0cj-a11yText",
    "fe-c-3iigni-container",
    "fe-c-16xfy0z-control",
    "fe-c-1mkvw8y",
    "fe-c-1xc3v61-indicatorContainer",
  ],
  /** styled-components pairs: the `sc-` component id and its generated class. */
  styledComponentsClasses: [
    ["sc-bdvvtL", "goIptw"],
    ["sc-eCImPb", "hyZcLS"],
    ["sc-gsDKAQ", "erBbkF"],
  ],
  /** Forge state classes. `fe_is-disabled` occurs 65 times in the Patient Registration export (brief 2.2). */
  stateClasses: ["fe_is-disabled", "fe_is-required"],
  /** Classes on `<html>` in both frameset exports. */
  rootEnvironmentClasses: ["standards", "preview-background"],
  /** On `#tasknotifier` in the search-menu export (not on `<html>`, as the brief says). */
  browserClass: "safari",
  /** Package-version classes on every Nimbus app root; they change with each release. */
  packageVersionClasses: [
    "anet-bookmark--2_1_0",
    "react--18_2_0-jsx-runtime-client",
    "forge--17_1_0",
    "express-patient-registration-ui--2_2_0",
  ],
  /** Pendo digital-adoption overlay. */
  pendoIds: [
    "pendo-image-badge-5762de01",
    "pendo-image-badge-ac81378a",
    "_pendo-badge_2kHDZJNfO4ClXH-2ZnYuy6eYB_8",
    "_pendo-badge_1m3Z0eE6F0F7-Yh_3mf48pVQEUg",
  ],
  pendoClasses: ["_pendo-badge", "_pendo-badge_", "_pendo-image"],
  /** Frame element ids in the global frameset. They are ids, not names; none has a `src` attribute in the export (the app navigates them from script). */
  frameIds: ["GlobalNav", "GlobalWrapper", "Status"],
  /** Hidden menu shims, one per open menu. */
  shimFrameIds: ["searchmenuiframe", "patientsmenuiframe"],
  shimFrameClass: "shimiframe",
  /** Practice id and department as URL path segments (practice id replaced with a same-shape fake). */
  practicePathSegments: ["4242424", "2"],
  /** Counts as reported in brief 2.2. The athena exports were pasted into the brief, not attached as files, and were not re-measured here. */
  measured: {
    globalFrameset: { ids: 15, classes: 152 },
    patientRegistration: { ids: 67, classes: 821, feIsDisabled: 65 },
    searchMenuState: { ids: 29, classes: 185 },
  },
} as const;
