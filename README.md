# Apty Live Browser Debugging Agent

An AI agent, packaged as a Chrome extension, that helps an Apty engineer debug a live issue in their actual browser — "why isn't the Apty widget showing?", "why can't Studio select this element?" — by inspecting the current page's DOM, console, network activity, and Apty's own runtime state, then giving an evidence-first diagnosis.

Forked from [AIPex](https://github.com/AIPexStudio/AIPex) (MIT licensed), which already solved the hard browser-control infrastructure problems (Manifest V3 extension, MCP bridge, DOM snapshotting, CDP automation). **This is not a generic browser agent or a RAG/knowledge-base system** — see `docs/development/PROJECT_PROGRESS.md` and `DECISIONS.md` for the reasoning behind that scope.

**Start here for the real state of the project**: `docs/development/PROJECT_PROGRESS.md` (what's done, what's not, next steps), `ARCHITECTURE.md` (what's actually implemented), `docs/security/SECURITY_AUDIT.md`, `DECISIONS.md`, `CHANGELOG.md`. Those files, not this README, are the source of truth across coding sessions.

---

## What it does today

- Inspects the current page's DOM, elements, iframes, and Shadow DOM
- Reads console output/errors captured since page load (`get_apty_page_logs`)
- Watches live network requests and browser-level runtime errors via Chrome DevTools Protocol (`get_network_diagnostics`, `get_runtime_diagnostics`)
- Connects to the Apty Client extension by its ID (options page → Connection) to read its service-worker logs, the resources it loaded and their response bodies (`inspect_extension_network`). This needs a bridge module inside the Apty Client that answers the `apty-debug-agent:*` messages and allow-lists this extension's ID; until that ships, the connection check names exactly what is missing. Widget and Studio diagnostics still report `not_configured`.
- Asks before risky actions: running JavaScript in the page, filling fields, typing, uploading or downloading waits for you to click Allow or Deny in the side panel.
- Reasons over all of the above and answers with a confidence-scored diagnosis (Confirmed/Likely/Possible/Unknown), never fabricating evidence

## Core infrastructure

- A **Chrome/Chromium extension** (side panel + content script + background service worker)
- An **MCP bridge** (`apps/mcp-bridge/`) so external AI clients (Claude Code, Cursor, VS Code Copilot) can drive the browser
- A **DOM snapshot** package that assigns stable UIDs to elements instead of raw selectors
- A **Human-in-the-Loop intervention system** (monitor an operation, ask the user to pick among candidates)

## What changed from upstream AIPex

- Removed AIPex's own SaaS backend integrations (login/proxy mode, conversation sharing, user-manual replay-from-website, recording/screenshot upload, version checking) — this fork is **BYOK-only**: it talks directly to your configured AI provider (or, eventually, Apty's own backend), never through a third-party proxy.
- Removed voice input (ElevenLabs STT + VAD) and its `three.js`-based particle visualization.
- Removed AIPex's own marketing/community UI and release automation.
- Rebranded as **Apty Live Browser Debugging Agent**; system prompt rewritten from a generic browser assistant into the debugging persona (see `packages/ui/src/components/chatbot/constants.ts`).
- Added the Apty diagnostics layer described above (`packages/browser-runtime/src/apty/`).

See `CHANGELOG.md` for the full list with commit references.

## Local setup

```bash
pnpm install
pnpm build   # builds workspace packages, then the extension into apps/browser-extension/dist
pnpm dev     # or: watch mode with HMR
```

Load `apps/browser-extension/dist` as an unpacked extension via `chrome://extensions` → Developer mode → Load unpacked.

On first use, open the extension's **Options** page and configure an AI provider + API key (BYOK) — there is no login/proxy fallback.

## Configuring Apty Studio/Widget/Client/Service-Worker integration

Copy `apps/browser-extension/.env.example` to `apps/browser-extension/.env` and fill in whatever Apty engineering has actually made available (a Studio extension ID, a service-worker diagnostic endpoint, etc.) — every value defaults to empty, which is honestly reported as `not_configured` rather than faked. See `docs/development/PROJECT_PROGRESS.md`'s per-component integration sections for exactly what each one needs on the Apty side before it can do anything.

## Use with AI Coding Agents (MCP)

```
AI Agent ──stdio──▶ mcp-bridge ──WebSocket──▶ Apty Agent Extension ──▶ Browser
```

`apps/mcp-bridge` is not published to npm — build it locally, then point your MCP client at the built file (never `npm install -g aipex-mcp-bridge`; that resolves an unrelated package on the public registry):

```bash
cd apps/mcp-bridge && pnpm build
claude mcp add apty-browser -- node /path/to/apty-super-hero/apps/mcp-bridge/dist/bridge.js
```

Then in the extension's Options page, set the WebSocket URL (`ws://localhost:9223/extension`) and paste in the daemon's auth token (every connection requires one — find it with `cd apps/mcp-bridge && node dist/daemon.js --print-token-path`, then read that file; a fresh one is generated on first run). The daemon also needs your extension's id pinned once, the first time: `node dist/daemon.js --set-extension-id <id>` (find `<id>` in `chrome://extensions` with Developer mode on). Then click Connect. See [`apps/mcp-bridge/README.md`](apps/mcp-bridge/README.md) for details.

## License

MIT, inherited from AIPex — see [LICENSE](LICENSE).
