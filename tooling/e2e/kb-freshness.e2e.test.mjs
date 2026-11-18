/**
 * KB-RAG K27, E9: packs that stay fresh, on the E2E policy build. A 4.x
 * pack imported by hand has the builder's 60-day life; the policy delivers
 * 5.x from a local pack host with an expiry 59 days out. The panel header
 * says "Packs: 4.x expires in 60 days, 5.x expires in 59 days" (a pack with
 * no expiry reads "ok"); a delivered pack the SE has not seen shows a
 * banner over the chat until Got it, and again for the next delivery; Options
 * shows each pack's self-check. Synthetic packs only; the banner reads what
 * delivery already stored and makes no request of its own.
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
  startMockModel,
  startPageServer,
  startServer,
  tempDir,
} from "./harness.mjs";
import {
  importPack,
  NON_DEMO_SITE,
  TEST_KEY_POLICY,
  writeFixturePack,
} from "./kb-fixture.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

const DAY = 86_400_000;

let browser;
let model;
let site;
let host;
let dir;
let served;
const requests = [];

function deliveredPack(name, builtDaysAgo) {
  return writeFixturePack(dir, {
    name,
    site: NON_DEMO_SITE,
    space: "RL",
    builtAt: new Date(Date.now() - builtDaysAgo * DAY).toISOString(),
    expiresAt: new Date(Date.now() + 59 * DAY - 3_600_000).toISOString(),
  });
}

before(async () => {
  dir = tempDir("apty-kb-freshness-");
  model = await startMockModel();
  model.script(() => ({ text: "RESULT: from the model" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  host = await startServer((req, res) => {
    requests.push(new URL(req.url, "http://x").pathname);
    const body = readFileSync(served);
    res.writeHead(200, { "content-type": "application/json" }).end(body);
  });
  browser = await launchBrowser({ extensionDir: ensurePolicyBuild() });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  host?.close();
});

async function checkNow() {
  const options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html?tab=general#knowledge-base",
  );
  const card = options.locator("#knowledge-base");
  await card.getByRole("button", { name: "Check now" }).click();
  await card.getByText("Every delivered pack was checked.").waitFor();
  return { options, card };
}

const line = (panel) => panel.getByTestId("kb-packs-line");

async function lineReads(panel, text) {
  try {
    await panel.waitForFunction(
      (want) =>
        document.querySelector('[data-testid="kb-packs-line"]')?.textContent ===
        want,
      text,
      { timeout: 30_000 },
    );
  } catch {
    assert.equal(await line(panel).textContent(), text);
  }
}

describe("packs that stay fresh (KB-RAG K27, E9)", () => {
  it("the header follows the packs, the banner follows delivery, and Options shows each self-check", async () => {
    await setTestPolicy(browser, TEST_KEY_POLICY);
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await lineReads(panel, "Packs: none loaded");

    const handMade = writeFixturePack(dir, {
      aptyVersion: "4.x",
      site: NON_DEMO_SITE,
      space: "HX",
    });
    await importPack(browser, handMade.file);
    await lineReads(panel, "Packs: 4.x expires in 60 days");
    assert.equal(await panel.getByTestId("kb-pack-update").count(), 0);

    served = deliveredPack("first.kbpack.json", 2).file;
    await setTestPolicy(browser, {
      ...TEST_KEY_POLICY,
      kbPackSources: { "5.x": `${host.origin}/kb/5x.json` },
    });
    const first = await checkNow();
    await first.options.close();
    await lineReads(
      panel,
      "Packs: 4.x expires in 60 days, 5.x expires in 59 days",
    );
    const banner = panel.getByTestId("kb-pack-update");
    await banner.waitFor({ timeout: 30_000 });
    assert.match(
      await banner.innerText(),
      new RegExp(
        `5\\.x: built ${new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10)}\\. New answers use it\\.`,
      ),
    );

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

    await banner.getByRole("button", { name: "Got it" }).focus();
    await panel.keyboard.press("Enter");
    await banner.waitFor({ state: "detached" });
    await panel.reload();
    await lineReads(
      panel,
      "Packs: 4.x expires in 60 days, 5.x expires in 59 days",
    );
    assert.equal(await panel.getByTestId("kb-pack-update").count(), 0);

    served = deliveredPack("second.kbpack.json", 1).file;
    const second = await checkNow();
    await second.options.close();
    await panel.getByTestId("kb-pack-update").waitFor({ timeout: 30_000 });

    const { options, card } = await checkNow();
    for (const version of ["4.x", "5.x"]) {
      const row = card.getByRole("region", {
        name: `Loaded knowledge base (${version})`,
      });
      const check = row.getByTestId("kb-self-check");
      await check
        .getByText(/^Titles: \d+ of \d+ find their own card in the top 3/)
        .waitFor({ timeout: 30_000 });
      assert.match(
        await check.innerText(),
        /Every title finds its own card in the top 3\.|Not in the top 3: [\d, ]+/,
      );
    }
    await options.close();
    assert.ok(requests.every((path) => path === "/kb/5x.json"));
    assert.equal(await line(panel).count(), 1);
    await panel.close();
    await app.close();
  });
});
