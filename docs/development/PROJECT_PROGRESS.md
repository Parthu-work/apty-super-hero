# What exists and how to extend it

The history this file used to hold is unchanged in
[`docs/archive/PROJECT_PROGRESS.md`](../archive/PROJECT_PROGRESS.md). What
works today and what is open is in [`docs/STATUS.md`](../STATUS.md).

## The pieces

| Piece | Where | Read first |
|---|---|---|
| Agent loop, settings, storage keys, logger | `packages/agent-core` | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) "Package layout" |
| Browser tools, Apty integration, DOM Health, redaction mode, page-script registration | `packages/browser-runtime` | `ARCHITECTURE.md` "Apty integration layer", "DevTools / CDP layer" |
| DOM snapshots and the DOM Health collector | `packages/dom-snapshot` | [`dom-health-architecture.md`](dom-health-architecture.md) |
| Redaction and the debug contract (shared with Apty's extensions) | `packages/apty-debug-contract` | [`docs/integrations/apty/README.md`](../integrations/apty/README.md) |
| Chat UI and Settings (no browser code) | `packages/ui` | `ARCHITECTURE.md` "Side panel UI architecture" |
| The extension: side panel, Options, service worker, content scripts | `apps/browser-extension` | `ARCHITECTURE.md` "High-level shape" |
| MCP bridge (separate pnpm project) | `apps/mcp-bridge` | its `README.md` |
| DES engine | `packages/browser-runtime` | [`des-engine.md`](des-engine.md) |

Dependency rules are enforced by `npm run audit:architecture`
(`@apty/ui` never depends on `@apty/browser-runtime`).

## How to extend it

- **A tool.** Define it with `tool()` in a file under
  `packages/browser-runtime/src/tools/`, add it to its group in
  `tools/index.ts` (the groups decide when the model is offered it, see
  `tool-relevance.ts`), add its schema to
  `apps/mcp-bridge/src/tool-schemas.ts` so MCP clients see it, and give it
  a friendly name under `tools` in `packages/ui/src/i18n/locales/*.json`.
  A tool that changes a page or opens another origin goes through
  `gateRiskyAction` (see [`PERMISSIONS.md`](../security/PERMISSIONS.md)).
  Everything a tool returns to the model passes through
  `runtime/redaction-mode.ts`. `npm run audit:tools` checks names.
- **A setting.** Add it to `AppSettings` in
  `packages/agent-core/src/config/settings.ts` and its control to a card in
  `packages/ui/src/components/settings/`; browser-specific behaviour reads
  it in `browser-runtime` or the extension.
- **An Apty peer** (another Apty extension the Agent reads):
  `packages/browser-runtime/src/apty/peers.ts`, as the Client and Studio do
  ([`STUDIO.md`](../integrations/apty/STUDIO.md)).
- **A DOM Health threshold or heuristic.** The tunable values are in
  `apty/dom-health-thresholds.ts`; change a default only with real-tenant
  evidence ([`real-tenant-validation.md`](real-tenant-validation.md),
  [`dom-health-onboarding-runbook.md`](dom-health-onboarding-runbook.md)).
- **A preflight check.** `apps/browser-extension/src/services/preflight.ts`.

## Checks and tests

- Before a change: `tooling/scripts/verify-quiet.sh` (typecheck, lint,
  test, audit, build), `npm run test:coverage` (thresholds only go up,
  [`coverage.md`](coverage.md)), and `npm run test:e2e` in Chromium
  ([`tooling/e2e/README.md`](../../tooling/e2e/README.md)).
- Accessibility: [`accessibility.md`](accessibility.md). Releases:
  [`RELEASING.md`](RELEASING.md) and
  [`SMOKE_TEST.md`](../release/SMOKE_TEST.md). Demo:
  [`DEMO.md`](../demo/DEMO.md).
- Problems: [`docs/TROUBLESHOOTING.md`](../TROUBLESHOOTING.md). Privacy:
  [`PRIVACY.md`](../../PRIVACY.md). Security findings:
  [`SECURITY_AUDIT.md`](../security/SECURITY_AUDIT.md).
