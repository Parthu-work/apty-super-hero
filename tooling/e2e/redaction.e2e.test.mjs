/**
 * Settings → Data handling → Redaction (A3) end to end: the mode chosen on
 * the real Options page changes what a tool returns to the model, Off needs
 * a confirmation and shows a banner in the side panel, the choice survives
 * a reload, and a JWT stays masked in every mode.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  callToolThenReport,
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  toolResults,
} from "./harness.mjs";

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlMmUtdXNlciJ9.ZTJlLXNpZ25hdHVyZS1ub3QtcmVhbA";

const APP = `<!doctype html><title>Chart</title><h1>Chart</h1>
<script>
  console.log(JSON.stringify({
    page_title: "Chart for Jane Testpatient",
    username: "jtestpatient",
    token: "${JWT}",
  }));
</script>`;

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({ "/chart.html": APP });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

/**
 * The console line the agent hands the model. `openSidePanel` writes fresh
 * provider settings, so `chooseMode` runs after it, on the real Options page.
 */
async function logLineSeenByModel(prompt, chooseMode) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/chart.html`);
  const panel = await openSidePanel(browser, model, app);
  if (chooseMode) {
    const options = await openDataHandling();
    await chooseMode(options);
    await options.close();
    await app.bringToFront();
  }
  model.script(
    callToolThenReport("get_apty_page_logs", {
      limit: 50,
      minLevel: "log",
      frames: "all",
    }),
  );
  await chatAndWait(panel, prompt);
  const text = JSON.stringify(toolResults(model.requests.at(-1)).at(-1));
  return { app, panel, text };
}

async function openDataHandling() {
  const options = await extensionPage(browser);
  await options.getByRole("radio", { name: "Strict (recommended)" }).waitFor();
  return options;
}

describe("redaction mode (A3)", () => {
  it("is strict on a fresh profile", async () => {
    const options = await openDataHandling();
    assert.equal(
      await options
        .getByRole("radio", { name: "Strict (recommended)" })
        .isChecked(),
      true,
    );
    await options.close();

    const { app, panel, text } = await logLineSeenByModel(
      "check the apty page logs",
    );
    assert.ok(text.includes("page_title"), text.slice(0, 400));
    assert.ok(!text.includes("Jane Testpatient"), "strict masks page context");
    assert.ok(!text.includes("jtestpatient"), "strict masks the username");
    assert.ok(!text.includes(JWT));
    assert.equal(await panel.getByText("Redaction is OFF").count(), 0);
    await panel.close();
    await app.close();
  });

  it("Standard keeps the page title and still masks the username", async () => {
    const { app, panel, text } = await logLineSeenByModel(
      "check the apty page logs again",
      (options) => options.getByRole("radio", { name: "Standard" }).check(),
    );
    assert.ok(text.includes("Jane Testpatient"), text.slice(0, 400));
    assert.ok(!text.includes("jtestpatient"));
    assert.ok(!text.includes(JWT));
    await panel.close();
    await app.close();
  });

  it("Off needs a confirmation, shows a banner, survives a reload and still masks a JWT", async () => {
    const { app, panel, text } = await logLineSeenByModel(
      "check the apty page logs one more time",
      async (options) => {
        await options.getByRole("radio", { name: "Standard" }).check();
        await options
          .getByRole("radio", { name: "Off (development only)" })
          .click();
        const dialog = options.getByRole("dialog");
        await dialog
          .getByText(/Structural secret redaction stays on/)
          .waitFor();
        await dialog.getByRole("button", { name: "Keep current mode" }).click();
        assert.equal(
          await options.getByRole("radio", { name: "Standard" }).isChecked(),
          true,
        );

        await options
          .getByRole("radio", { name: "Off (development only)" })
          .click();
        await options
          .getByRole("button", { name: "Turn redaction off" })
          .click();
        await options.reload();
        const off = options.getByRole("radio", {
          name: "Off (development only)",
        });
        await off.waitFor();
        assert.equal(await off.isChecked(), true, "the mode survives a reload");
      },
    );

    await panel.getByText("Redaction is OFF").waitFor();
    assert.ok(text.includes("jtestpatient"), text.slice(0, 400));
    assert.ok(!text.includes(JWT), "a JWT stays redacted in Off");

    await panel.reload();
    await panel.getByText("Redaction is OFF").waitFor();
    await panel.close();
    await app.close();
  });
});
