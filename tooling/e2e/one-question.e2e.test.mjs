/**
 * KB-RAG K28, F5: a model reply that ends with three questions shows the
 * first and folds the other two under "More questions", in light and dark,
 * by keyboard. No text is lost. Synthetic content only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  axeInBothThemes,
  chatAndWait,
  describeViolations,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

const REPLY = [
  "RESULT: I need a little more to go on.",
  "",
  "1. Which segment should see FIXTURE workflow?",
  "2. Is FIXTURE workflow published?",
  "3. Does it fail for every user?",
].join("\n");

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: REPLY }));
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

describe("one question per turn (KB-RAG K28, F5)", () => {
  it("shows one question and folds two, with no text lost", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    await chatAndWait(panel, "please summarise what this page is for", {
      pattern: /^RESULT:/,
    });
    const more = panel.getByTestId("more-questions");
    await more.waitFor({ timeout: 30_000 });
    assert.equal(await more.getAttribute("open"), null, "starts collapsed");
    const message = panel
      .locator('[data-testid="more-questions"]')
      .locator("..");
    const visible = await message.innerText();
    assert.match(visible, /Which segment should see FIXTURE workflow\?/);
    assert.doesNotMatch(visible, /Is FIXTURE workflow published\?/);

    await more.locator("summary").focus();
    await panel.keyboard.press("Enter");
    assert.notEqual(await more.getAttribute("open"), null, "opens by keyboard");
    const all = await message.innerText();
    for (const line of [
      "I need a little more to go on.",
      "Which segment should see FIXTURE workflow?",
      "Is FIXTURE workflow published?",
      "Does it fail for every user?",
    ]) {
      assert.ok(all.includes(line), line);
    }
    const violations = await axeInBothThemes(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await panel.close();
    await app.close();
  });
});
