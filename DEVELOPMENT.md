# Development

## Install

```bash
pnpm install
```

`apps/mcp-bridge` is intentionally outside the pnpm workspace (own lockfile,
own `tsup` build) — install its dependencies separately if you're working on
it:

```bash
cd apps/mcp-bridge && npm install
```

## Build / dev / test / lint / typecheck

From the repository root, these run across every workspace package
(`packages/agent-core`, `packages/dom-snapshot`, `packages/browser-runtime`,
`packages/ui`, `apps/browser-extension`):

```bash
pnpm build       # tsc for each package, then `vite build` for the extension
pnpm dev         # vite dev server with HMR for the extension
pnpm test        # vitest run, per package
pnpm typecheck   # tsc --project tsconfig.json, per package (dependency order)
pnpm lint        # biome check .
pnpm lint:fix     # biome check . --fix --unsafe
pnpm format      # biome format . --write
pnpm preflight   # format + lint:fix + typecheck + test — run this before submitting changes
```

Run a single package's script with `pnpm --filter <package-name> <script>`,
e.g. `pnpm --filter @apty/browser-extension dev`.

## Loading the extension

```bash
pnpm build
```

Then in Chrome/Chromium: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `apps/browser-extension/dist`.

On first use, open the extension's Options page and configure an AI
provider + API key (BYOK — there is no login/proxy fallback).

## MCP bridge

`apps/mcp-bridge` lets external AI clients (Claude Code, Cursor, VS Code
Copilot) drive the browser via the extension. See
[`apps/mcp-bridge/README.md`](apps/mcp-bridge/README.md) for the CLI/daemon
details and [`skill/SKILL.md`](skill/SKILL.md) for the MCP client
configuration.

## Debugging

- **Background service worker**: `chrome://extensions` → the extension card
  → "service worker" link opens its DevTools.
- **Content script / side panel / options page**: right-click → Inspect, same
  as any web page.
- **`packages/browser-runtime`'s puppeteer-backed tests** (`*.puppeteer.test.ts`)
  need Chrome for Puppeteer installed once: `node node_modules/puppeteer/install.mjs`
  (run with `working-directory: packages/browser-runtime`, matching CI).

## Architecture checks

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the current package layout and
dependency rules, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for where new code
belongs.
