/**
 * The DOM Config page in the real side panel (R4a, R4b): the composer's "/"
 * list opens it, one Start crawls the fixture application, and the
 * report shows the five settings tiles and the expected ignore conditions.
 * The exported Markdown holds exactly the rules ticked on screen. A state
 * safe mode never clicks (the fixture's menu) is then opened by hand and
 * captured, and a pasted profile imported, into the same report.
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

const MANUAL = "Reports menu, opened by hand";
const IMPORTED = "Pasted profile";

function section(panel, title) {
  return panel.locator("details", {
    has: panel.locator("summary", { hasText: title }),
  });
}

async function exportMarkdown(panel) {
  const [download] = await Promise.all([
    panel.waitForEvent("download"),
    panel
      .getByRole("button", {
        name: "Export Markdown of the report, with the included rules only",
      })
      .click(),
  ]);
  return readFile(await download.path(), "utf8");
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
  it("generates the report from the / list and exports what is ticked", async () => {
    const target = await browser.context.newPage();
    await target.goto(`${app.origin}/home`);
    const panel = await openSidePanel(browser, model, target);
    const composer = panel.locator("textarea").first();
    await composer.fill("/config");
    await panel
      .getByRole("option", { name: /^DOM config/, selected: true })
      .waitFor();
    await composer.press("Enter");
    await panel.getByRole("region", { name: "DOM config" }).waitFor();
    assert.equal(await composer.inputValue(), "");
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

    const markdown = await exportMarkdown(panel);

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

    await target.getByRole("menuitem", { name: "Reports" }).click();
    await target.getByRole("heading", { name: "Reports" }).waitFor();
    const manual = section(panel, "Capture current state");
    await manual.locator("summary").click();
    await manual.getByLabel("Page name").fill(MANUAL);
    await manual
      .getByRole("button", {
        name: "Capture now: add a run of the current tab as it is",
      })
      .click();
    await manual.getByText(`Captured run 1 of ${MANUAL}.`).waitFor();
    const pages = panel.getByRole("region", { name: "Pages" });
    await pages
      .getByRole("listitem")
      .filter({ hasText: MANUAL })
      .first()
      .getByText("manual", { exact: true })
      .waitFor();
    assert.equal(target.url().startsWith(`${app.origin}/home`), true);
    assert.ok((await exportMarkdown(panel)).includes(MANUAL));

    const imported = section(panel, "Import console script results");
    await imported.locator("summary").click();
    await imported.getByLabel("Page name").fill(IMPORTED);
    await imported.getByLabel("Paste the script's result").fill(
      JSON.stringify({
        tags: { div: 3, main: 1 },
        attributes: { id: { "main-nav": 1, "ui-id-3": 1 } },
      }),
    );
    await imported.getByRole("button", { name: "Import page" }).click();
    await imported.getByText(`Runs imported into ${IMPORTED}: 1.`).waitFor();
    await pages
      .getByRole("listitem")
      .filter({ hasText: IMPORTED })
      .first()
      .getByText("imported", { exact: true })
      .waitFor();
    assert.ok((await exportMarkdown(panel)).includes(IMPORTED));
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await target.close();
  });
});
