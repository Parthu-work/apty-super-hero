/**
 * KB-RAG K25, A4: a demo pack with one "No 4.x equivalent" card. Asked about
 * that feature with no AI key, the KB matches card says it does not exist
 * in Apty 4.x, with the card's reason and link, and shows no nearby card.
 * Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { FIXTURE_PAGES, importPack, writeFixturePack } from "./kb-fixture.mjs";

const ABSENT_PAGE = {
  id: "909",
  title: "RAG Card: FIXTURE drop-off funnel chart for walkthroughs",
  group: "FIXTURE group",
  updatedAt: "2026-02-01T00:00:00.000Z",
  body: "<p>Symptom: the FIXTURE funnel chart that shows where users leave a walkthrough.</p><p>No 4.x equivalent: the FIXTURE funnel chart arrived with the 5.x analytics. There is no setting for it in 4.x.</p><p>This page is not an answer card.</p>",
};

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
  const { file } = writeFixturePack(tempDir("apty-kb-absent-"), {
    pages: [...FIXTURE_PAGES, ABSENT_PAGE],
    aptyVersion: "4.x",
  });
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe('"not in this version" cards (KB-RAG K25, A4)', () => {
  it("says the feature does not exist in Apty 4.x, with the reason and the link, and no other card", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(
      panel,
      "the drop-off funnel chart for walkthroughs is missing",
    );
    const block = panel.getByTestId("kb-not-in-version");
    await block.waitFor({ timeout: 30_000 });
    const text = await block.innerText();
    assert.match(text, /This does not exist in Apty 4\.x\./);
    assert.match(text, /arrived with the 5\.x analytics/);
    assert.equal(
      await block
        .getByRole("link", { name: /FIXTURE drop-off funnel chart/ })
        .getAttribute("href"),
      "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/909",
    );
    const card = panel.getByRole("region", { name: "KB cards that match" });
    assert.equal(await card.getByRole("link").count(), 1);
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });
});
