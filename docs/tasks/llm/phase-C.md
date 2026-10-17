# Phase C (do not start until Phase B is approved and the owner says "continue")

- M1 request-size regression gate: `tooling/e2e/request-budgets.json` with
  10% headroom, checked against the harness numbers.
- M2 masking proof e2e: one fixture page with many PHI-like strings, every
  reading tool exercised, asserts none leak in Strict.
- M3 documentation: `docs/security/DATA_FLOW.md`,
  `docs/development/REQUEST_ANATOMY.md`, `PRIVACY.md` updates,
  `npm run audit:docs-links`.
