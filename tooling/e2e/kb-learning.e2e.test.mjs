/**
 * KB-RAG K27, E7: the learning loop on the device. Wrong card picks the
 * right card by its title from a combobox, by keyboard alone; This helped
 * marks a card; a question the KB does not cover shows the closest cards
 * as "closest, may not match" under the model's answer; and Options →
 * Feedback exports the words the right card lacks as proposed synonyms,
 * only with the questions included, and never changes the pack. Synthetic
 * cards only; nothing is sent while exporting.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

const QUESTION = "the tooltip opens twice when I hover the help icon";
const UNCOVERED = "banner kubernetes helm rollout canary";

let browser;
let model;
let site;
let packText;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "RESULT: I do not know this one." }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const { file } = writeFixturePack(tempDir("apty-kb-learning-"));
  packText = readFileSync(file, "utf8");
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function inBothThemes(page, check) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => chrome.storage.local.set({ apty_theme: t }),
      theme,
    );
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains("dark") === dark,
      theme === "dark",
    );
    await check(theme);
  }
}

async function noViolations(page, theme) {
  const violations = await runAxe(page);
  assert.deepEqual(
    violations,
    [],
    `${theme}: ${describeViolations(violations)}`,
  );
}

describe("the learning loop (KB-RAG K27, E7)", () => {
  it("marks a card as helpful, and picks the right card by title with the keyboard", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(panel, QUESTION);
    const card = panel.getByRole("region", { name: "KB cards that match" });
    await card.waitFor({ timeout: 30_000 });

    await card.getByRole("button", { name: "This helped: 202" }).click();
    await card.getByText("Marked as helpful. Thank you.").waitFor();

    await card.getByRole("button", { name: "Wrong card: 202" }).click();
    const picker = card.getByRole("combobox", { name: /Which card was right/ });
    await picker.focus();
    await panel.keyboard.type("banner");
    const list = card.getByRole("listbox", { name: "Matching cards" });
    await list.waitFor();
    await inBothThemes(panel, (theme) => noViolations(panel, theme));
    assert.equal(await list.getByRole("option").count(), 1);
    await panel.keyboard.press("ArrowUp");
    await panel.keyboard.press("ArrowDown");
    const option = list.getByRole("option", { name: /banner never glows/ });
    assert.equal(await option.getAttribute("aria-selected"), "true");
    assert.equal(
      await picker.getAttribute("aria-activedescendant"),
      await option.getAttribute("id"),
    );
    await panel.keyboard.press("Enter");
    await list.waitFor({ state: "detached" });
    await card
      .getByText("Right card: FIXTURE banner never glows (101)")
      .waitFor();
    await panel.keyboard.press("Enter");
    await card.getByText("Recorded. Thank you.").waitFor();
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });

  it("shows the closest cards, marked may not match, under the model's answer to a question the KB does not cover", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    await sendChat(panel, UNCOVERED);
    await panel.getByText("RESULT: I do not know this one.").waitFor({
      timeout: 30_000,
    });
    const closest = panel.getByRole("region", {
      name: "Closest KB cards, may not match",
    });
    await closest.waitFor({ timeout: 10_000 });
    assert.equal(
      await closest
        .getByRole("link", { name: /FIXTURE banner never glows/ })
        .getAttribute("href"),
      "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/101",
    );
    await panel.getByTestId("not-from-kb").last().waitFor();
    const sent = JSON.stringify(model.requests);
    assert.doesNotMatch(sent, /closestPageIds|banner never glows/);
    await inBothThemes(panel, (theme) => noViolations(panel, theme));
    await panel.close();
    await app.close();
  });

  it("exports the words the right card lacks as proposed synonyms, only with the questions included, and leaves the pack as it was", async () => {
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=general#feedback",
    );
    const requests = [];
    options.on("request", (request) => {
      if (!request.url().startsWith("chrome-extension://")) {
        requests.push(request.url());
      }
    });
    const card = options.locator("#feedback");
    await card.getByTestId("feedback-count").getByText("2 entries").waitFor();
    const exportButton = card.getByRole("button", {
      name: "Export proposed synonyms",
    });
    assert.equal(await exportButton.isDisabled(), true);
    await card.getByText(/tick Include my question to export them/).waitFor();

    await card
      .getByRole("button", { name: "Export tracking sheet (CSV)" })
      .click();
    let dialog = options.getByRole("dialog");
    const csv = await dialog
      .getByRole("region", { name: "Tracking sheet" })
      .innerText();
    assert.match(csv.split("\n")[0], /,note,mark$/);
    assert.match(csv, /,202#L\d,,.*,helped$/m);
    assert.match(csv, /,202#L\d,101,.*,wrong card$/m);
    assert.doesNotMatch(csv, /hover the help icon/);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await card.getByLabel("Include my question").check();
    await exportButton.click();
    dialog = options.getByRole("dialog");
    const proposals = JSON.parse(
      await dialog
        .getByRole("region", { name: "Proposed synonyms" })
        .innerText(),
    );
    assert.equal(proposals.kind, "apty-kb-synonym-proposals");
    assert.match(proposals.note, /Proposals only/);
    assert.deepEqual(proposals.proposals, [
      {
        cardId: "101",
        aptyVersion: "5.x",
        words: ["help", "hover", "icon", "opens", "tooltip", "twice"].map(
          (word) => ({ word, count: 1 }),
        ),
      },
    ]);
    await inBothThemes(options, (theme) => noViolations(options, theme));
    await dialog.getByRole("button", { name: "Cancel" }).click();
    assert.deepEqual(requests, []);
    const storedSha = await options.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("apty-kb-db", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result
              .transaction("records", "readonly")
              .objectStore("records")
              .get("meta:5.x");
            get.onsuccess = () => resolve(get.result?.sha256);
            get.onerror = () => reject(get.error);
          };
        }),
    );
    assert.equal(
      storedSha,
      JSON.parse(packText).sha256,
      "the pack is unchanged",
    );
    await options.close();
  });
});
