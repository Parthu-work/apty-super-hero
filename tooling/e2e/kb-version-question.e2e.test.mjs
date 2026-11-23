/**
 * KB-RAG K29, D3: with a 4.x and a 5.x pack that both hold a card for the
 * same symptom and the site's version not known, the answer asks once
 * "Which Apty version does 127.0.0.1 run?". Choosing 5.x hides the 4.x
 * card in that answer and the next; the header's version chip changes it
 * back; the answer is kept on the device, so a reloaded panel does not ask
 * again, and Not sure keeps both versions grouped in the fold. No model
 * request; axe clean in both themes. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  axeInBothThemes,
  describeViolations,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { fixturePage, importPack, writeFixturePack } from "./kb-fixture.mjs";

const LAYERS = [
  "In Studio, turn off the FIXTURE Hover Pulse.",
  "FIXTURE: two hover handlers on the badge.",
  "FIXTURE pulse.json lists pulseRate.",
  "Send support: the FIXTURE version.",
];
const SYMPTOM = "the FIXTURE badge flickers on hover";
const QUESTION = /^Which Apty version does 127\.0\.0\.1 run\?$/;

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
  const dir = tempDir("apty-kb-version-question-");
  for (const [aptyVersion, space, id] of [
    ["4.x", "A4X", "4401"],
    ["5.x", "JX", "5501"],
  ]) {
    const { file } = writeFixturePack(dir, {
      aptyVersion,
      space,
      pages: [fixturePage(id, "FIXTURE badge flickers on hover", LAYERS)],
    });
    await importPack(browser, file);
  }
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function freshPanel() {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app, { aiToken: "" });
  return { app, panel };
}

const answers = (panel) =>
  panel.getByRole("region", { name: "KB cards that match" });
const cardLink = (region, id) => region.locator(`a[href$="/pages/${id}"]`);

describe("ask the version once per site (KB-RAG K29, D3)", () => {
  it("asks once, 5.x hides the 4.x card in that answer and the next, and the header chip changes it back", async () => {
    const { app, panel } = await freshPanel();
    await sendChat(panel, SYMPTOM);
    const first = answers(panel).first();
    await first.waitFor({ timeout: 30_000 });
    const question = panel.getByRole("group", { name: QUESTION });
    await question.waitFor();
    assert.deepEqual(
      (await question.getByRole("button").allInnerTexts()).map((t) => t.trim()),
      ["4.x", "5.x", "Not sure"],
    );
    const violations = await axeInBothThemes(panel);
    assert.deepEqual(violations, [], describeViolations(violations));

    await question.getByRole("button", { name: "5.x" }).click();
    await question.waitFor({ state: "detached" });
    await cardLink(first, "5501").waitFor();
    assert.equal(await cardLink(first, "4401").count(), 0);

    await sendChat(panel, SYMPTOM);
    const second = answers(panel).nth(1);
    await cardLink(second, "5501").waitFor({ timeout: 30_000 });
    assert.equal(await cardLink(second, "4401").count(), 0);
    assert.equal(await panel.getByRole("group", { name: QUESTION }).count(), 0);

    const chip = panel.getByTestId("kb-version-chip").filter({ visible: true });
    assert.match(await chip.innerText(), /5\.x, your choice/);
    await chip.click();
    await panel.getByRole("menuitemradio", { name: "4.x" }).click();
    await cardLink(second, "4401").waitFor();
    assert.equal(await cardLink(second, "5501").count(), 0);
    assert.equal(await cardLink(first, "5501").count(), 0);
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });

  it("does not ask again after a panel reload; Not sure keeps both versions under 4.x and 5.x headings", async () => {
    const { app, panel } = await freshPanel();
    const chip = panel.getByTestId("kb-version-chip").filter({ visible: true });
    await chip.waitFor();
    assert.match(await chip.innerText(), /4\.x, your choice/);
    await chip.click();
    await panel.getByRole("menuitemradio", { name: "Not sure" }).click();
    await sendChat(panel, SYMPTOM);
    const answer = answers(panel).first();
    await answer.waitFor({ timeout: 30_000 });
    assert.equal(await panel.getByRole("group", { name: QUESTION }).count(), 0);
    await answer.getByRole("button", { name: "1 other possible card" }).click();
    const fold = answer.getByRole("list", { name: /^[45]\.x$/ });
    assert.equal(await fold.count(), 1);
    assert.equal(await answer.getByRole("article").count(), 1);
    assert.equal(
      (await cardLink(answer, "4401").count()) +
        (await answer.getByRole("button", { name: /, 4\.x$/ }).count()),
      1,
    );
    assert.equal(
      (await cardLink(answer, "5501").count()) +
        (await answer.getByRole("button", { name: /, 5\.x$/ }).count()),
      1,
    );
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });
});
