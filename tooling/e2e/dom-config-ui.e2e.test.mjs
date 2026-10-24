/**
 * The DOM Config card in the real side panel (R4a): the welcome screen's
 * tile opens it, one Start crawls the fixture application, and the report
 * shows the five settings tiles and the expected ignore conditions. The
 * exported Markdown holds exactly the rules ticked on screen.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { startDomConfigApp } from "./fixtures/dom-config-app.mjs";
import { launchBrowser, openSidePanel, startMockModel } from "./harness.mjs";

let browser;
let model;
let app;

before(async () => {
  [browser, model, app] = await Promise.all([
    launchBrowser(),
    startMockModel(),
    startDomConfigApp(),
  ]);
});

after(async () => {
  await browser?.close();
  model?.close();
  app?.close();
});

const TILES = [
  "Attribute priority",
  "DOM change debounce",
  "Max z-index",
  "Shadow DOM",
  "Ignore DOM events",
];

function includeLabel(conditions) {
  return `Include the rule ${conditions.join(" AND ")}`;
}

const CONDITION =
  /^(Attribute Name|Attribute Value) (Equals|Not equals|Contains|Does not contain|In|Not in|Regex) (.*)$/;

/** The rule's conditions as the Markdown export writes them. */
function markdownConditions(label) {
  return label
    .replace(/^Include the rule /, "")
    .split(" AND ")
    .map((condition) => {
      const [, category, operator, value] = CONDITION.exec(condition);
      return `${category} · ${operator} · \`${value}\``;
    })
    .join(" AND ");
}

describe("DOM Config card in the side panel", () => {
  it("generates the report from the welcome tile and exports what is ticked", async () => {
    const target = await browser.context.newPage();
    await target.goto(`${app.origin}/home`);
    const panel = await openSidePanel(browser, model, target);
    await panel
      .getByRole("button", { name: "Conversation History", exact: true })
      .waitFor();

    await panel
      .getByRole("button", { name: /Generate DOM config: capture/ })
      .click();
    await panel
      .getByRole("button", { name: "Start generating the DOM config" })
      .click();
    await panel
      .getByRole("tablist", { name: "Report sections" })
      .waitFor({ timeout: 170_000 });
    assert.equal(await panel.getByText("Report ready").count(), 1);

    for (const tile of TILES) {
      await panel
        .getByRole("button", { name: `Copy ${tile}`, exact: true })
        .waitFor();
    }
    assert.equal(
      await panel
        .getByRole("listitem")
        .filter({ hasText: /^Max z-index/ })
        .getByText("2147483646", { exact: true })
        .count(),
      1,
    );

    const uiId = panel.getByRole("checkbox", {
      name: includeLabel([
        "Attribute Name Equals id",
        "Attribute Value Regex ^ui-id-\\d+$",
      ]),
    });
    const nocache = panel.getByRole("checkbox", {
      name: includeLabel([
        "Attribute Name Equals href",
        "Attribute Value Contains nocache",
      ]),
    });
    assert.equal(await uiId.isChecked(), true);
    assert.equal(await nocache.isChecked(), true);

    await nocache.uncheck();
    const reviewSummary = panel.locator("summary", { hasText: /^Need review/ });
    await reviewSummary.click();
    const reviewBoxes = panel
      .locator("details", { has: reviewSummary })
      .getByRole("checkbox", { name: /^Include the rule / });
    if ((await reviewBoxes.count()) > 0) await reviewBoxes.first().check();

    const [download] = await Promise.all([
      panel.waitForEvent("download"),
      panel
        .getByRole("button", {
          name: "Export Markdown of the report, with the included rules only",
        })
        .click(),
    ]);
    const markdown = await readFile(await download.path(), "utf8");

    const boxes = panel.getByRole("checkbox", { name: /^Include the rule / });
    const count = await boxes.count();
    assert.ok(count >= 2, `${count} rules on screen`);
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i);
      const label = await box.getAttribute("aria-label");
      assert.equal(
        markdown.includes(markdownConditions(label)),
        await box.isChecked(),
        label,
      );
    }
    assert.equal(markdown.includes("Clinic for Jane Example"), false);
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await target.close();
  });
});
