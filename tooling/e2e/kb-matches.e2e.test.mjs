/**
 * KB-RAG K6: with a KB pack loaded and no AI key, a symptom no check pack
 * claims gets the KB matches card with no model request; a bare how-to
 * still asks for an AI provider (D-KB1). The card passes axe in both
 * themes. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  runAxe,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const { file } = writeFixturePack(tempDir("apty-kb-matches-"));
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

const optionsTabs = () =>
  browser.context.pages().filter((p) => p.url().includes("/options/"));

async function panelWithoutKey(theme) {
  const settings = await extensionPage(browser);
  await settings.evaluate(
    (t) => chrome.storage.local.set({ apty_theme: t }),
    theme,
  );
  await settings.close();
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app, { aiToken: "" });
  for (const page of optionsTabs()) await page.close();
  await panel.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    theme === "dark",
  );
  return { app, panel };
}

describe("KB matches card (KB-RAG K6)", () => {
  for (const theme of ["light", "dark"]) {
    it(`answers a symptom no check pack claims from the KB pack, with no AI key and no model request, axe clean (${theme})`, async () => {
      const { app, panel } = await panelWithoutKey(theme);
      await sendChat(
        panel,
        "the tooltip opens twice when I hover the help icon",
      );
      const card = panel.getByRole("region", { name: "KB cards that match" });
      await card.waitFor({ timeout: 30_000 });
      const link = card.getByRole("link", {
        name: /FIXTURE tooltip opens twice/,
      });
      assert.equal(
        await link.first().getAttribute("href"),
        "https://apty.atlassian.net/wiki/spaces/JA/pages/202",
      );
      await card
        .getByText("Verified on: FIXTURE code, 2026-01-01.")
        .first()
        .waitFor();
      assert.equal(model.requests.length, 0, "no model request");
      assert.equal(await panel.getByText("Connect an AI provider").count(), 0);
      const violations = await runAxe(panel);
      assert.deepEqual(violations, [], describeViolations(violations));
      assert.deepEqual(panel.consoleErrors, []);
      await panel.close();
      await app.close();
    });
  }

  it("leaves a bare how-to to the model, which needs an AI provider (D-KB1)", async () => {
    const { app, panel } = await panelWithoutKey("light");
    await sendChat(panel, "how do I configure the Double Trigger setting");
    await panel.getByText("Connect an AI provider").waitFor();
    assert.equal(
      await panel.getByRole("region", { name: "KB cards that match" }).count(),
      0,
    );
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });
});
