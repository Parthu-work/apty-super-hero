# Real-browser tests

`npm run test:e2e` runs the built extension in headless Chromium. Build
first (`npm run build`, which also builds the MCP bridge daemon).

| File | Covers |
|---|---|
| `agent.e2e.test.mjs` | The real side panel and agent loop against a scripted OpenAI-compatible model: the approval prompt (Allow, Deny, "Allow on this site", revoke), response-body opt-in and deny-list, a clean console, and DOM Health on a tab whose content scripts were orphaned by an extension restart. |
| `apty-client.e2e.test.mjs` | Fake Apty Client extensions (working, not allow-listed, bridge missing): the Options handshake and its messages, and the agent reading a 206-item body and a 403 body, with the full-response viewer. |
| `visibility-check.e2e.test.mjs` | A fake Apty Client serving synthetic 5.x content files: "not visible in the widget" answered with the check card and no model request (no Client saved, a hidden workflow, the scan of every workflow, a segment that is turned off in dark mode), axe on the card, and a follow-up reaching the model with the check in its history. |
| `core-tools.e2e.test.mjs` | Everyday tools through the real agent: find and click an element, page metadata, scroll, highlight, screenshot, page console output, network and runtime diagnostics. |
| `frames.e2e.test.mjs` | DOM Health in same-origin, cross-origin, `data:` and frameset frames, open and closed shadow roots, top-frame-only UI, responder injection, element capture in the top frame and in an iframe. |
| `dom-health-routing.e2e.test.mjs` | The page's own `pushState` calls (including those made while it loads) counted through the MAIN-world hooks, and the developer route probe recording a real click: a new heading inside a shadow root, the first request path, the `pushState`. |
| `dom-config-collector.e2e.test.mjs` | DOM Config's collector and behavior probe: every frame profiled by its own responder, cross-origin included, the console script's JSON shape, noise left out, mutation bursts. |
| `dom-config-crawl.e2e.test.mjs` | DOM Config's crawl on a four-page fixture application: two runs per page, rules from what changed, Apty's defaults, z-index and iframes, the menu state left alone in safe mode and captured in deep mode, the same Markdown from the same capture. |
| `ui.e2e.test.mjs` | The side panel's Connections page (model, Apty Client, page), the setup badge and the composer's "Set up AI provider" chip landing on the AI provider settings, a refused API key explained in the chat with "Open AI provider settings" landing there too, and Options tabs kept in the URL across Back and reload. |
| `a11y-<surface>-<theme>.e2e.test.mjs` | axe-core on the side panel, the tool pages and Options, one surface in one theme per file; the tests and the shared setup are in `a11y-suite.mjs`, which `node --test` does not pick up as a test file. |
| `dom-health-apps-<part>.e2e.test.mjs` | DOM Health on six application shapes (deep shadow DOM, frameset, cross-origin portal, pushState SPA, click-only, third-party overlay), "Ask about this result" and the validation bundle export, in three files; the pages and the shared setup are in `dom-health-apps-suite.mjs`. |
| `keyboard.e2e.test.mjs` | Every flow by keyboard alone (open the menu and a tool, start and stop a DOM config capture, check a page and ask about the result, delete a chat through its confirmation, the Options tabs by arrow keys), and the names of the panel's and Options' main controls. |
| `mcp.e2e.test.mjs` | The real MCP daemon: the Options page Connect button, the daemon's dangerous-tool block, and the approval prompt relayed from the service worker to the side panel. |

`E2E_EXTENSION_DIR` runs the suite against another build, e.g. `main`'s, to
compare behaviour before and after a change.

`harness.mjs` holds the shared pieces: browser launch, page servers, the
mock model (`startMockModel`, `callToolThenReport`), side panel helpers
(`openSidePanel`, `chatAndWait`) and the fixture extensions.

Chromium is taken from `E2E_CHROMIUM_PATH`, else `/opt/pw-browsers/chromium`,
else Puppeteer's Chrome for Testing (what CI installs). Branded Chrome
ignores `--load-extension` and cannot run these tests.
