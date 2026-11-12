/**
 * KB-RAG K25, L3: outcomes and wrong-card feedback. With a demo pack and no
 * AI key, the SE marks a KB matches card wrong and names the right one,
 * closes the case as Resolved with "Was the finding right?" set to no, then
 * exports from Options → Feedback: the tracking sheet (CSV, exact columns)
 * and, with "Include my question" ticked, the questions file, which kb:eval
 * runs on the demo pack. No request leaves the extension while exporting.
 * Synthetic cards only.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  ROOT,
  runAxe,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

const QUESTION = "the tooltip opens twice when I hover the help icon";

let browser;
let model;
let site;
let packFile;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  packFile = writeFixturePack(tempDir("apty-kb-feedback-")).file;
  await importPack(browser, packFile);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("wrong-card feedback (KB-RAG K25, L3)", () => {
  it("marks a card wrong with the right one, and closes the case as Resolved", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(panel, QUESTION);
    const card = panel.getByRole("region", { name: "KB cards that match" });
    await card.waitFor({ timeout: 30_000 });
    await card.getByRole("button", { name: "Wrong card: 202" }).click();
    await card.getByLabel(/Which card was right/).fill("101");
    await card.getByRole("button", { name: "Save" }).click();
    await card.getByText("Recorded. Thank you.").waitFor();

    const strip = panel.getByTestId("case-strip").filter({ visible: true });
    await strip.getByRole("button", { name: "Close case" }).click();
    const form = strip.getByTestId("close-case-form");
    await form.getByLabel("Resolved", { exact: true }).check();
    const formViolations = await runAxe(panel);
    assert.deepEqual(formViolations, [], describeViolations(formViolations));
    await form.getByLabel("No", { exact: true }).check();
    await form.getByLabel(/Which card was right/).fill("101");
    await form.getByRole("button", { name: "Close", exact: true }).click();
    await strip.getByTestId("case-outcome").waitFor();
    assert.equal(
      await strip.getByTestId("case-outcome").innerText(),
      "Resolved",
    );
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });

  it("exports the tracking sheet and, with the question included, questions kb:eval runs on", async () => {
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
    await card.getByTestId("feedback-count").waitFor();
    assert.equal(
      await card.getByTestId("feedback-count").innerText(),
      "2 entries",
    );
    for (const theme of ["light", "dark"]) {
      await options.evaluate(
        (t) => chrome.storage.local.set({ apty_theme: t }),
        theme,
      );
      await options.waitForFunction(
        (dark) => document.documentElement.classList.contains("dark") === dark,
        theme === "dark",
      );
      const violations = await runAxe(options);
      assert.deepEqual(
        violations,
        [],
        `${theme}: ${describeViolations(violations)}`,
      );
    }

    await card
      .getByRole("button", { name: "Export tracking sheet (CSV)" })
      .click();
    let dialog = options.getByRole("dialog");
    const csv = await dialog
      .getByRole("region", { name: "Tracking sheet" })
      .innerText();
    assert.equal(
      csv.split("\n")[0],
      "date,case id,Apty version,pack built,card shown,right card,outcome,coverage,reason,note",
    );
    assert.match(csv, /,202#L\d,101,open,/);
    assert.match(csv, /,resolved,/);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await card
      .getByRole("button", { name: "Export questions for kb:eval" })
      .click();
    dialog = options.getByRole("dialog");
    assert.equal(
      (
        await dialog
          .getByRole("region", { name: "Questions for kb:eval" })
          .innerText()
      ).trim(),
      "[]",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await card.getByLabel("Include my question").check();
    await card
      .getByRole("button", { name: "Export questions for kb:eval" })
      .click();
    dialog = options.getByRole("dialog");
    const [download] = await Promise.all([
      options.waitForEvent("download"),
      dialog.getByRole("button", { name: "Download" }).click(),
    ]);
    assert.match(
      download.suggestedFilename(),
      /^apty-kb-questions-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const file = join(tempDir("apty-kb-questions-"), "questions.json");
    await download.saveAs(file);
    const questions = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(questions, [
      {
        id: "field-001",
        category: "field",
        q: QUESTION,
        expectedPageIds: ["101"],
      },
    ]);
    assert.deepEqual(requests, []);
    await options.close();

    const out = execFileSync(
      "node",
      [
        join(ROOT, "tooling/scripts/kb/eval-kb.mjs"),
        "--pack",
        packFile,
        "--questions",
        file,
      ],
      { encoding: "utf8" },
    );
    assert.match(out, /^1 questions \(1 the KB should cover\)/);
  });
});
