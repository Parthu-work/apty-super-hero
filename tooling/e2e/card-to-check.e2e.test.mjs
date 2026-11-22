/**
 * KB-RAG K27, E5: from the card to the check, on the synthetic 5.x tenant
 * (a fake Apty Client serving the content-5x fixtures). A KB card for a
 * symptom a check pack reads offers Run the check, which runs that check
 * on the SE's own words; a check with no cause shows the card's layers 1
 * and 2; a confirmed cause offers Prepare support bundle and the
 * right-or-wrong mark. Every step by keyboard, axe clean in light and dark,
 * and no model request. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  axeInBothThemes,
  describeViolations,
  extensionPage,
  launchBrowser,
  openCaseMenu,
  openSidePanel,
  ROOT,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
  unpackedExtensionId,
  writeContentClient,
} from "./harness.mjs";
import { fixturePage, importPack, writeFixturePack } from "./kb-fixture.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-5x",
);
const LAYER_1 = "FIXTURE: clear the tour's hide option in its settings.";
const LAYER_2 = "FIXTURE: look for the tour's row in the widget list.";

let browser;
let model;
let site;
let clientId;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<title>CRM</title><h1>Leads</h1>",
  });
  const files = Object.fromEntries(
    readdirSync(FIXTURES).map((name) => [
      name,
      readFileSync(join(FIXTURES, name), "utf8"),
    ]),
  );
  const apps = JSON.parse(files["app-urls.json"]);
  apps[0].environments[1].urls = [`${site.origin}/app`];
  // The widget shows for everyone, so an item with no blocker has no cause.
  const appData = JSON.parse(files["app-data.json"]);
  appData.config = {
    ...appData.config,
    widgetConfig: { display: "All", selectedSegments: [] },
  };
  const dir = join(tempDir("apty-e2e-card-check-"), "client");
  clientId = unpackedExtensionId(dir);
  writeContentClient(dir, AGENT_EXTENSION_ID, {
    ...files,
    "app-urls.json": JSON.stringify(apps),
    "app-data.json": JSON.stringify(appData),
  });
  browser = await launchBrowser({ extraExtensions: [dir] });

  const options = await extensionPage(browser);
  await options.getByRole("tab", { name: "Connection" }).click();
  await options.getByLabel("Extension ID").fill(clientId);
  await options
    .getByLabel("Extension ID")
    .locator("..")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await options.getByText("Answering").waitFor({ timeout: 30_000 });
  await options.close();

  const { file } = writeFixturePack(tempDir("apty-kb-card-check-"), {
    pages: [
      fixturePage("1496842241", "FIXTURE tour vanished from the widget list", [
        LAYER_1,
        LAYER_2,
        "FIXTURE: the tour's entry in its content file.",
        "Send support: the FIXTURE version.",
      ]),
    ],
  });
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function panelOnApp() {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app, { aiToken: "" });
  return { app, panel };
}

async function pressOn(panel, locator) {
  await locator.focus();
  await panel.keyboard.press("Enter");
}

describe("from the card to the check (KB-RAG K27, E5)", () => {
  it("a KB card offers Run the check; the check finds the cause; the bundle and the mark follow, by keyboard", async () => {
    const { app, panel } = await panelOnApp();
    await sendChat(
      panel,
      "the Take a tour workflow vanished from the FIXTURE widget list",
    );
    const run = panel.getByRole("button", { name: "Run the check" });
    await run.waitFor({ timeout: 30_000 });
    await panel
      .getByRole("link", { name: /FIXTURE tour vanished/ })
      .first()
      .waitFor();
    let violations = await axeInBothThemes(panel);
    assert.deepEqual(violations, [], describeViolations(violations));

    await pressOn(panel, run);
    const card = panel.getByRole("region", {
      name: "Why “Take a tour” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Cause found").waitFor();

    const row = panel.getByTestId("turn-actions").last();
    await row.getByRole("button", { name: "Prepare support bundle" }).waitFor();
    const mark = row.getByRole("group", { name: "Was this cause right?" });
    const wrong = mark.getByRole("button", { name: "Wrong" });
    await pressOn(panel, wrong);
    await row.getByText(/^Marked wrong\./).waitFor();
    assert.equal(await wrong.getAttribute("aria-pressed"), "true");
    violations = await axeInBothThemes(panel);
    assert.deepEqual(violations, [], describeViolations(violations));

    const caseMenu = await openCaseMenu(panel);
    await caseMenu.getByRole("menuitem", { name: "Close case…" }).click();
    assert.equal(
      await panel
        .getByTestId("close-case-form")
        .getByRole("radio", { name: "No", exact: true })
        .isChecked(),
      true,
      "closing starts from the SE's mark",
    );
    assert.equal(model.requests.length, 0, "no model request");
    await panel.close();
    await app.close();
  });

  it("a check with no cause shows the card's layers 1 and 2, with no model request", async () => {
    const { app, panel } = await panelOnApp();
    await sendChat(
      panel,
      "My workflow 'Request activities' is not visible in the widget",
    );
    const card = panel.getByRole("region", {
      name: "Why “Request activities” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("No cause in the files").waitFor();
    const layers = card.getByTestId("no-cause-card");
    await layers.getByText(LAYER_1).waitFor({ timeout: 10_000 });
    await layers.getByText(LAYER_2).waitFor();
    assert.equal(
      await layers.getByText("Send support: the FIXTURE version.").count(),
      0,
      "only layers 1 and 2",
    );
    assert.equal(
      await panel.getByRole("group", { name: "Was this cause right?" }).count(),
      0,
      "no mark without a cause",
    );
    const violations = await axeInBothThemes(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    assert.equal(model.requests.length, 0, "no model request");
    await panel.close();
    await app.close();
  });
});
