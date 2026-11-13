/**
 * KB-RAG K25, L1: a case for every debugging session. A visibility check
 * answered without the model opens a case; the context bar shows its id.
 * After the side panel reloads, the same conversation shows the same case,
 * a new chat on the site is offered "Continue CASE-…" once, and Options →
 * Cases lists the case with its check; it can be deleted there. Synthetic
 * data only; nothing is sent anywhere.
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
} from "./harness.mjs";

const SYMPTOM = "My workflow 'Take a tour' is not visible in the widget";

let browser;
let model;
let site;
let caseId;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<title>CRM</title><h1>Leads</h1>",
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("cases (KB-RAG K25, L1)", () => {
  let app;
  let panel;

  it("a check opens a case, and the context bar shows its id", async () => {
    app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(panel, SYMPTOM);
    await panel
      .getByRole("region", { name: "Why “Take a tour” may not be visible" })
      .waitFor({ timeout: 60_000 });
    const id = panel.getByTestId("case-id").filter({ visible: true });
    await id.waitFor({ timeout: 30_000 });
    caseId = await id.innerText();
    assert.match(caseId, /^CASE-\d{8}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(model.requests.length, 0);
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
  });

  it("after the panel reloads, a new chat on the site is offered the case once, and the same conversation shows the same case", async () => {
    // The chat is saved once its turn ends: reload only once the menu lists it.
    await panel.getByRole("button", { name: "Menu", exact: true }).click();
    const before = panel.getByRole("dialog", { name: "Menu" });
    await before
      .getByRole("button", { name: /^My workflow/ })
      .first()
      .waitFor({ timeout: 30_000 });
    await panel.keyboard.press("Escape");
    await before.waitFor({ state: "hidden" });
    await panel.reload();
    await panel.locator("textarea").first().waitFor();
    const offer = panel.getByTestId("case-continue").filter({ visible: true });
    await offer.waitFor({ timeout: 30_000 });
    assert.match(await offer.innerText(), new RegExp(caseId));

    await panel.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = panel.getByRole("dialog", { name: "Menu" });
    await menu
      .getByRole("button", { name: /^My workflow/ })
      .first()
      .click();
    await menu.waitFor({ state: "hidden" });
    await panel
      .getByTestId("case-id")
      .filter({ visible: true })
      .waitFor({ timeout: 30_000 });
    assert.equal(
      await panel.getByTestId("case-id").filter({ visible: true }).innerText(),
      caseId,
    );
    await panel.close();
    await app.close();
  });

  it("Options → Cases lists the case with its check, and deletes it", async () => {
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=general#cases",
    );
    const card = options.locator("#cases");
    await card.getByRole("button", { name: `Open ${caseId}` }).click();
    const details = card.getByTestId("case-details");
    await details.waitFor();
    assert.match(await details.innerText(), /content-not-visible/);
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
    await card.getByRole("button", { name: `Delete ${caseId}` }).click();
    await card.getByText("No cases yet.").waitFor();
    await options.close();
  });
});
