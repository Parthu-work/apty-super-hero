# Apty-side integration reference

This folder is hand-off material for **Apty engineering teams** (Widget,
Client, Studio), not code that runs as part of this extension. Nothing
here is compiled or imported by any package in this repo — that's
deliberate, since this describes what needs to exist in *other*
repositories (the Apty Widget/Client/Studio codebases) before the
corresponding diagnostics tool in this extension can return real data
instead of `status: "not_configured"`.

## Files

- **`apty-widget-service-worker.reference.ts`** — a complete reference
  implementation for the Apty Widget's own Manifest V3 service worker:
  safe console-argument serialization, a bounded/persisted/debounced log
  buffer (survives MV3 service-worker restarts), and a sender-validated
  `onMessageExternal` handler matching the exact message contract this
  extension's consumer already implements
  (`packages/browser-runtime/src/apty/service-worker-diagnostics.ts`).

## Why a reference file instead of just prose

The message contract, response shape, and persistence design all need to
match exactly what the consumer side expects — copy-pasteable code with
inline reasoning for each design decision is less likely to drift from
that contract than a written spec someone re-implements from scratch. Treat
it as a starting point to adapt to the Widget's actual project structure
and build tooling, not something to drop in unmodified.

## What's still needed from Apty engineering

1. Confirm this extension's real ID and hardcode it as
   `DEBUG_AGENT_EXTENSION_ID` in the reference file (and the equivalent
   `externally_connectable.ids` entry in the Widget's manifest).
2. Decide where this code actually lives in the Widget's codebase, and
   adapt build tooling/imports accordingly.
3. Give us that Widget extension ID to put in
   `packages/browser-ext/.env` as `VITE_APTY_SERVICE_WORKER_EXTENSION_ID`.
4. Confirm whether Apty has (or is building) any backend log/telemetry
   endpoint instead — if so, the HTTP path
   (`VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT`) is likely a better fit
   than this messaging-based approach; see
   `packages/browser-runtime/src/apty/service-worker-diagnostics.ts`'s
   top-of-file comment and `ARCHITECTURE.md` for that tradeoff.

Widget/Client diagnostics (`window.__APTY_WIDGET__` /
`window.__APTY_CLIENT__`) are a separate, simpler mechanism — see
`packages/browser-runtime/src/apty/widget-diagnostics.ts` and
`client-diagnostics.ts` for those contracts; they don't need anything from
this folder.
