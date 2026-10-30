/**
 * The HAR file check in Chromium with the built Agent and no Apty Client:
 * the SE picks a HAR recorded with the synthetic 5.x content files, runs
 * the visibility and widget checks on it with no model request, and asks
 * about the result in a new chat, which gets the check, not the file.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  describeViolations,
  launchBrowser,
  openSidePanel,
  openToolPage,
  ROOT,
  runAxe,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-5x",
);
const ENV_PATH =
  "https://client.apty.example/tenant-0f000000-0000-7000-8000-000000000000/app-0a000000-0000-7000-8000-000000000001/env-0e000000-0000-7000-8000-000000000002";
const PAGE = "https://intranet.other.example/home";

/** A HAR recorded on a page no fixture environment covers, with every fixture file. */
function fixtureHar() {
  const files = readdirSync(FIXTURES).filter((n) => n.endsWith(".json"));
  return JSON.stringify({
    log: {
      entries: [
        {
          _resourceType: "document",
          startedDateTime: "2026-10-29T10:00:00.000Z",
          request: { method: "GET", url: PAGE },
          response: { status: 200, content: { mimeType: "text/html" } },
        },
        ...files.map((name, i) => ({
          startedDateTime: new Date(
            Date.parse("2026-10-29T10:00:01Z") + i * 1000,
          ).toISOString(),
          request: { method: "GET", url: `${ENV_PATH}/${name}?timestamp=${i}` },
          response: {
            status: 200,
            content: {
              mimeType: "application/json",
              text: readFileSync(join(FIXTURES, name), "utf8"),
            },
          },
        })),
      ],
    },
  });
}

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

async function pickHar(panel) {
  await openToolPage(panel, "Check a HAR file");
  await panel.getByLabel("Choose a HAR file").setInputFiles({
    name: "customer-tenant.har",
    mimeType: "application/json",
    buffer: Buffer.from(fixtureHar()),
  });
  await panel
    .getByText(/customer-tenant\.har: \d+ calls, \d+ Apty content files/)
    .waitFor();
}

describe("HAR file check, end to end", () => {
  it("checks a workflow and the widget from a HAR with no Client and no model request, axe clean", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    const before = model.requests.length;

    await pickHar(panel);
    await panel.getByLabel("Name or sourceId (optional)").fill("Take a tour");
    await panel.getByRole("button", { name: "Check", exact: true }).click();
    const card = panel.getByRole("region", {
      name: "Why “Take a tour” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Cause found").waitFor();
    await card.getByText("workflow.json: hideFromWidget = true").waitFor();
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));

    await panel.getByLabel("What is missing?").selectOption("widget");
    await panel.getByRole("button", { name: "Check", exact: true }).click();
    const widget = panel.getByRole("region", {
      name: "Why the widget may not be visible",
    });
    await widget.waitFor({ timeout: 30_000 });
    await widget.getByText("Cause found").waitFor();
    const text = await widget.textContent();
    assert.ok(
      !text.includes("intranet.other.example"),
      "the card shows no URL",
    );
    assert.equal(model.requests.length, before, "the model was not asked");
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("asks about the result in a new chat: the check as a chip, sent only on Send, with no file name or URL", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    await pickHar(panel);
    await panel.getByRole("button", { name: "Check", exact: true }).click();
    await panel
      .getByRole("region", { name: "Visibility check: every workflow" })
      .waitFor({ timeout: 30_000 });

    model.script(() => ({ text: "RESULT: read the HAR check" }));
    await panel.getByRole("button", { name: "Ask about this result" }).click();
    await panel
      .getByRole("region", { name: "Check a HAR file", exact: true })
      .waitFor({ state: "detached" });
    const box = panel.locator("textarea").first();
    assert.equal(
      await box.inputValue(),
      "Explain this check from the HAR file and what to do next.",
    );
    await panel.getByText("HAR file check", { exact: true }).waitFor();
    assert.equal(model.requests.length, 0, "sent before Send");

    await box.press("Enter");
    await panel.getByText("RESULT: read the HAR check").waitFor();
    const asked = JSON.stringify(
      model.requests[0].messages.filter((m) => m.role === "user").at(-1)
        .content,
    );
    assert.match(asked, /Checked from a HAR file, not the live Apty Client/);
    assert.match(asked, /Visibility check of workflows/);
    assert.ok(
      !asked.includes("customer-tenant"),
      "no file name reached the model",
    );
    assert.ok(
      !asked.includes("client.apty.example"),
      "no URL reached the model",
    );
    await panel.close();
    await app.close();
  });
});
