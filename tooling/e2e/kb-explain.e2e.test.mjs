/**
 * KB-RAG K27, E6: after the KB answers a symptom with no model call, a
 * follow-up goes to the model with the explain instruction (not the
 * no-card one); the model gets the card ids, and the card text only when
 * the policy lets it go (a demo pack's does, a non-demo pack's does not).
 * The answer is labelled as explaining the cards above, and a phrase the
 * card holds is not flagged. Mock model and synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  describeViolations,
  launchBrowser,
  openSidePanel,
  runAxe,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import {
  importPack,
  NON_DEMO_SITE,
  TEST_KEY_POLICY,
  writeFixturePack,
} from "./kb-fixture.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

const EXPLAIN =
  "This conversation already holds Apty check results and KB cards.";
const NO_CARD = "The Apty KB has no card for this.";
const ANSWER =
  "RESULT: Turn on Glowing Banner (kb://101#L1). Does the banner glow now?";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: ANSWER }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  // The E2E policy build: the non-demo pack is trusted by its run-time key.
  browser = await launchBrowser({ extensionDir: ensurePolicyBuild() });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

const systemOf = (request) =>
  JSON.stringify(
    request.messages.find((m) => m.role === "system")?.content ?? "",
  );

async function kbAnswerThenFollowUp(panel) {
  model.requests.length = 0;
  await sendChat(panel, "the banner never glows on the home page");
  await panel
    .getByRole("region", { name: "KB cards that match" })
    .last()
    .waitFor({ timeout: 30_000 });
  assert.equal(model.requests.length, 0, "the KB answered with no model call");
  await chatAndWait(panel, "can you put that more simply?");
  assert.equal(model.requests.length, 1);
  return model.requests[0];
}

describe("a model that explains the KB's answer (KB-RAG K27, E6)", () => {
  it("sends the explain instruction and, for a demo pack, the card text; labels and grounds the answer; axe clean", async () => {
    const { file } = writeFixturePack(tempDir("apty-kb-explain-demo-"));
    await importPack(browser, file);
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);

    const request = await kbAnswerThenFollowUp(panel);
    assert.ok(systemOf(request).includes(EXPLAIN), "explain instruction");
    assert.ok(!systemOf(request).includes(NO_CARD), "no no-card instruction");
    assert.match(JSON.stringify(request), /Glowing Banner/);

    await panel.getByTestId("explains-evidence").last().waitFor();
    assert.equal(await panel.getByTestId("not-from-kb").count(), 0);
    assert.equal(await panel.locator("[data-kb-ungrounded]").count(), 0);
    assert.equal(await panel.getByText(/^Not found in/).count(), 0);

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
    await panel.close();
    await app.close();
  });

  it("sends only the card ids when the policy withholds a non-demo pack's text", async () => {
    await setTestPolicy(browser, TEST_KEY_POLICY);
    const { file } = writeFixturePack(tempDir("apty-kb-explain-real-"), {
      site: NON_DEMO_SITE,
    });
    await importPack(browser, file);
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);

    const request = await kbAnswerThenFollowUp(panel);
    const body = JSON.stringify(request);
    assert.ok(systemOf(request).includes(EXPLAIN), "explain instruction");
    assert.doesNotMatch(body, /Glowing Banner/);
    assert.match(
      body,
      /KB card text withheld by organization policy\. Cards shown to the user: 101/,
    );
    await panel.getByTestId("explains-evidence").last().waitFor();
    await panel.close();
    await app.close();
  });
});
