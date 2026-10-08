/**
 * The side panel's readiness check and the Options page's links: what the
 * user sees before an investigation starts, and where each "fix it" link
 * lands.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><h1>App</h1>",
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

function optionsTabs() {
  return browser.context
    .pages()
    .filter((p) => p.url().includes("/src/entrypoints/options/index.html"));
}

describe("readiness check and settings links", () => {
  it("shows the model, the Client and the page before a chat starts", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);

    const readiness = panel.getByRole("region", { name: "Readiness check" });
    await readiness.getByText("mock-model").waitFor();
    await readiness.getByText("Apty Client not connected").waitFor();
    await readiness.getByText("127.0.0.1").waitFor();
    await panel.close();
    await app.close();
  });

  it("sends a user without an API key straight to the AI provider settings", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    for (const page of optionsTabs()) await page.close();

    const readiness = panel.getByRole("region", { name: "Readiness check" });
    await readiness.getByText("Add your own API key").waitFor();
    const opened = browser.context.waitForEvent("page");
    await readiness
      .getByRole("button", { name: "Set up", exact: true })
      .click();
    const options = await opened;
    await options.waitForLoadState();

    assert.match(options.url(), /\?tab=ai#ai-provider$/);
    await options
      .getByRole("tab", { name: "AI Configuration", selected: true })
      .waitFor();
    await options.locator("#ai-provider").waitFor();
    await options.close();
    await panel.close();
    await app.close();
  });

  it("stores a General-tab switch as soon as it is flipped", async () => {
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=general#data-handling",
    );
    const bodies = options.getByRole("switch", {
      name: "Capture response bodies",
    });
    await bodies.click();
    await options.waitForFunction(async () => {
      const { aipex_settings } =
        await chrome.storage.local.get("aipex_settings");
      return aipex_settings?.networkBodyCaptureEnabled === true;
    });

    await options.reload();
    await options
      .locator('[role="switch"][aria-checked="true"]')
      .and(bodies)
      .waitFor();
    await bodies.click();
    await options.close();
  });

  it("keeps the Options tab in the URL, so Back and reload work", async () => {
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=connection#apty-client",
    );
    await options.locator("#apty-client").waitFor();
    await options
      .getByRole("tab", { name: "Apty Integration", selected: true })
      .waitFor();

    await options.getByRole("tab", { name: "General" }).click();
    assert.match(options.url(), /\?tab=general$/);

    await options.goBack();
    await options
      .getByRole("tab", { name: "Apty Integration", selected: true })
      .waitFor();

    await options.reload();
    await options
      .getByRole("tab", { name: "Apty Integration", selected: true })
      .waitFor();
    await options.close();
  });
});
