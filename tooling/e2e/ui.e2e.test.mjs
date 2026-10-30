/**
 * The side panel's Connections page, setup badge and provider chip, and the
 * Options page's links: what the user sees before an investigation starts,
 * and where each "fix it" link lands.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  extensionPage,
  launchBrowser,
  openSidePanel,
  openToolPage,
  sendChat,
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

describe("Connections, the setup badge and settings links", () => {
  it("shows the provider, the Client and the page on the Connections page", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);

    await openToolPage(panel, "Connections");
    const page = panel.getByRole("region", { name: "Connections" });
    const card = (name) => page.getByRole("region", { name });
    await card("AI provider").getByText("Ready").waitFor();
    await card("AI provider").getByText("Using mock-model.").waitFor();
    await card("Apty Client").getByText("Not connected").waitFor();
    await card("This site").getByText("127.0.0.1", { exact: true }).waitFor();
    await card("This site").getByText("Can inspect").waitFor();
    assert.equal(await panel.getByText(/to set up$/).count(), 0);
    await panel.close();
    await app.close();
  });

  it("sends a user without an API key straight to the AI provider settings", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    for (const page of optionsTabs()) await page.close();

    await panel.getByRole("button", { name: "1 to set up" }).waitFor();
    const opened = browser.context.waitForEvent("page");
    await panel.getByRole("button", { name: "Set up AI provider" }).click();
    const options = await opened;
    await options.waitForLoadState();

    assert.match(options.url(), /\?tab=ai#ai-provider$/);
    await options
      .getByRole("tab", { name: "AI", exact: true, selected: true })
      .waitFor();
    await options.locator("#ai-provider").waitFor();
    await options.close();
    await panel.close();
    await app.close();
  });

  it("answers a check question with no API key and no model request, and asks for setup for anything else (8)", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    for (const page of optionsTabs()) await page.close();
    model.script(() => ({ text: "MODEL WAS CALLED" }));

    await sendChat(panel, "my workflow is not visible in the widget");
    await panel
      .getByText("Could not reach the Apty Client", { exact: false })
      .first()
      .waitFor({ timeout: 30_000 });
    assert.equal(model.requests.length, 0, "no model request");
    assert.equal(await panel.getByText("Connect an AI provider").count(), 0);

    await sendChat(panel, "hello, what can you do?");
    await panel.getByText("Connect an AI provider").waitFor();
    assert.equal(model.requests.length, 0, "still no model request");
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("explains a refused API key in the chat and opens the AI provider settings from there", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    for (const page of optionsTabs()) await page.close();
    model.script(() => ({
      error: { status: 401, message: "Incorrect API key provided: sk-e2e" },
    }));

    await sendChat(panel, "is the widget loaded?");
    const failure = panel
      .getByRole("alert")
      .filter({ hasText: "Couldn't get an answer" });
    await failure.getByText(/rejected the request/).waitFor();
    assert.equal(await panel.getByRole("button", { name: "Send" }).count(), 1);
    const opened = browser.context.waitForEvent("page");
    await failure
      .getByRole("button", { name: "Open AI provider settings" })
      .click();
    const options = await opened;
    await options.waitForLoadState();

    assert.match(options.url(), /\?tab=ai#ai-provider$/);
    await options.locator("#ai-provider").waitFor();
    await options.close();
    await panel.close();
    await app.close();
  });

  it("switches an open Options page to another section without reloading it", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    for (const page of optionsTabs()) await page.close();
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=ai",
    );
    await options.locator("#ai-provider").waitFor();
    await options.evaluate(() => {
      window.__notReloaded = true;
    });

    await openToolPage(panel, "Connections");
    await panel
      .getByRole("button", { name: "Open all connection settings" })
      .click();

    await options
      .getByRole("tab", { name: "Connection", selected: true })
      .waitFor();
    await options.locator("#apty-client").waitFor();
    assert.match(options.url(), /\?tab=connection#apty-client$/);
    assert.equal(await options.evaluate(() => window.__notReloaded), true);
    assert.equal(optionsTabs().length, 1);
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
      const { apty_settings } = await chrome.storage.local.get("apty_settings");
      return apty_settings?.networkBodyCaptureEnabled === true;
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
      .getByRole("tab", { name: "Connection", selected: true })
      .waitFor();

    await options.getByRole("tab", { name: "General" }).click();
    assert.match(options.url(), /\?tab=general$/);

    await options.goBack();
    await options
      .getByRole("tab", { name: "Connection", selected: true })
      .waitFor();

    await options.reload();
    await options
      .getByRole("tab", { name: "Connection", selected: true })
      .waitFor();
    await options.close();
  });
});
