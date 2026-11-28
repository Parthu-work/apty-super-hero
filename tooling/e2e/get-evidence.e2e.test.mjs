/**
 * KB-RAG K27, E8: one Get the evidence button picks the route the Apty
 * Client's mode calls for. On the fake 4.x player in Injected mode it
 * captures the tab while it reloads, or takes a HAR from the Client's
 * service worker on request and checks a dropped one here; the route is
 * remembered for the site. The fake 5.x Client in Extension mode is offered
 * a capture only: the service-worker HAR is the 4.x route (KB-RAG K29, B4).
 * By keyboard alone, with axe in light and dark. Synthetic files only;
 * nothing is sent anywhere and the model is never asked.
 */
import assert from "node:assert/strict";
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  describeViolations,
  launchBrowser,
  openSidePanel,
  openVerdictDetails,
  ROOT,
  runAxe,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-4x",
);
const PLAYER = readFileSync(
  join(ROOT, "tooling/e2e/fixtures/fake-4x-client/injected-player.js"),
  "utf8",
);
const BASE = "/tenant-4x/app-301/env-3012";
const CARD = "Why the widget may not be visible";
const QUESTION = "the Apty widget is not appearing on this page";

let browser;
let model;
let site;
let files;

/** The fake 5.x Client, its content script let onto the test server's other host. */
function fakeClientOnLocalhost() {
  const dir = tempDir("apty-e2e-fake-5x-");
  cpSync(join(ROOT, "tooling/e2e/fixtures/fake-5x-client"), dir, {
    recursive: true,
  });
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.content_scripts[0].matches = ["http://localhost/*"];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return dir;
}

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
    "/injected.html": `<title>CRM</title><h1>Leads</h1><script>${PLAYER}</script>`,
    "/extension.html": "<title>CRM</title><h1>Accounts</h1>",
  };
  site = await startPageServer(pages);
  const apps = JSON.parse(files["app-urls.json"]);
  apps[0].environments["2"].url = `${site.origin}/injected`;
  files["app-urls.json"] = JSON.stringify(apps);
  const appData = JSON.parse(files["app-data.json"]);
  appData.environments["2"].url = `${site.origin}/injected`;
  files["app-data.json"] = JSON.stringify(appData);
  for (const [name, body] of Object.entries(files)) {
    pages[`${BASE}/${name}`] = body;
  }
  browser = await launchBrowser({
    extensionDir: ensurePolicyBuild(),
    extraExtensions: [fakeClientOnLocalhost()],
  });
  // The fake Client's content URL is on loopback, so the policy must list it (A1).
  await setTestPolicy(browser, { aptyContentOrigins: ["http://127.0.0.1:1"] });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function axeInBothThemes(panel) {
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
}

/** Tabs to Get the evidence and presses Enter, as a keyboard user would. */
async function pressGetTheEvidence(panel, evidence) {
  const button = evidence.getByRole("button", { name: "Get the evidence" });
  await button.focus();
  assert.equal(
    await button.evaluate((el) => el === document.activeElement),
    true,
  );
  await panel.keyboard.press("Enter");
}

async function askOn(url) {
  const app = await browser.context.newPage();
  await app.goto(url);
  const panel = await openSidePanel(browser, model, app);
  await sendChat(panel, QUESTION);
  const card = panel.getByRole("region", { name: CARD }).first();
  await card.waitFor({ timeout: 30_000 });
  await openVerdictDetails(card);
  const evidence = card.getByTestId("get-evidence");
  await evidence.waitFor({ timeout: 30_000 });
  await openVerdictDetails(evidence);
  return { app, panel, evidence };
}

function serviceWorkerHar() {
  return {
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
}

describe("Get the evidence (KB-RAG K27, E8)", () => {
  it("captures and reloads the tab for the 4.x player in Injected mode", async () => {
    const before = model.requests.length;
    const { app, panel, evidence } = await askOn(
      `${site.origin}/injected.html`,
    );
    await evidence
      .getByText(/Injected mode: .*Shown by the page's own Apty calls\./)
      .waitFor({ timeout: 30_000 });
    assert.equal(await evidence.getAttribute("data-route"), "capture");
    await axeInBothThemes(panel);

    await pressGetTheEvidence(panel, evidence);
    await panel
      .getByText(/^Captured \d+ Apty calls\. The check ran on them:$/)
      .waitFor({ timeout: 60_000 });
    const recheck = panel.getByRole("region", { name: CARD }).nth(1);
    await recheck.waitFor();
    await openVerdictDetails(recheck);
    await recheck.getByText("Read from the page's network capture.").waitFor();
    assert.equal(model.requests.length, before, "the model was not asked");
    await panel.close();
    await app.close();
  });

  it("takes a service-worker HAR on request for the 4.x player, checks a dropped one, and remembers the route", async () => {
    const before = model.requests.length;
    const first = await askOn(`${site.origin}/injected.html`);
    await first.evidence
      .getByRole("button", { name: "Use a HAR instead" })
      .click();
    await first.evidence
      .getByText(/^Route: a HAR from the Client's service worker\./)
      .waitFor({ timeout: 30_000 });
    assert.equal(await first.evidence.getAttribute("data-route"), "har");

    await pressGetTheEvidence(first.panel, first.evidence);
    const input = first.evidence.getByLabel(
      "Drop the HAR file here, or choose it",
    );
    await input.waitFor({ state: "attached" });
    await input.setInputFiles({
      name: "service-worker.har",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(serviceWorkerHar())),
    });
    await first.evidence
      .getByText(/service-worker\.har: \d+ calls, \d+ Apty content files/)
      .waitFor();
    await first.evidence
      .getByRole("checkbox", { name: /^Use the page open in this tab:/ })
      .check();
    await first.evidence.getByRole("button", { name: "Check the HAR" }).click();
    await first.evidence
      .getByRole("region", { name: CARD })
      .waitFor({ timeout: 30_000 });
    await axeInBothThemes(first.panel);
    await first.panel.close();
    await first.app.close();

    const again = await askOn(`${site.origin}/injected.html`);
    await again.evidence
      .getByText(
        "Route: a HAR from the Client's service worker. Last used on this site.",
      )
      .waitFor({ timeout: 30_000 });
    assert.equal(model.requests.length, before, "the model was not asked");
    await again.panel.close();
    await again.app.close();
  });

  it("offers the 5.x Client in Extension mode a capture, never the 4.x service-worker HAR (KB-RAG K29, B4)", async () => {
    const before = model.requests.length;
    const page = new URL(`${site.origin}/extension.html`);
    page.hostname = "localhost";
    const { app, panel, evidence } = await askOn(page.href);
    await evidence
      .getByText(
        /Extension mode: .*Shown by the script the Apty Client injects into the page\./,
      )
      .waitFor({ timeout: 30_000 });
    assert.equal(await evidence.getAttribute("data-route"), "capture");
    await evidence.getByText("Route: Capture and reload this tab.").waitFor();
    assert.equal(
      await evidence.getByRole("button", { name: "Use a HAR instead" }).count(),
      0,
    );
    assert.equal(
      await evidence
        .getByText("Save a HAR from the 4.x Client's service worker")
        .count(),
      0,
    );
    await axeInBothThemes(panel);
    assert.equal(model.requests.length, before, "the model was not asked");
    await panel.close();
    await app.close();
  });
});
