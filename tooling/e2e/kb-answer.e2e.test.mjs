/**
 * KB-RAG K4: with a pack loaded, a product follow-up offers search_kb, the
 * model's call reaches the pack, the chunk it cites reaches the model in
 * the tool result, and the answer's kb:// citation renders as a link to
 * the card. Mock model and synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  tempDir,
  toolResults,
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

const toolNames = (request) =>
  (request.tools ?? []).map((t) => t.function?.name ?? t.name);

describe("search_kb in a follow-up answer (KB-RAG K4)", () => {
  it("names no pack before one is imported", async () => {
    model.script((request) =>
      toolResults(request).length === 0
        ? { tool: "search_kb", args: { query: "Glowing Banner" } }
        : { text: `RESULT: ${JSON.stringify(toolResults(request).at(-1))}` },
    );
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    const reply = await chatAndWait(
      panel,
      "how do I turn the banner glow on in Studio?",
    );
    assert.match(reply, /"status":"no_pack"/);
    await panel.close();
    await app.close();
  });

  it("answers from the cited card, and links the citation to it", async () => {
    const { file } = writeFixturePack(tempDir("apty-kb-answer-"));
    await importPack(browser, file);
    model.requests.length = 0;
    model.script((request) => {
      const results = toolResults(request);
      if (results.length === 0) {
        return {
          tool: "search_kb",
          args: { query: "turn on banner glow", topK: 2 },
        };
      }
      const cite = results.at(-1).results[0].cite;
      return {
        text: `RESULT: In Studio, turn on the Glowing Banner setting (${cite}).`,
      };
    });
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    await chatAndWait(panel, "how do I turn the banner glow on in Studio?");

    const [first, second] = model.requests;
    assert.ok(toolNames(first).includes("search_kb"), toolNames(first).join());
    assert.match(
      first.messages[0].content,
      /APTY PRODUCT FACTS COME FROM THE KB CARDS/,
    );
    const [result] = toolResults(second);
    assert.equal(result.status, "ok");
    assert.equal(result.results[0].cite, "kb://101#L1");
    assert.match(result.results[0].text, /Glowing Banner setting/);
    assert.equal(
      result.results[0].verifiedOn,
      "Verified on: FIXTURE code, 2026-01-01.",
    );

    // Streamdown shows every link as a button that asks before opening it.
    const link = panel.getByRole("button", { name: "KB card 101, layer 1" });
    await link.click();
    await panel
      .getByText("https://apty.atlassian.net/wiki/spaces/JA/pages/101")
      .waitFor();
    await panel.close();
    await app.close();
  });
});
