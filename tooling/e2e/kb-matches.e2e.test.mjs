/**
 * KB-RAG K6, K16: with a KB pack loaded and no AI key, a message no check
 * pack claims gets the KB matches card with no model request, for every
 * family of symptom words; a bare how-to still asks for an AI provider
 * (D-KB1); a question in another script gets the English-cards notice.
 * The card passes axe in both themes. Synthetic cards only.
 */
import assert from "node:assert/strict";
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
  FIXTURE_PAGES,
  fixturePage,
  importPack,
  writeFixturePack,
} from "./kb-fixture.mjs";

const SYMPTOM_PAGES = [
  fixturePage("303", "FIXTURE badge flickers on hover", [
    "In Studio, turn off the FIXTURE Hover Pulse.",
    "FIXTURE: two hover handlers on the badge.",
    "FIXTURE pulse.json lists pulseRate.",
    "Send support: the FIXTURE version.",
  ]),
  fixturePage("404", "FIXTURE editor freezes when saving", [
    "In Admin, lower the FIXTURE Autosave Rate.",
    "FIXTURE: the editor frame blocks while saving.",
    "FIXTURE autosave.json lists saveRate.",
    "Send support: the FIXTURE version.",
  ]),
  fixturePage("505", "FIXTURE survey repeats at each login", [
    "In Studio, set the FIXTURE Survey Frequency to once.",
    "FIXTURE: the survey cookie is missing.",
    "FIXTURE frequency.json lists showCount.",
    "Send support: the FIXTURE version.",
  ]),
  fixturePage("606", "FIXTURE tour skips the second step", [
    "In Studio, clear the FIXTURE Auto Advance option.",
    "FIXTURE: the second step's element loads late.",
    "FIXTURE steps.json lists advanceMode.",
    "Send support: the FIXTURE version.",
  ]),
];

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
  const { file } = writeFixturePack(tempDir("apty-kb-matches-"), {
    pages: [...FIXTURE_PAGES, ...SYMPTOM_PAGES],
  });
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

const optionsTabs = () =>
  browser.context.pages().filter((p) => p.url().includes("/options/"));

async function panelWithoutKey(theme) {
  const settings = await extensionPage(browser);
  await settings.evaluate(
    (t) => chrome.storage.local.set({ apty_theme: t }),
    theme,
  );
  await settings.close();
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app, { aiToken: "" });
  for (const page of optionsTabs()) await page.close();
  await panel.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    theme === "dark",
  );
  return { app, panel };
}

describe("KB matches card (KB-RAG K6)", () => {
  for (const theme of ["light", "dark"]) {
    it(`answers a symptom no check pack claims from the KB pack, with no AI key and no model request, axe clean (${theme})`, async () => {
      const { app, panel } = await panelWithoutKey(theme);
      await sendChat(
        panel,
        "the tooltip opens twice when I hover the help icon",
      );
      const card = panel.getByRole("region", { name: "KB cards that match" });
      await card.waitFor({ timeout: 30_000 });
      const link = card.getByRole("link", {
        name: /FIXTURE tooltip opens twice/,
      });
      assert.equal(
        await link.first().getAttribute("href"),
        "https://apty.atlassian.net/wiki/spaces/JA/pages/202",
      );
      await card
        .getByText("Verified on: FIXTURE code, 2026-01-01.")
        .first()
        .waitFor();
      assert.equal(model.requests.length, 0, "no model request");
      assert.equal(await panel.getByText("Connect an AI provider").count(), 0);
      const violations = await runAxe(panel);
      assert.deepEqual(violations, [], describeViolations(violations));
      assert.deepEqual(panel.consoleErrors, []);
      await panel.close();
      await app.close();
    });
  }

  it("answers every family of symptom words from the KB, with no model request (K16)", async () => {
    const { app, panel } = await panelWithoutKey("light");
    for (const [question, title] of [
      ["the badge keeps flickering", /FIXTURE badge flickers on hover/],
      ["the editor hangs when I save", /FIXTURE editor freezes when saving/],
      ["the survey keeps coming back at every login", /FIXTURE survey repeats/],
      ["the tour jumps over the second step", /FIXTURE tour skips/],
    ]) {
      await sendChat(panel, question);
      await panel
        .getByRole("region", { name: "KB cards that match" })
        .last()
        .getByRole("link", { name: title })
        .first()
        .waitFor({ timeout: 30_000 });
    }
    assert.equal(model.requests.length, 0, "no model request");
    assert.equal(await panel.getByText("Connect an AI provider").count(), 0);
    await panel.close();
    await app.close();
  });

  it("tells the user the cards are in English when the question is not, with no AI key", async () => {
    const { app, panel } = await panelWithoutKey("light");
    await sendChat(panel, "小部件的提示框一直闪烁");
    await panel
      .getByText(
        "The KB cards are in English. Ask in English, or send the question to the model.",
      )
      .waitFor({ timeout: 30_000 });
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });

  it("leaves a bare how-to to the model, which needs an AI provider (D-KB1)", async () => {
    const { app, panel } = await panelWithoutKey("light");
    await sendChat(panel, "how do I configure the Double Trigger setting");
    await panel.getByText("Connect an AI provider").waitFor();
    assert.equal(
      await panel.getByRole("region", { name: "KB cards that match" }).count(),
      0,
    );
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });
});
