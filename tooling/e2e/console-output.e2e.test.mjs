/**
 * The production build prints no debug output (D4): with Verbose logging
 * off, the side panel, the Options page and the service worker log
 * nothing below a warning through a chat with a tool call, Settings and
 * the preflight checks. Debug output stays available behind Settings →
 * Troubleshooting → Verbose logging.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  callToolThenReport,
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

const DEBUG_TYPES = new Set(["log", "debug", "info"]);

let browser;
let model;
let site;
const messages = [];

function record(where) {
  return (message) => {
    messages.push({ where, type: message.type(), text: message.text() });
  };
}

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<title>App</title><main><h1>Orders</h1></main>",
  });
  browser = await launchBrowser();
  browser.agentWorker.on("console", record("service worker"));
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("production console output (D4)", () => {
  it("logs nothing below a warning in the side panel, Options and the service worker", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    panel.on("console", record("side panel"));
    model.script(callToolThenReport("get_current_tab", {}));
    await chatAndWait(panel, "what is the current tab?");

    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html#preflight",
    );
    options.on("console", record("options"));
    await options.getByRole("button", { name: "Run all checks" }).click();
    await options
      .getByRole("list", { name: "Preflight results" })
      .waitFor({ timeout: 90_000 });

    const debug = messages.filter((m) => DEBUG_TYPES.has(m.type));
    assert.deepEqual(debug, [], JSON.stringify(debug, null, 1));
    await options.close();
    await panel.close();
    await app.close();
  });
});
