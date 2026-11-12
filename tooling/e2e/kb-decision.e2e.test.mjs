/**
 * KB-RAG K25, A2: every KB decision is visible. With no AI key, a question
 * the cards do not cover says so with its numbers in place of the generic
 * "connect an AI provider" text; with the tab set to 4.x and only a 5.x pack
 * loaded, "No 4.x pack is loaded". With a key, the model's reply carries one
 * quiet line saying why no card answered, and "Why this answer" holds the
 * route, version, packs and outcome, never the question. Synthetic cards
 * only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

const OFF_TOPIC = "how much does an Apty licence cost per seat";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "RESULT: from the model" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const { file } = writeFixturePack(tempDir("apty-kb-decision-"));
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function panelWith(settings = {}) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app, settings);
  for (const page of browser.context.pages()) {
    if (page.url().includes("/options/")) await page.close();
  }
  return { app, panel };
}

describe("visible KB decisions (KB-RAG K25, A2)", () => {
  it("no key: a question the cards do not cover shows the reason with its numbers", async () => {
    const { app, panel } = await panelWith({ aiToken: "" });
    await sendChat(panel, OFF_TOPIC);
    const line = panel.getByTestId("kb-decision-line");
    await line.waitFor({ timeout: 30_000 });
    assert.match(
      await line.innerText(),
      /^No KB card matched \(coverage \d\.\d\d, needs \d\.\d\d\)\. Connect an AI provider to ask the AI model\.$/,
    );
    assert.equal(await panel.getByText("Add your own API key").count(), 0);
    await panel.close();
    await app.close();
  });

  it("no key: with the tab set to 4.x and no 4.x pack, says no 4.x pack is loaded", async () => {
    const { app, panel } = await panelWith({ aiToken: "" });
    await sendChat(panel, "the tooltip opens twice when I hover the help icon");
    const card = panel.getByRole("region", { name: "KB cards that match" });
    await card.waitFor({ timeout: 30_000 });
    await card
      .getByRole("radiogroup", { name: "Apty version" })
      .getByRole("radio", { name: "4.x" })
      .click();
    await sendChat(panel, "the tooltip opens twice when I hover the help icon");
    const line = panel.getByTestId("kb-decision-line");
    await line.waitFor({ timeout: 30_000 });
    assert.equal(
      await line.innerText(),
      "No 4.x pack is loaded. Connect an AI provider to ask the AI model.",
    );
    await panel.close();
    await app.close();
  });

  it("with a key: one quiet line above the model's reply, and Why this answer holds no question text", async () => {
    const { app, panel } = await panelWith();
    await chatAndWait(panel, OFF_TOPIC);
    const line = panel.getByTestId("kb-decision-line").last();
    assert.match(
      await line.innerText(),
      /^No KB card matched \(coverage \d\.\d\d, needs \d\.\d\d\)\. Asked the AI model\.$/,
    );
    const why = panel.getByTestId("turn-decision").last();
    await why.getByText("Why this answer").click();
    const text = await why.innerText();
    assert.match(text, /Answered by: the AI model/);
    assert.match(text, /Apty version: unknown \(not known\)/);
    assert.match(text, /Packs searched: 5\.x [0-9a-f]{12}/);
    assert.match(text, /KB: not covered/);
    assert.doesNotMatch(text, /licence|seat/);
    await panel.close();
    await app.close();
  });
});
