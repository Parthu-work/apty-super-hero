# Contributing

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for install/build/test commands, and
[`ARCHITECTURE.md`](ARCHITECTURE.md) for what's actually implemented.

## Repository structure

```
apps/
  browser-extension/   The Manifest V3 Chrome extension (assembles everything below)
  mcp-bridge/           Standalone MCP bridge CLI/daemon (own pnpm project)
packages/
  agent-core/           Model-agnostic agent loop. No browser/platform code.
  dom-snapshot/         DOM -> normalized element list with stable UIDs. Leaf package.
  browser-runtime/      Everything that talks to Chrome APIs: automation, tools,
                         intervention system, skill sandbox, Apty diagnostics,
                         the MCP WebSocket bridge.
  ui/                   Shared React UI (chat, settings). Depends on agent-core only.
docs/                   Cross-cutting documentation (see below)
skill/                  Claude Code skill definition for driving the browser via MCP
```

## Dependency rules

```
apps            -> packages
packages/ui               -> packages/agent-core            (never browser-runtime)
packages/browser-runtime  -> packages/agent-core, packages/dom-snapshot
packages/agent-core, packages/dom-snapshot -> nothing (leaves)
```

`packages/ui` must never import from `packages/browser-runtime`. Browser/Chrome-specific
code (`ChromeStorageAdapter`, browser tools, DOM APIs) stays in
`packages/browser-runtime` or `apps/browser-extension`.

## Where new code belongs

- **A new browser-automation tool** exposed to the agent: add it under
  `packages/browser-runtime/src/tools/` and register it in
  `packages/browser-runtime/src/tools/index.ts`'s tool list. Keep the tool
  function itself a thin wrapper (validate input, call a domain/service
  function, format the result) — put real logic in a sibling domain module
  (e.g. `packages/browser-runtime/src/automation/`, `.../apty/`) rather than
  inline in the tool file.
- **Apty-specific diagnostics** (Widget/Client/Studio/Service-Worker): domain
  logic lives in `packages/browser-runtime/src/apty/`; the tool-layer wrappers
  are `packages/browser-runtime/src/tools/apty.ts` and `devtools.ts`; the UI is
  `apps/browser-extension/src/components/investigation/` and
  `apps/browser-extension/src/entrypoints/options/apty-client-panel.tsx`.
- **A new built-in skill** (QuickJS-sandboxed, user-invocable): add a folder
  under `packages/browser-runtime/src/skills/built-in/` with a `SKILL.md` plus
  any scripts; register it the way the existing built-ins are registered in
  `packages/browser-runtime/src/skills/`.
- **Chrome extension UI**: components in
  `apps/browser-extension/src/components/`, hooks in `.../hooks/`, React
  context/state in `.../state/`, non-UI adapters/services in `.../services/`.
  Extension entrypoints (background/content/sidepanel/options) live in
  `apps/browser-extension/src/entrypoints/` — each subfolder is one Chrome
  runtime entrypoint referenced from `manifest.json`.
- **Manifest permissions**: edit `apps/browser-extension/manifest.json`
  directly. Justify any new host permission or API permission in a commit
  message or `DECISIONS.md` entry — this extension already carries broad
  `<all_urls>`/`debugger` permissions for its debugging use case; don't widen
  that surface without a reason.

## Tests

- Co-locate unit tests next to the source file (`foo.ts` / `foo.test.ts`),
  following existing patterns — see `AGENTS.md`/`CLAUDE.md` for Vitest
  conventions (mocking, hoisting, fake timers).
- `packages/browser-runtime` also has a handful of `*.puppeteer.test.ts`
  files that drive a real headless Chrome — see `DEVELOPMENT.md` for the
  one-time setup.
- Don't add tests just to inflate coverage; focus on real logic and edge
  cases.

## Validation before submitting

```bash
pnpm preflight
```

This formats, lints (with fixes), typechecks, and runs the full test suite
across every package. CI (`.github/workflows/ci.yml`) runs the same checks
plus a Puppeteer Chrome install for `packages/browser-runtime`'s browser
tests.

## Documentation

- `README.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `CHANGELOG.md` stay at the
  repository root.
- Everything else — integration references, development-progress tracking,
  detailed security findings — lives under `docs/` in its own category
  (`docs/integrations/`, `docs/development/`, `docs/security/`, etc.). Add a
  new top-level category folder only when an existing one genuinely doesn't
  fit; don't invent nesting a document doesn't need.
