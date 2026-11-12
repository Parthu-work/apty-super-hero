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
import {
  importPack,
  NON_DEMO_SITE,
  TEST_KEY_POLICY,
  writeFixturePack,
} from "./kb-fixture.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  // The E2E policy build: the non-demo pack test trusts its run-time key (K23 P2).
  browser = await launchBrowser({ extensionDir: ensurePolicyBuild() });
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
    assert.equal(result.results[0].site, "fixture.atlassian.invalid");
    assert.equal(result.results[0].space, "FX");
    assert.equal(result.results[0].aptyVersion, "5.x");
    assert.match(result.results[0].text, /Glowing Banner setting/);
    assert.equal(
      result.results[0].verifiedOn,
      "Verified on: FIXTURE code, 2026-01-01.",
    );

    // Streamdown shows every link as a button that asks before opening it.
    const link = panel.getByRole("button", { name: "KB card 101, layer 1" });
    await link.click();
    await panel
      .getByText("https://fixture.atlassian.invalid/wiki/spaces/FX/pages/101")
      .waitFor();
    await panel.close();
    await app.close();
  });

  it("returns not covered for a question the loaded pack does not cover, with the instruction not to invent a setting", async () => {
    model.requests.length = 0;
    model.script((request) => {
      const results = toolResults(request);
      if (results.length === 0) {
        return {
          tool: "search_kb",
          args: { query: "kubernetes helm chart rollout" },
        };
      }
      return { text: "RESULT: The KB does not cover this." };
    });
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    await chatAndWait(
      panel,
      "how do I set up a kubernetes helm rollout in Admin?",
    );

    const [first, second] = model.requests;
    assert.match(
      first.messages[0].content,
      /If search_kb returns not_covered or no_pack, say the KB does not cover it/,
    );
    assert.match(
      first.messages[0].content,
      /Never name an Apty setting, field or menu that is not in a returned chunk/,
    );
    assert.deepEqual(toolResults(second), [
      {
        status: "not_covered",
        source: "kb",
        cards: [],
        reason: "no_match",
        results: [],
      },
    ]);
    assert.equal(
      await panel.getByRole("button", { name: /^KB card / }).count(),
      0,
    );
    await panel.close();
    await app.close();
  });

  it("withholds card text once a non-demo pack is loaded, earlier results included, and offers no search_kb (KB-RAG K22)", async () => {
    model.script((request) => {
      const results = toolResults(request);
      if (results.length === 0 && toolNames(request).includes("search_kb")) {
        return { tool: "search_kb", args: { query: "turn on banner glow" } };
      }
      return { text: "RESULT: answered" };
    });
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    // A demo pack: search_kb is offered and its text reaches the model.
    await chatAndWait(panel, "how do I turn the banner glow on in Studio?");
    assert.match(JSON.stringify(model.requests.at(-1)), /Glowing Banner/);

    await setTestPolicy(browser, TEST_KEY_POLICY);
    const { file } = writeFixturePack(tempDir("apty-kb-answer-real-"), {
      site: NON_DEMO_SITE,
    });
    await importPack(browser, file);
    model.requests.length = 0;
    // A bare how-to, so the model answers it, not the local KB matches.
    await chatAndWait(panel, "how do I turn the banner glow off in Studio?");

    const [request] = model.requests;
    assert.equal(toolNames(request).includes("search_kb"), false);
    assert.doesNotMatch(
      request.messages[0].content,
      /APTY PRODUCT FACTS COME FROM THE KB CARDS/,
    );
    const body = JSON.stringify(request);
    assert.doesNotMatch(body, /Glowing Banner/);
    assert.match(
      body,
      /KB card text withheld by organization policy\. Cards shown to the user: 101/,
    );
    await panel.close();
    await app.close();
  });
});
