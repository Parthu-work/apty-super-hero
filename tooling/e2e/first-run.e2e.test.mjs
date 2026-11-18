/**
 * KB-RAG K27, R3: from a fresh profile, the side panel shows one "Before
 * you start" card with a row per thing the Agent needs; choosing to work
 * without an AI key and importing both packs turn their rows ready, and
 * the card passes axe in light and dark. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  describeViolations,
  launchBrowser,
  openSidePanel,
  runAxe,
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
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

const state = (panel, id) =>
  panel.getByTestId(`first-run-${id}`).getAttribute("data-state");

describe("the first-run checklist (KB-RAG K27, R3)", () => {
  it("lists what is missing on a fresh profile, and each row turns ready once set up", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    const card = panel.getByTestId("first-run");
    await card.waitFor({ timeout: 30_000 });
    await panel
      .getByTestId("first-run-client")
      .and(panel.locator("[data-state=todo]"))
      .waitFor({ timeout: 30_000 });
    assert.equal(await state(panel, "kb-4.x"), "todo");
    assert.equal(await state(panel, "kb-5.x"), "todo");
    assert.equal(await state(panel, "ai"), "todo");
    assert.equal(await state(panel, "policy"), "ok");

    for (const theme of ["light", "dark"]) {
      await panel.evaluate(
        (t) => chrome.storage.local.set({ apty_theme: t }),
        theme,
      );
      await panel.waitForFunction(
        (dark) => document.documentElement.classList.contains("dark") === dark,
        theme === "dark",
      );
      const violations = await runAxe(panel);
      assert.deepEqual(violations, [], describeViolations(violations));
    }

    await card.getByRole("button", { name: "Use without an AI key" }).click();
    await panel
      .getByTestId("first-run-ai")
      .and(panel.locator("[data-state=ok]"))
      .waitFor();

    const dir = tempDir("apty-kb-first-run-");
    for (const aptyVersion of ["4.x", "5.x"]) {
      const { file } = writeFixturePack(dir, { aptyVersion });
      await importPack(browser, file);
    }
    await panel.reload();
    await panel
      .getByTestId("first-run-kb-5.x")
      .and(panel.locator("[data-state=ok]"))
      .waitFor({ timeout: 30_000 });
    assert.equal(await state(panel, "kb-4.x"), "ok");
    assert.equal(await state(panel, "ai"), "ok");
    assert.equal(await state(panel, "client"), "todo");
    await panel.close();
    await app.close();
  });
});
