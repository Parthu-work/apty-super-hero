# Apty Agent

An AI browser agent for Apty — forked from [AIPex](https://github.com/AIPexStudio/AIPex) (MIT licensed) and being customized to integrate with Apty Studio and the Apty widget: understanding enterprise web applications, resolving UI elements reliably, driving/repairing Apty workflows, and pulling diagnostic logs for debugging.

---

## Why this fork exists

Apty's Digital Adoption Platform depends on identifying the right UI element in enterprise applications (Salesforce, ServiceNow, Workday, etc.) — a problem that traditional CSS/XPath selectors solve poorly under dynamic DOMs, shadow DOM, iframes, and SPA navigation.

Rather than build browser-control infrastructure (Manifest V3 extension, MCP bridge, DOM snapshotting, element resolution) from scratch, this repo starts from AIPex — an open-source browser automation agent that already solves the hard infrastructure problems:

- A **Chrome/Chromium extension** (side panel + content script + background service worker)
- An **MCP bridge** (`mcp-bridge/`) so external AI clients (Claude Code, Cursor, VS Code Copilot) can drive the browser
- A **DOM snapshot** package that assigns stable UIDs to elements instead of raw selectors
- A **Human-in-the-Loop intervention system** (monitor an operation, ask the user to pick among candidates) for the recovery/escalation path

## What changed from upstream AIPex

- Removed AIPex's own SaaS backend integrations (login/proxy mode, conversation sharing, user-manual replay-from-website, recording/screenshot upload, version checking) — this fork is **BYOK-only**: it talks directly to your configured AI provider (or, eventually, Apty's own backend), never through a third-party proxy.
- Removed voice input (ElevenLabs STT + VAD) and its `three.js`-based particle visualization — unrelated to a page-automation agent and a meaningful bundle-size/attack-surface reduction.
- Removed AIPex's own marketing/community UI (Discord/Twitter/WeChat links, "buy tokens" prompts) and release automation (`bump`/`release` workflows) that assumed this stays AIPex's own published product.
- Rebranded the extension (manifest, page titles, header) as **Apty Agent**.

See `packages/*/src` for the actual code; the high-level architecture (agent core, DOM snapshot, browser runtime, MCP bridge, React UI) is unchanged from upstream.

## Local setup

```bash
pnpm install
pnpm build   # builds workspace packages, then the extension into packages/browser-ext/dist
pnpm dev     # or: watch mode with HMR
```

Load `packages/browser-ext/dist` as an unpacked extension via `chrome://extensions` → Developer mode → Load unpacked.

On first use, open the extension's **Options** page and configure an AI provider + API key (BYOK) — there is no login/proxy fallback.

## Use with AI Coding Agents (MCP)

```
AI Agent ──stdio──▶ mcp-bridge ──WebSocket──▶ Apty Agent Extension ──▶ Browser
```

```bash
claude mcp add apty-browser -- npx -y aipex-mcp-bridge
```

Then in the extension's Options page, set the WebSocket URL (`ws://localhost:9223/extension`) and click Connect. See [`mcp-bridge/README.md`](mcp-bridge/README.md) for details.

## License

MIT, inherited from AIPex — see [LICENSE](LICENSE).
