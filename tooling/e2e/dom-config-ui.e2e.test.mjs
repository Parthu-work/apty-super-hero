/**
 * The DOM Config page in the real side panel (R4a, R4b): the composer's "/"
 * list opens it, one Start crawls the fixture application, and the
 * results show the proposed settings and the expected ignore conditions.
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

const SETTINGS = [
  "Attribute priority",
  "DOM change debounce",
  "Max z-index",
  "Shadow DOM",
  "Ignore DOM events",
];

function includeLabel(conditions) {
  return `Include the rule ${conditions.join(" OR ")}`;
}

const MANUAL = "Reports menu, opened by hand";
const IMPORTED = "Pasted profile";

/** Opens a row of the page (a proposed setting, a detail, a way to capture by hand). */
async function openRow(panel, name) {
  await panel.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await panel.getByRole("heading", { name, exact: true }).first().waitFor();
}

async function back(panel) {
  await panel.getByRole("button", { name: "Back", exact: true }).click();
}

async function exportMarkdown(panel) {
  await panel.getByRole("button", { name: "Export results" }).click();
  const [download] = await Promise.all([
    panel.waitForEvent("download"),
    panel.getByRole("menuitem", { name: "Markdown" }).click(),
  ]);
  return readFile(await download.path(), "utf8");
}

const CONDITION =
  /^(Attribute Name|Attribute Value (\S+)) (Equals|Not equals|Contains|Does not contain|In|Not in|Regex) (.*)$/;

/** The rule's conditions as the Markdown export writes them: in a table, a `|` is written `\|`. */
function markdownConditions(label) {
  return label
    .replace(/^Include the rule /, "")
    .split(" OR ")
    .map((condition) => {
      const [, mode, attribute, operator, value] = CONDITION.exec(condition);
      const category = attribute ? "Attribute Value" : mode;
      const named = attribute ? ` · \`${attribute}\`` : "";
      return `${category}${named} · ${operator} · \`${value.replaceAll("|", "\\|")}\``;
    })
    .join(" OR ");
}

describe("DOM Config page in the side panel", () => {
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
    await panel.getByRole("button", { name: "Start capture" }).click();
    await panel
      .getByText("Capture complete", { exact: true })
      .waitFor({ timeout: 170_000 });

    const proposed = panel.getByRole("region", { name: "Proposed settings" });
    for (const setting of SETTINGS) {
      await proposed
        .getByRole("button", { name: new RegExp(`^${setting}`) })
        .waitFor();
    }
    assert.equal(
      await proposed
        .getByRole("button", { name: /^Max z-index/ })
        .getByText("2147483646", { exact: true })
        .count(),
      1,
    );

    await openRow(panel, "Ignore conditions");
    const uiId = panel.getByRole("checkbox", {
      name: includeLabel(["Attribute Value id Regex ^ui-id-\\d+$"]),
    });
    const nocache = panel.getByRole("checkbox", {
      name: includeLabel(["Attribute Value href Contains nocache"]),
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
    await back(panel);

    const markdown = await exportMarkdown(panel);

    await openRow(panel, "Ignore conditions");
    await reviewSummary.click();
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
    await back(panel);

    await target.getByRole("menuitem", { name: "Reports" }).click();
    await target.getByRole("heading", { name: "Reports" }).waitFor();
    await openRow(panel, "Capture current state");
    await panel.getByLabel("Page name").fill(MANUAL);
    await panel
      .getByRole("button", {
        name: "Capture now: add a run of the current tab as it is",
      })
      .click();
    await panel.getByText(`Captured run 1 of ${MANUAL}.`).waitFor();
    await back(panel);
    await openRow(panel, "Pages");
    const pages = panel.getByRole("region", { name: "Pages" });
    await pages
      .getByRole("listitem")
      .filter({ hasText: MANUAL })
      .first()
      .getByText("manual", { exact: true })
      .waitFor();
    assert.equal(target.url().startsWith(`${app.origin}/home`), true);
    await back(panel);
    assert.ok((await exportMarkdown(panel)).includes(MANUAL));

    await openRow(panel, "Import runs");
    await panel.getByLabel("Page name").fill(IMPORTED);
    await panel.getByLabel("Paste the script's result").fill(
      JSON.stringify({
        tags: { div: 3, main: 1 },
        attributes: { id: { "main-nav": 1, "ui-id-3": 1 } },
      }),
    );
    await panel.getByRole("button", { name: "Import page" }).click();
    await panel.getByText(`Runs imported into ${IMPORTED}: 1.`).waitFor();
    await back(panel);
    await openRow(panel, "Pages");
    await pages
      .getByRole("listitem")
      .filter({ hasText: IMPORTED })
      .first()
      .getByText("imported", { exact: true })
      .waitFor();
    await back(panel);
    assert.ok((await exportMarkdown(panel)).includes(IMPORTED));

    // "Ask about these": the Markdown export as a chip in a new chat, sent
    // only on Send, and never the page's title.
    model.script(() => ({ text: "RESULT: read the settings" }));
    await panel.getByRole("button", { name: "Ask about these" }).click();
    await panel
      .getByRole("region", { name: "DOM config", exact: true })
      .waitFor({ state: "hidden" });
    await panel.getByText("DOM config results", { exact: true }).waitFor();
    assert.equal(
      await composer.inputValue(),
      "What do these proposed DOM settings mean, and which should we apply first?",
    );
    assert.equal(model.requests.length, 0, "sent before Send");
    await composer.press("Enter");
    await panel.getByText("RESULT: read the settings").waitFor();
    const asked = JSON.stringify(
      model.requests[0].messages.filter((m) => m.role === "user").at(-1)
        .content,
    );
    assert.ok(asked.includes("# DOM configuration"), asked.slice(0, 300));
    assert.ok(asked.includes(MANUAL), asked.slice(0, 300));
    assert.equal(asked.includes("Clinic for Jane Example"), false);
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await target.close();
  });
});
