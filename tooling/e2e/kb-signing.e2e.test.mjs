/**
 * KB-RAG K23 (in K25, A7): only signed, current KB packs are used. In
 * Chrome, on the E2E policy build: a demo pack signed with the demo key
 * imports and says who signed it and when it expires; a pack whose card text
 * was changed after signing is refused and the loaded pack stays; an
 * unsigned pack is refused; a pack the policy expires (maxPackAgeDays) or
 * whose key it revokes stops answering at the next question, with no
 * re-import, and Options, the chat and Preflight say why. The Options card
 * with a used and an unused pack passes axe in both themes. Synthetic cards
 * and keys made at run time only.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  describeViolations,
  extensionPage,
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
  TEST_KEY,
  TEST_KEY_POLICY,
  tamperedPack,
  writeFixturePack,
} from "./kb-fixture.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

let browser;
let model;
let site;
let dir;

const DAY = 86_400_000;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "RESULT: from the model" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser({ extensionDir: ensurePolicyBuild() });
  dir = tempDir("apty-kb-signing-");
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function knowledgeBaseCard() {
  const options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html?tab=general#knowledge-base",
  );
  const card = options.locator("#knowledge-base");
  await card.waitFor();
  return { options, card };
}

async function tryImport(file) {
  const { options, card } = await knowledgeBaseCard();
  await card.getByTestId("knowledge-base-file").setInputFiles(file);
  return { options, card };
}

describe("signed KB packs (KB-RAG K23)", () => {
  it("imports a demo pack signed with the demo key and shows who signed it and when it expires", async () => {
    await setTestPolicy(browser, {});
    const { file } = writeFixturePack(dir, { name: "demo.kbpack.json" });
    await importPack(browser, file);
    const { options, card } = await knowledgeBaseCard();
    const row = card.getByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    await row
      .getByText(/^Signed by Apty demo key \(key [0-9a-f]{16}\)$/)
      .waitFor();
    assert.equal(await row.getByTestId("kb-pack-state").innerText(), "Current");
    await options.close();
  });

  it("refuses a pack whose card text changed after signing, and keeps the loaded pack", async () => {
    const { pack } = writeFixturePack(dir, { name: "signed.kbpack.json" });
    const file = join(dir, "tampered.kbpack.json");
    writeFileSync(file, JSON.stringify(tamperedPack(pack)));
    const { options, card } = await tryImport(file);
    await card
      .getByText("This pack's signature does not match its content.")
      .waitFor();
    await card
      .getByRole("region", { name: "Loaded knowledge base (5.x)" })
      .waitFor();
    await options.close();
  });

  it("refuses an unsigned pack under a policy that does not allow one", async () => {
    const { file } = writeFixturePack(dir, {
      name: "unsigned.kbpack.json",
      signer: "none",
    });
    const { options, card } = await tryImport(file);
    await card
      .getByText("This pack is not signed by a key this extension trusts.")
      .waitFor();
    await options.close();
  });

  it("a pack the policy expires stops answering at the next question, and the chat and Options say why", async () => {
    await setTestPolicy(browser, TEST_KEY_POLICY);
    const { file } = writeFixturePack(dir, {
      name: "real-5x.kbpack.json",
      site: NON_DEMO_SITE,
      space: "RL",
      builtAt: new Date(Date.now() - 3 * DAY).toISOString(),
    });
    await importPack(browser, file);

    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(panel, "the tooltip opens twice when I hover the help icon");
    await panel
      .getByRole("region", { name: "KB cards that match" })
      .first()
      .waitFor({ timeout: 30_000 });

    // The policy now caps a pack's life at 1 day: no re-import.
    await setTestPolicy(browser, { ...TEST_KEY_POLICY, maxPackAgeDays: 1 });
    await sendChat(panel, "the tooltip opens twice when I hover the help icon");
    const line = panel.getByTestId("kb-decision-line");
    await line.waitFor({ timeout: 30_000 });
    assert.match(
      await line.innerText(),
      /^The 5\.x pack expired on \d{4}-\d{2}-\d{2}\. Connect an AI provider to ask the AI model\.$/,
    );

    const { options, card } = await knowledgeBaseCard();
    const row = card.getByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    assert.match(
      await row.getByTestId("kb-pack-state").innerText(),
      /^Expired on \d{4}-\d{2}-\d{2}$/,
    );
    await row
      .getByText("This pack is not used. Ask the KB owner for a new pack.")
      .waitFor();
    await options.close();
    await panel.close();
    await app.close();
  });

  it("revoking the key of a loaded pack stops it at the next question", async () => {
    await setTestPolicy(browser, TEST_KEY_POLICY);
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(panel, "the tooltip opens twice when I hover the help icon");
    await panel
      .getByRole("region", { name: "KB cards that match" })
      .first()
      .waitFor({ timeout: 30_000 });
    await setTestPolicy(browser, {
      ...TEST_KEY_POLICY,
      revokedPackKeyIds: [TEST_KEY.keyId],
    });
    const { options, card } = await knowledgeBaseCard();
    assert.equal(
      await card
        .getByRole("region", { name: "Loaded knowledge base (5.x)" })
        .getByTestId("kb-pack-state")
        .innerText(),
      "Signed by a revoked key",
    );
    await options.close();
    await panel.close();
    await app.close();
  });

  for (const theme of ["light", "dark"]) {
    it(`the Options card with a used and an unused pack passes axe (${theme})`, async () => {
      await setTestPolicy(browser, { ...TEST_KEY_POLICY, maxPackAgeDays: 1 });
      const settings = await extensionPage(browser);
      await settings.evaluate(
        (t) => chrome.storage.local.set({ apty_theme: t }),
        theme,
      );
      await settings.close();
      const { options, card } = await knowledgeBaseCard();
      await card
        .getByRole("region", { name: "Loaded knowledge base (5.x)" })
        .getByText("This pack is not used. Ask the KB owner for a new pack.")
        .waitFor();
      await options.waitForFunction(
        (dark) => document.documentElement.classList.contains("dark") === dark,
        theme === "dark",
      );
      const violations = await runAxe(options);
      assert.deepEqual(violations, [], describeViolations(violations));
      await options.close();
    });
  }
});
