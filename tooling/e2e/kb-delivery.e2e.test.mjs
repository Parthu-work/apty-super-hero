/**
 * KB-RAG K26 D7: automatic pack delivery in Chrome, on the E2E policy build
 * (the only build that accepts an http://127.0.0.1 pack source). A local
 * pack host serves synthetic packs signed with a key made at run time; the
 * policy trusts that key and names the host as the 5.x source.
 *
 * Covered: the first fetch loads the pack; a newer pack replaces it and
 * answers with no reload; an older pack is refused and the stored one kept;
 * a 403 shows its reason in Options, Preflight and the chat's KB line; a
 * delivered version cannot be replaced or removed by hand; removing the
 * source removes the alarm.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  extensionPage,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
  startServer,
  tempDir,
} from "./harness.mjs";
import {
  NON_DEMO_SITE,
  TEST_KEY_POLICY,
  writeFixturePack,
} from "./kb-fixture.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

const DAY = 86_400_000;
const ALARM = "kb-pack-sync";

let browser;
let model;
let site;
let host;
let dir;
/** What the pack host answers next: a status and, for 200, a pack file. */
const served = { status: 200, file: undefined };
const requests = [];

const daysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

function pack(name, builtAt) {
  return writeFixturePack(dir, {
    name,
    site: NON_DEMO_SITE,
    space: "RL",
    builtAt,
  });
}

before(async () => {
  dir = tempDir("apty-kb-delivery-");
  model = await startMockModel();
  model.script(() => ({ text: "RESULT: from the model" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  host = await startServer((req, res) => {
    requests.push({
      path: new URL(req.url, "http://x").pathname,
      cookie: req.headers.cookie,
      ifNoneMatch: req.headers["if-none-match"],
    });
    if (served.status !== 200) {
      res.writeHead(served.status).end("FIXTURE sign in");
      return;
    }
    const body = readFileSync(served.file);
    res
      .writeHead(200, {
        "content-type": "application/json",
        etag: `"${body.length}-${served.file.length}"`,
      })
      .end(body);
  });
  browser = await launchBrowser({ extensionDir: ensurePolicyBuild() });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  host?.close();
});

const sourced = (extra = {}) => ({
  ...TEST_KEY_POLICY,
  kbPackSources: { "5.x": `${host.origin}/kb/5x.json` },
  ...extra,
});

async function checkNow() {
  const options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html?tab=general#knowledge-base",
  );
  const card = options.locator("#knowledge-base");
  await card.getByRole("button", { name: "Check now" }).click();
  await card.getByText("Every delivered pack was checked.").waitFor();
  const row = card.getByRole("region", { name: "Loaded knowledge base (5.x)" });
  return { options, card, row };
}

const alarm = () =>
  browser.agentWorker.evaluate((name) => chrome.alarms.get(name), ALARM);

describe("KB pack delivery (KB-RAG K26)", () => {
  it("with no source, creates no alarm and makes no request", async () => {
    await setTestPolicy(browser, TEST_KEY_POLICY);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await alarm(), undefined);
    assert.equal(requests.length, 0);
  });

  it("fetches the first pack on Check now, read-only in Options, and sets the alarm", async () => {
    served.file = pack("first.kbpack.json", daysAgo(5)).file;
    await setTestPolicy(browser, sourced());
    const { options, card, row } = await checkNow();
    await row.getByText("Delivered by your organization").waitFor();
    assert.equal(
      await row.getByTestId("kb-delivery-outcome").innerText(),
      "Updated to a newer pack.",
    );
    await row.getByText(host.origin.replace("http://", "")).waitFor();
    await row.getByText(daysAgo(5).slice(0, 10)).first().waitFor();
    assert.equal(await row.getByRole("button", { name: /Replace/ }).count(), 0);
    assert.equal(await row.getByRole("button", { name: /Remove/ }).count(), 0);
    assert.ok(await card.getByRole("button", { name: /Import pack/ }).count());
    assert.equal(requests.at(-1).path, "/kb/5x.json");
    await options.close();
    assert.equal((await alarm())?.periodInMinutes, 360);
  });

  it("replaces it with a newer pack that answers with no reload, and refuses an older one", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });

    served.file = pack("newer.kbpack.json", daysAgo(3)).file;
    let { options, row } = await checkNow();
    await row.getByText(daysAgo(3).slice(0, 10)).first().waitFor();
    await options.close();

    await sendChat(panel, "the tooltip opens twice when I hover the help icon");
    await panel
      .getByRole("region", { name: "KB cards that match" })
      .first()
      .waitFor({ timeout: 30_000 });

    served.file = pack("older.kbpack.json", daysAgo(6)).file;
    ({ options, row } = await checkNow());
    assert.equal(
      await row.getByTestId("kb-delivery-outcome").innerText(),
      "The host's pack is older than the one in use; the one in use was kept.",
    );
    await row.getByText(daysAgo(3).slice(0, 10)).first().waitFor();
    await options.close();
    await panel.close();
    await app.close();
  });

  it("shows a 403 in Options, Preflight and the chat's KB line", async () => {
    served.status = 403;
    const { options, row } = await checkNow();
    assert.equal(
      await row.getByTestId("kb-delivery-outcome").innerText(),
      "HTTP 403: sign in to the pack host.",
    );
    await options.close();

    const preflight = await extensionPage(
      browser,
      "src/entrypoints/options/index.html#preflight",
    );
    await preflight.getByRole("button", { name: "Run all checks" }).click();
    const delivery = preflight.locator('li[data-check="kb-delivery"]');
    await delivery.waitFor({ timeout: 90_000 });
    assert.equal(await delivery.getAttribute("data-status"), "warn");
    assert.match(
      await delivery.innerText(),
      /5\.x: the last check failed \(HTTP 403: sign in to the pack host\); the stored pack still works\./,
    );
    await preflight.close();

    // The policy now caps a pack's life at 1 day: the stored pack stops answering.
    await setTestPolicy(browser, sourced({ maxPackAgeDays: 1 }));
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(panel, "the tooltip opens twice when I hover the help icon");
    const line = panel.getByTestId("kb-decision-line");
    await line.waitFor({ timeout: 30_000 });
    assert.match(
      await line.innerText(),
      /^The 5\.x pack expired on \d{4}-\d{2}-\d{2}\. The last update of the 5\.x pack from your organization failed \(HTTP 403: sign in to the pack host\)\. /,
    );
    await panel.close();
    await app.close();
  });

  it("removing the source removes the alarm", async () => {
    await setTestPolicy(browser, TEST_KEY_POLICY);
    const deadline = Date.now() + 10_000;
    while ((await alarm()) !== undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(await alarm(), undefined);
  });
});
