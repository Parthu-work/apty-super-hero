# Apty Live Browser Debugging Agent

An AI agent, packaged as a Chrome extension, that helps an Apty engineer debug a live issue in their actual browser — "why isn't the Apty widget showing?", "why can't Studio select this element?" — by inspecting the current page's DOM, console, network activity, and Apty's own runtime state, then giving an evidence-first diagnosis.

Forked from [AIPex](https://github.com/AIPexStudio/AIPex) (MIT licensed), which already solved the hard browser-control infrastructure problems (Manifest V3 extension, MCP bridge, DOM snapshotting, CDP automation). **This is not a generic browser agent or a RAG/knowledge-base system** — see `docs/development/PROJECT_PROGRESS.md` and `DECISIONS.md` for the reasoning behind that scope.

**Start here for the real state of the project**: `docs/development/PROJECT_PROGRESS.md` (what's done, what's not, next steps), `ARCHITECTURE.md` (what's actually implemented), `docs/security/SECURITY_AUDIT.md`, `DECISIONS.md`, `CHANGELOG.md`. Those files, not this README, are the source of truth across coding sessions.

---

## What it does today

- Inspects the current page's DOM, elements, iframes, and Shadow DOM
- Reads console output/errors captured since page load (`get_apty_page_logs`)
- Watches live network requests and browser-level runtime errors via Chrome DevTools Protocol (`get_network_diagnostics`, `get_runtime_diagnostics`)
- Has provider interfaces ready for Apty Widget/Client/Studio/Service-Worker diagnostics (`get_apty_widget_diagnostics`, etc.) — **these currently report `not_configured`**, because the Apty-side integration (a real extension ID, a documented global, a message handler) doesn't exist yet. See `docs/development/PROJECT_PROGRESS.md`'s Apty Integration sections for exactly what's needed.
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

```bash
claude mcp add apty-browser -- npx -y aipex-mcp-bridge
```

Then in the extension's Options page, set the WebSocket URL (`ws://localhost:9223/extension`) and click Connect. See [`apps/mcp-bridge/README.md`](apps/mcp-bridge/README.md) for details.

## License

MIT, inherited from AIPex — see [LICENSE](LICENSE).
