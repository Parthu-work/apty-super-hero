/**
 * KB-RAG K27, F4: a case belongs to one site. A check on one host opens a
 * case; the same conversation moved to another host (the tab navigates
 * there) opens a second case, never touching the first; the case strip
 * shows the case's site, and Options → Cases lists both with a Site
 * column, as customer-a and customer-b once aliases are on. Synthetic data
 * only; nothing is sent anywhere.
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

async function caseIdShown(panel, other) {
  const id = panel.getByTestId("case-id").filter({ visible: true });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const text = (await id.count()) > 0 ? await id.first().innerText() : "";
    if (text && text !== other) return text;
    if (Date.now() > deadline) throw new Error("no new case id shown");
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("one case, one site (KB-RAG K27, F4)", () => {
  it("two hosts in one conversation give two cases, each listed with its site", async () => {
    const first = new URL(`${site.origin}/app.html`);
    const second = new URL(first);
    second.hostname = "localhost";
    const app = await browser.context.newPage();
    await app.goto(first.href);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });

    await sendChat(panel, SYMPTOM);
    const one = await caseIdShown(panel);
    await panel
      .getByTestId("case-site")
      .filter({ visible: true })
      .waitFor({ timeout: 10_000 });
    assert.match(
      await panel
        .getByTestId("case-site")
        .filter({ visible: true })
        .innerText(),
      /127\.0\.0\.1/,
    );

    await app.goto(second.href);
    await app.bringToFront();
    await sendChat(panel, SYMPTOM);
    const two = await caseIdShown(panel, one);
    assert.notEqual(two, one);
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
    assert.equal(model.requests.length, 0);

    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=general#cases",
    );
    const card = options.locator("#cases");
    await card.getByRole("columnheader", { name: "Site" }).waitFor();
    const rowOf = (id) => card.locator("tr", { hasText: id });
    assert.match(await rowOf(one).innerText(), /127\.0\.0\.1/);
    assert.match(await rowOf(two).innerText(), /localhost/);
    await card
      .getByRole("checkbox", { name: "Show sites as customer-a, customer-b" })
      .check();
    await card
      .getByTestId("case-site-cell")
      .filter({ hasText: "customer-a" })
      .waitFor();
    assert.match(await rowOf(one).innerText(), /customer-a/);
    assert.match(await rowOf(two).innerText(), /customer-b/);
    assert.doesNotMatch(await card.innerText(), /127\.0\.0\.1|localhost/);
    await options.close();
    await panel.close();
    await app.close();
  });
});
