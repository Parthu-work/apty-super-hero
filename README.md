# Apty Live Browser Debugging Agent

An AI agent, packaged as a Chrome extension, that helps an Apty engineer debug a live issue in their actual browser — "why isn't the Apty widget showing?", "why can't Studio select this element?" — by inspecting the current page's DOM, console, network activity, and Apty's own runtime state, then giving an evidence-first diagnosis.

Forked from [the AIPex project](https://github.com/AIPexStudio/AIPex) (MIT licensed), which already solved the hard browser-control infrastructure problems (Manifest V3 extension, MCP bridge, DOM snapshotting, CDP automation). **This is not a generic browser agent or a RAG/knowledge-base system** — see [`DECISIONS.md`](DECISIONS.md) for the reasoning behind that scope.

**Start here for the real state of the project**: [`docs/STATUS.md`](docs/STATUS.md) (what works and what's open), `ARCHITECTURE.md` (what's actually implemented), `docs/security/SECURITY_AUDIT.md`, `DECISIONS.md`, `CHANGELOG.md`. Those files, not this README, are the source of truth across coding sessions. Something not working? See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md). What data goes where: [`PRIVACY.md`](PRIVACY.md).

---

## What it does today

- Inspects the current page's DOM, elements, iframes, and Shadow DOM
- Reads console output/errors captured since page load (`get_apty_page_logs`)
- Watches live network requests and browser-level runtime errors via Chrome DevTools Protocol (`get_network_diagnostics`, `get_runtime_diagnostics`)
- Connects to the Apty Client extension by its ID (Settings → Apty Integration) to read its service-worker logs, the resources it loaded and their response bodies (`list_extension_network_resources` lists unique requests with call counts; `inspect_extension_network` reads a body, falling back to an older call of the same request when the newest has none). Settings → Apty Client has a network calls panel that groups the Client's calls the same way. This needs a bridge module inside the Apty Client that answers the `apty-debug-agent:*` messages and allow-lists this extension's ID; until that ships, the connection check names exactly what is missing. Apty Studio connects the same way (its own row in Settings; it must allow-list this extension first, see [`STUDIO.md`](docs/integrations/apty/STUDIO.md)). Widget diagnostics still report `not_configured`.
- Generates Apty DOM Settings for an application (the DOM config page: Menu › DOM config, "/" in the composer, or See all on the start screen): it captures each page more than once, compares the runs and proposes ignore conditions, attribute priority, debounce, max z-index, Shadow DOM and ignored events, each labeled measured, derived or default, with copy, Markdown and JSON export. Modals, forms and records the crawl cannot reach are captured by hand, and console script results imported, into the same report; each page opens to what changed between its runs, and the Iframes, Coverage and Warnings details say what still needs handling. "Ask about these" puts the Markdown export in a new chat, sent only when you press Send. Results stay in the side panel's memory; see [`docs/development/dom-config.md`](docs/development/dom-config.md) and the [SE runbook](docs/development/dom-config-runbook.md).
- Asks before risky actions: running JavaScript in the page, filling fields, typing, uploading or downloading, clicking a submit, destructive or cross-origin control, and opening a tab on another site wait for you to click Allow or Deny in the side panel.
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

On first use, open the side panel: the composer's "Set up AI provider" chip and the Connections page (Menu › Connections) link to the AI provider settings, where you add your own API key and model (BYOK) — there is no login/proxy fallback.

## Configuring Apty Studio/Widget/Client/Service-Worker integration

Copy `apps/browser-extension/.env.example` to `apps/browser-extension/.env` and fill in whatever Apty engineering has actually made available (a Studio extension ID, a service-worker diagnostic endpoint, etc.) — every value defaults to empty, which is honestly reported as `not_configured` rather than faked. See [`docs/integrations/apty/README.md`](docs/integrations/apty/README.md) and [`STUDIO.md`](docs/integrations/apty/STUDIO.md) for what each one needs on the Apty side before it can do anything (the earlier per-component notes are in [`docs/archive/PROJECT_PROGRESS.md`](docs/archive/PROJECT_PROGRESS.md)).

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
