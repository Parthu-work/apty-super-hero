# Phase C (do not start until Phase B is approved and the owner says "continue")

- M1 request-size regression gate: `tooling/e2e/request-budgets.json` with
  10% headroom, checked against the harness numbers.
- M2 masking proof e2e: one fixture page with many PHI-like strings, every
  reading tool exercised, asserts none leak in Strict.
- M3 documentation: `docs/security/DATA_FLOW.md`,
  `docs/development/REQUEST_ANATOMY.md`, `PRIVACY.md` updates,
  `npm run audit:docs-links`.

## As built

- M1: `tooling/e2e/request-budgets.json` holds the 11 named requests' sizes as sent plus 10%. The request-anatomy scenarios test fails when one grows past its budget or has none (shown failing with the casual budget set to 1,200 under its 1,259).
- M2: `tooling/e2e/masking-proof.e2e.test.mjs` puts PHI-like strings in every place PRIVACY.md says Strict masks (URL query and path, title, email, MRN, token, JWT, form values, a select, a contenteditable region, console and network) and runs all nine reading tools in one chat. It found three leaks in Strict, now fixed with unit tests that failed first:
  - the page title as the snapshot root's name in `search_elements`;
  - a contenteditable region's text (Chrome's accessibility tree calls it `generic`; its `editable` property is now kept and honoured);
  - the tab title in the devtools results' `meta.tab`, next to `origin`.
- M3: [DATA_FLOW.md](../../security/DATA_FLOW.md), [REQUEST_ANATOMY.md](../../development/REQUEST_ANATOMY.md) and PRIVACY.md (Anthropic's 5-minute prompt cache, the summary request, checks answered without the model, HAR files, the page's name). `npm run audit:docs-links` passes.
