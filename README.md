# Apty Live Browser Debugging Agent

An AI agent, packaged as a Chrome extension, that helps an Apty engineer debug a live issue in their actual browser — "why isn't the Apty widget showing?", "why can't Studio select this element?" — by inspecting the current page's DOM, console, network activity, and Apty's own runtime state, then giving an evidence-first diagnosis.

Forked from [the AIPex project](https://github.com/AIPexStudio/AIPex) (MIT licensed), which already solved the hard browser-control infrastructure problems (Manifest V3 extension, MCP bridge, DOM snapshotting, CDP automation). **This is not a generic browser agent or a general RAG/knowledge-base system**: its one retrieval feature finds the RAG Answer Card for a finding or symptom (owner decision D-KB1; see [Knowledge base](#knowledge-base-kb-rag)). See [`DECISIONS.md`](DECISIONS.md) for the reasoning behind that scope.

**Start here for the real state of the project**: [`docs/STATUS.md`](docs/STATUS.md) (what works and what's open), `ARCHITECTURE.md` (what's actually implemented), `docs/security/SECURITY_AUDIT.md`, `DECISIONS.md`, `CHANGELOG.md`. Those files, not this README, are the source of truth across coding sessions. Something not working? See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md). What data goes where: [`PRIVACY.md`](PRIVACY.md).

---

## What it does today

- Inspects the current page's DOM, elements, iframes, and Shadow DOM
- Reads console output/errors captured since page load (`get_apty_page_logs`)
- Watches live network requests and browser-level runtime errors via Chrome DevTools Protocol (`get_network_diagnostics`, `get_runtime_diagnostics`)
- Connects to the Apty Client extension by its ID (Settings → Connection) to read its service-worker logs, the resources it loaded and their response bodies (`list_extension_network_resources` lists unique requests with call counts; `inspect_extension_network` reads a body, falling back to an older call of the same request when the newest has none). Settings → Apty Client has a network calls panel that groups the Client's calls the same way. This needs a bridge module inside the Apty Client that answers the `apty-debug-agent:*` messages and allow-lists this extension's ID; until that ships, the connection check names exactly what is missing. Apty Studio connects the same way (its own row in Settings; it must allow-list this extension first, see [`STUDIO.md`](docs/integrations/apty/STUDIO.md)). Widget diagnostics still report `not_configured`.
- Generates Apty DOM Settings for an application (the DOM config page: Menu › DOM config, "/" in the composer, or See all on the start screen): it captures each page more than once, compares the runs and proposes ignore conditions, partial selector conditions, attribute priority, debounce, max z-index, Shadow DOM and Ignore DOM events in the form Apty's DOM Settings editor stores them, each labeled measured, derived or default, with copy, Markdown, JSON and Apty DOM config export. Modals, forms and records the crawl cannot reach are captured by hand, and console script results imported, into the same report; each page opens to what changed between its runs, and the Iframes, Coverage and Warnings details say what still needs handling. "Ask about these" puts the Markdown export in a new chat, sent only when you press Send. Results stay in the side panel's memory; see [`docs/development/dom-config.md`](docs/development/dom-config.md) and the [SE runbook](docs/development/dom-config-runbook.md).
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
pnpm --dir apps/mcp-bridge install --ignore-workspace   # the MCP bridge is its own project
pnpm build   # builds workspace packages, then the extension into apps/browser-extension/dist
pnpm dev     # or: watch mode with HMR
```

Load `apps/browser-extension/dist` as an unpacked extension via `chrome://extensions` → Developer mode → Load unpacked.

On first use, open the side panel: the composer's "Set up AI provider" chip and the Connections page (Menu › Connections) link to the AI provider settings, where you add your own API key and model (BYOK) — there is no login/proxy fallback.

## Knowledge base (KB-RAG)

- Finds the Apty RAG Answer Card (4.x, 5.x or common) for a check's finding or a symptom you type, and shows its text in the side panel, with no AI key needed.
- Grounds the model's answers in the cards: `search_kb`, citations that link to each card, and a check that marks setting names the cited cards do not hold.
- Says "not covered" for a question the cards do not answer, names a setting no card has, and points to a card whose text is not written yet.
- Runs entirely in the browser from a pack file each SE imports per Apty version; no card text is ever in this public repository.
- Keeps card text in the side panel: it reaches an AI model only when your organization's policy approves the destination (or only demo packs are loaded), and each request that carries it is recorded. IT sets the policy in Chrome's managed storage: [`docs/security/ORG_POLICY.md`](docs/security/ORG_POLICY.md).

Design, lifecycle, evaluation and troubleshooting: [`docs/development/kb-rag.md`](docs/development/kb-rag.md). The extension's KB surfaces: [`apps/browser-extension/README.md`](apps/browser-extension/README.md#knowledge-base). 4.x tenants: [`docs/integrations/apty/README.md`](docs/integrations/apty/README.md#4x-tenants).

### Try it locally in 10 minutes

Prerequisites: Node `^20.19.0 || >=22.12.0`, pnpm 10.33, Chrome or Chromium.

```bash
pnpm install --frozen-lockfile
```

The MCP bridge is its own pnpm project, which `pnpm build` also builds:

```bash
pnpm --dir apps/mcp-bridge install --frozen-lockfile --ignore-workspace
```

```bash
pnpm build
```

Load the extension: open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked** and choose `apps/browser-extension/dist`. After every later `pnpm build`, click the reload icon on the extension's card.

Build the two demo packs (synthetic DEMO cards only; written to `~/apty-kb/`, outside the repository):

```bash
pnpm kb:demo-pack --version 4.x
```

```bash
pnpm kb:demo-pack --version 5.x
```

Import them: right-click the toolbar icon → **Options** → **Settings** → **General** → **Knowledge base** → **Import pack…**, once for `apty-kb-DEMO-4.x.kbpack.json` and once for `apty-kb-DEMO-5.x.kbpack.json`. Two rows appear, "Apty 4.x" and "Apty 5.x", each "Signed by Apty demo key" with its expiry date (demo packs are signed with the published demo key, which the extension trusts only for demo `.invalid` sites; a real pack must be signed by the KB owner's key, KB-RAG K23). Options → **Connection** → **Preflight** → **Run all checks** shows a "Knowledge base (4.x)" and a "Knowledge base (5.x)" row, both passing.

Open any web page, open the side panel and ask, with or without an AI key:

| Ask | You should see |
|---|---|
| `the help bubble keeps blinking when I rest the mouse on the field` | A **KB cards that match** card: "DEMO tooltip flickers on hover" first, labelled 5.x, its layer text and "Verified on" line, and "Apty version: 4.x / 5.x / Not sure"; no request to any model |
| `does Apty support SAML single sign-on with Okta` | No KB card (not covered). With no AI key the panel asks you to connect a provider; with one, the model says the KB does not cover it |
| `bulk export of guides never finishes` | "The KB has a card for this, but its 5.x text is not written yet." and the card's link |

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
