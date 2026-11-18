/**
 * KB-RAG K27, F2: a question naming a setting no KB card has is answered by
 * the KB, with zero model requests: the missing name and the closest cards.
 * "Ask the AI anyway" sends it to the model with the fixed instruction, and
 * the model's answer is labelled "Not from the KB or a check", with a menu
 * path in it flagged. Synthetic cards only.
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
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

const INSTRUCTION =
  "The Apty KB has no card for this. Do not describe Apty settings, menus, paths, prices or features.";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({
    text: "RESULT: I do not know. Admin Portal → Applications → Settings might hold it.",
  }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const { file } = writeFixturePack(tempDir("apty-kb-unknown-"));
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("a setting no KB card has (KB-RAG K27, F2)", () => {
  it("is answered by the KB with zero model requests; Ask the AI anyway sends the instruction and the answer is labelled", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    await sendChat(
      panel,
      "the banner never glows after I turn on the FIXTURE Glow Pulse Switch",
    );
    const card = panel.getByTestId("kb-unknown-setting");
    await card.waitFor({ timeout: 30_000 });
    assert.match(
      await card.innerText(),
      /The KB has no setting called "FIXTURE Glow Pulse Switch"\./,
    );
    assert.match(await card.innerText(), /Closest cards/);
    assert.equal(model.requests.length, 0, "no model request");

    await card.getByRole("button", { name: "Ask the AI anyway" }).click();
    await panel.getByText(/^RESULT:/).waitFor({ timeout: 30_000 });
    assert.equal(model.requests.length, 1);
    const system = model.requests[0].messages.find((m) => m.role === "system");
    assert.ok(
      JSON.stringify(system?.content ?? "").includes(INSTRUCTION),
      "the fixed instruction is in the system prompt",
    );
    await panel.getByTestId("not-from-kb").last().waitFor();
    await panel
      .getByText(/Not found in the KB: Admin Portal → Applications → Settings/)
      .waitFor({ timeout: 10_000 });
    await panel.close();
    await app.close();
  });
});
