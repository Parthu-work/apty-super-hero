/**
 * KB-RAG K25, L2: a demo check opens a case; from the case, "Prepare
 * support bundle" opens the review dialog with the exact JSON, the fields
 * still missing, Copy, Download and Copy as text. Download writes
 * apty-support-<case id>.json through the dialog's download path; the
 * customer's host is not in it, and the extension makes no request while
 * the bundle is prepared and downloaded. Synthetic data only.
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
} from "./harness.mjs";

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

describe("the support bundle (KB-RAG K25, L2)", () => {
  it("prepares the bundle for a check's case, lists what is missing, and downloads it with no request", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(
      panel,
      "My workflow 'Take a tour' is not visible in the widget",
    );
    const id = panel.getByTestId("case-id").filter({ visible: true });
    await id.waitFor({ timeout: 60_000 });
    const caseId = await id.innerText();
    await panel.close();
    await app.close();

    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=general#cases",
    );
    const requests = [];
    options.on("request", (request) => {
      if (!request.url().startsWith("chrome-extension://")) {
        requests.push(request.url());
      }
    });
    const card = options.locator("#cases");
    await card.getByRole("button", { name: `Open ${caseId}` }).click();
    await card.getByRole("button", { name: "Prepare support bundle" }).click();
    const dialog = options.getByRole("dialog");
    await dialog.getByTestId("support-missing").waitFor();
    assert.match(
      await dialog.getByTestId("support-missing").innerText(),
      /^Add before sending: .*environment/,
    );
    const json = await dialog
      .getByRole("region", { name: "Support bundle" })
      .innerText();
    assert.match(json, /"schema": "apty-support-bundle"/);
    assert.match(json, new RegExp(`"id": "${caseId}"`));
    for (const name of ["Copy", "Copy as text", "Download"]) {
      await dialog.getByRole("button", { name, exact: true }).waitFor();
    }
    const violations = await runAxe(options);
    assert.deepEqual(violations, [], describeViolations(violations));

    const [download] = await Promise.all([
      options.waitForEvent("download"),
      dialog.getByRole("button", { name: "Download" }).click(),
    ]);
    assert.equal(download.suggestedFilename(), `apty-support-${caseId}.json`);
    const saved = JSON.parse(readFileSync(await download.path(), "utf8"));
    assert.equal(saved.case.id, caseId);
    assert.ok(!JSON.stringify(saved).includes("127.0.0.1"));
    assert.deepEqual(requests, []);
    await options.close();
  });
});
