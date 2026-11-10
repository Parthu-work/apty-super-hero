/**
 * KB-RAG K15: a 4.x tenant's evidence with no Apty Client. In Injected
 * mode the verdict card's "Capture and reload" captures the page's own
 * calls and runs the 4.x check on them; in Extension mode the SE checks a
 * HAR saved from the 4.x Client's service worker, which has no page entry,
 * against the tab's page once confirmed. Neither cites a 5.x card, and the
 * model is never asked. Synthetic files only.
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
  sendChat,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-4x",
);
const PLAYER = readFileSync(
  join(ROOT, "tooling/e2e/fixtures/fake-4x-client/injected-player.js"),
  "utf8",
);
const BASE = "/tenant-4x/app-301/env-3012";

let browser;
let model;
let site;
let files;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  files = Object.fromEntries(
    readdirSync(FIXTURES).map((name) => [
      name,
      readFileSync(join(FIXTURES, name), "utf8"),
    ]),
  );
  const pages = {
    "/app.html": `<title>CRM</title><h1>Leads</h1><script>${PLAYER}</script>`,
  };
  site = await startPageServer(pages);
  const apps = JSON.parse(files["app-urls.json"]);
  apps[0].environments["2"].url = `${site.origin}/app`;
  files["app-urls.json"] = JSON.stringify(apps);
  const appData = JSON.parse(files["app-data.json"]);
  appData.environments["2"].url = `${site.origin}/app`;
  files["app-data.json"] = JSON.stringify(appData);
  for (const [name, body] of Object.entries(files)) {
    pages[`${BASE}/${name}`] = body;
  }
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function linksOf(card) {
  return card
    .getByRole("link", { name: /KB card / })
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
}

describe("4.x evidence (KB-RAG K15)", () => {
  it("captures an Injected-mode page's calls on Capture and reload, and gives a 4.x verdict with no model request", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    const before = model.requests.length;

    await sendChat(panel, "the Apty widget is not appearing on this page");
    const first = panel
      .getByRole("region", { name: "Why the widget may not be visible" })
      .first();
    await first.waitFor({ timeout: 30_000 });
    await first.getByRole("button", { name: "Capture and reload" }).click();
    await panel
      .getByText(/^Captured \d+ Apty calls\. The check ran on them:$/)
      .waitFor({ timeout: 60_000 });
    const rerun = panel
      .getByRole("region", { name: "Why the widget may not be visible" })
      .nth(1);
    await rerun.getByText("Read from the page's network capture.").waitFor();
    await rerun
      .getByText(/This page belongs to FIXTURE CRM: UAT/)
      .first()
      .waitFor();
    for (const href of await linksOf(rerun)) {
      assert.match(href, /\/spaces\/A4PKH\/pages\/\d+$/, "no 5.x card");
    }
    assert.equal(model.requests.length, before, "the model was not asked");
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await panel.close();
    await app.close();
  });

  it("checks a HAR saved from the 4.x Client's service worker against the tab's page, once confirmed", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    const before = model.requests.length;
    const har = {
      log: {
        entries: Object.entries(files).map(([name, text], i) => ({
          startedDateTime: new Date(
            Date.parse("2026-11-09T10:00:00Z") + i * 1000,
          ).toISOString(),
          request: {
            method: "GET",
            url: `https://cdn.apty.example${BASE}/${name}`,
          },
          response: {
            status: 200,
            content: { mimeType: "application/json", text },
          },
        })),
      },
    };
    await openToolPage(panel, "Check a HAR file");
    await app.bringToFront();
    await panel.getByLabel("Choose a HAR file").setInputFiles({
      name: "service-worker.har",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(har)),
    });
    await panel
      .getByText(/service-worker\.har: \d+ calls, \d+ Apty content files/)
      .waitFor();
    await panel.getByLabel("What is missing?").selectOption("widget");
    await panel
      .getByRole("checkbox", {
        name: `Use the page open in this tab: ${site.origin}/app.html`,
      })
      .check();
    await panel.getByRole("button", { name: "Check", exact: true }).click();
    const card = panel.getByRole("region", {
      name: "Why the widget may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card
      .getByText(/This page belongs to FIXTURE CRM: UAT/)
      .first()
      .waitFor();
    for (const href of await linksOf(card)) {
      assert.match(href, /\/spaces\/A4PKH\/pages\/\d+$/, "no 5.x card");
    }
    assert.equal(model.requests.length, before, "the model was not asked");
    await panel.close();
    await app.close();
  });
});
