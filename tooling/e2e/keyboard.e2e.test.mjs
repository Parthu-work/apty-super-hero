/**
 * Every flow by keyboard alone, in the real side panel and Options page:
 * open the menu and pick a tool, start a DOM config capture and stop it,
 * check a page in DOM health and ask about the result, delete a chat
 * through its confirmation, and walk the Options tabs with the arrow keys.
 * Tab and Enter (or the arrows) are the only input; a control is reached by
 * pressing Tab until it has focus, so a control Tab can't reach fails the
 * test. Then the names a screen reader announces for the panel's and
 * Options' main controls.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startDomConfigApp } from "./fixtures/dom-config-app.mjs";
import {
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

let browser;
let model;
let site;
let domConfigApp;

before(async () => {
  model = await startMockModel();
  domConfigApp = await startDomConfigApp();
  site = await startPageServer({
    "/form.html":
      '<title>Form</title><main><h1>Orders</h1><form><input name="order" aria-label="Order"><button type="button">Find</button></form></main>',
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  domConfigApp?.close();
});

/** The accessible name of the focused element, as near as the DOM gives it. */
function focusedName(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "";
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return (
      el.getAttribute("aria-label") ??
      byId ??
      el.textContent ??
      ""
    ).trim();
  });
}

/** Presses Tab until the focused control's name matches `name`, at most `limit` times. */
async function tabTo(page, name, limit = 60) {
  const seen = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const focused = await focusedName(page);
    if (typeof name === "string" ? focused === name : name.test(focused)) {
      return;
    }
    seen.push(focused);
  }
  assert.fail(
    `Tab never reached ${name}; it went through: ${seen.join(" | ")}`,
  );
}

/** Presses Tab until the composer has focus. */
async function tabToComposer(page, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (
      await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA")
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  assert.fail("Tab never reached the composer");
}

async function openPanel(path, origin = site.origin) {
  const app = await browser.context.newPage();
  await app.goto(`${origin}${path}`);
  const panel = await openSidePanel(browser, model, app);
  await panel.setViewportSize({ width: 400, height: 800 });
  await panel.getByRole("button", { name: "Menu", exact: true }).waitFor();
  await panel.evaluate(() => document.activeElement?.blur());
  return { app, panel };
}

describe("by keyboard alone", () => {
  it("opens the menu, picks DOM config, starts a capture and stops it", async () => {
    const { app, panel } = await openPanel("/home", domConfigApp.origin);
    await tabTo(panel, "Menu");
    await panel.keyboard.press("Enter");
    const menu = panel.getByRole("dialog", { name: "Menu" });
    await menu.waitFor();
    await tabTo(panel, /^DOM config/);
    await panel.keyboard.press("Enter");
    await panel
      .getByRole("region", { name: "DOM config", exact: true })
      .waitFor();
    await menu.waitFor({ state: "detached" });

    const held = domConfigApp.hold("/list");
    await tabTo(panel, "Start capture");
    await panel.keyboard.press("Enter");
    await held.requested;
    await panel
      .getByText("This tab is navigating through your application.")
      .waitFor();
    await tabTo(panel, "Stop capture");
    await panel.keyboard.press("Enter");
    held.release();
    await panel
      .getByRole("button", { name: /^Run again/ })
      .waitFor({ timeout: 120_000 });
    await panel.close();
    await app.close();
  });

  it("checks a page in DOM health and asks about the result", async () => {
    const { app, panel } = await openPanel("/form.html");
    await tabTo(panel, "Menu");
    await panel.keyboard.press("Enter");
    await tabTo(panel, /^DOM health/);
    await panel.keyboard.press("Enter");
    await panel
      .getByRole("dialog", { name: "Menu" })
      .waitFor({ state: "detached" });
    await tabTo(panel, "Check this page");
    await panel.keyboard.press("Enter");
    await panel
      .getByRole("button", { name: "Full breakdown" })
      .waitFor({ timeout: 150_000 });
    model.script(() => ({ text: "RESULT: read the bundle" }));
    await tabTo(panel, "Ask about this result");
    await panel.keyboard.press("Enter");
    const box = panel.locator("textarea").first();
    await box.waitFor();
    assert.match(await box.inputValue(), /DOM health result mean/);
    await tabToComposer(panel);
    await panel.keyboard.press("Enter");
    await panel.getByText("RESULT: read the bundle").waitFor();
    await panel.close();
    await app.close();
  });

  it("deletes a chat through its confirmation, which opens on Cancel", async () => {
    const { app, panel } = await openPanel("/form.html");
    model.script(() => ({ text: "RESULT: the form has one field" }));
    await chatAndWait(panel, "count the form fields");
    await panel.evaluate(() => document.activeElement?.blur());
    await tabTo(panel, "New chat");
    await panel.keyboard.press("Enter");
    await panel
      .getByRole("heading", { name: "What are we debugging?" })
      .waitFor();

    await panel.evaluate(() => document.activeElement?.blur());
    await tabTo(panel, "Menu");
    await panel.keyboard.press("Enter");
    const menu = panel.getByRole("dialog", { name: "Menu" });
    const row = menu
      .getByRole("button", { name: /^count the form fields/ })
      .first();
    await row.waitFor();
    await tabTo(panel, "Delete conversation: count the form fields");
    await panel.keyboard.press("Enter");
    const confirm = panel.getByRole("alertdialog", {
      name: "Delete this chat?",
    });
    await confirm.waitFor();
    assert.equal(await focusedName(panel), "Cancel");
    await panel.keyboard.press("Tab");
    assert.equal(await focusedName(panel), "Delete");
    await panel.keyboard.press("Enter");
    await row.waitFor({ state: "detached" });
    await panel.close();
    await app.close();
  });

  it("walks the Options tabs with the arrow keys", async () => {
    const options = await extensionPage(browser);
    await options.getByRole("tab", { name: "General", exact: true }).waitFor();
    await tabTo(options, "General");
    for (const name of ["AI", "Skills", "Connection", "General"]) {
      await options.keyboard.press("ArrowRight");
      await options
        .getByRole("tab", { name, exact: true, selected: true })
        .waitFor();
      await options.getByRole("tabpanel", { name, exact: true }).waitFor();
    }
    await options.close();
  });
});

describe("names a screen reader announces", () => {
  it("for the panel's and Options' main controls", async () => {
    const { app, panel } = await openPanel("/form.html");
    for (const name of ["Menu", "New chat", "Send"]) {
      assert.equal(
        await panel.getByRole("button", { name, exact: true }).count(),
        1,
        `the panel's ${name} button`,
      );
    }
    await panel.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = panel.getByRole("dialog", { name: "Menu" });
    await menu.waitFor();
    for (const name of [
      "Close menu",
      "New chat",
      "Selector checker",
      "Network inspector",
      "Settings",
    ]) {
      assert.equal(
        await menu.getByRole("button", { name, exact: true }).count(),
        1,
        `the menu's ${name} row`,
      );
    }
    for (const name of [/^DOM health/, /^DOM config/, /^Connections/]) {
      assert.equal(await menu.getByRole("button", { name }).count(), 1);
    }
    await panel.close();
    await app.close();

    const options = await extensionPage(browser);
    await options.getByRole("tab", { name: "General", exact: true }).waitFor();
    assert.deepEqual(await options.getByRole("tab").allInnerTexts(), [
      "General",
      "AI",
      "Skills",
      "Connection",
    ]);
    assert.equal(
      await options
        .getByRole("heading", { name: "Settings", level: 1 })
        .count(),
      1,
    );
    await options.close();
  });
});
