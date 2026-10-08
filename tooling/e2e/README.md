# Real-browser tests

`npm run test:e2e` runs the built extension in headless Chromium. Build
first (`npm run build`, which also builds the MCP bridge daemon).

| File | Covers |
|---|---|
| `agent.e2e.test.mjs` | The real side panel and agent loop against a scripted OpenAI-compatible model: the approval prompt (Allow, Deny, "Allow on this site", revoke), response-body opt-in and deny-list, a clean console, and DOM Health on a tab whose content scripts were orphaned by an extension restart. |
| `apty-client.e2e.test.mjs` | Fake Apty Client extensions (working, not allow-listed, bridge missing): the Options handshake and its messages, and the agent reading a 206-item body and a 403 body, with the full-response viewer. |
| `core-tools.e2e.test.mjs` | Everyday tools through the real agent: find and click an element, page metadata, scroll, highlight, screenshot, page console output, network and runtime diagnostics. |
| `frames.e2e.test.mjs` | DOM Health in same-origin, cross-origin, `data:` and frameset frames, open and closed shadow roots, top-frame-only UI, responder injection, element capture in the top frame and in an iframe. |
| `ui.e2e.test.mjs` | The side panel's readiness chips (model, Apty Client, page), the "Set up" link landing on the AI provider settings, and Options tabs kept in the URL across Back and reload. |
| `mcp.e2e.test.mjs` | The real MCP daemon: the Options page Connect button, the daemon's dangerous-tool block, and the approval prompt relayed from the service worker to the side panel. |

`E2E_EXTENSION_DIR` runs the suite against another build, e.g. `main`'s, to
compare behaviour before and after a change.

`harness.mjs` holds the shared pieces: browser launch, page servers, the
mock model (`startMockModel`, `callToolThenReport`), side panel helpers
(`openSidePanel`, `chatAndWait`) and the fixture extensions.

Chromium is taken from `E2E_CHROMIUM_PATH`, else `/opt/pw-browsers/chromium`,
else Puppeteer's Chrome for Testing (what CI installs). Branded Chrome
ignores `--load-extension` and cannot run these tests.
