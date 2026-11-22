/**
 * KB-RAG K27, F2: a question naming a setting no KB card has is answered by
 * the KB, with zero model requests: the missing name and the closest cards.
 * "Ask the AI anyway" sends it to the model with the fixed instruction, and
 * the model's answer is labelled "Not from the KB or a check", with a menu
 * path in it flagged. K29, B6: the request carries the KB's outcome as a
 * fact, a sentence guessing where the setting is gets flagged, product
 * names do not, and Why this answer names the KB outcome the turn follows.
 * Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  describeViolations,
  launchBrowser,
  openSidePanel,
  runAxe,
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
    text: "RESULT: I do not know. Admin Portal → Applications → Settings might hold it. The switch may be in the application settings area. Ask Apty Support, or check Apty Studio.",
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
    assert.equal(
      await panel
        .getByText(/^Not found in the KB:/)
        .last()
        .innerText(),
      "Not found in the KB: Admin Portal → Applications → Settings",
      "product names are not flagged",
    );
    assert.ok(
      JSON.stringify(system?.content ?? "").includes(
        "The Apty KB has no setting named 'FIXTURE Glow Pulse Switch'.",
      ),
      "the KB's outcome is a fact in the system prompt",
    );
    await panel.getByTestId("kb-location-guess").last().waitFor();
    const guess = panel.locator("[data-kb-ungrounded]", {
      hasText: "The switch may be in the application settings area.",
    });
    assert.equal(await guess.count(), 1, "the location sentence is flagged");
    const why = panel.getByTestId("turn-decision").last();
    await why.getByText("Why this answer").click();
    assert.match(
      await why.innerText(),
      /KB: no setting named FIXTURE Glow Pulse Switch/,
    );
    assert.doesNotMatch(await why.innerText(), /Packs searched: none/);
    await panel.close();
    await app.close();
  });
});
