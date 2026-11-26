/**
 * Replay: the Agent fetches Apty's published content itself, for the IDs the
 * SE gives, with no Apty Client record at all. The page carries only an
 * injected player config (no Client extension), and its URL matches no
 * environment, so nothing the page shows picks one: the SE names the tenant,
 * application and environment, the model pins them with
 * resolve_apty_context, and the tooltip and workflow checks then run with no
 * model on the synthetic files a local content host serves the way
 * CloudFront does (a missing file is a 200 not-found page). Every file gate
 * names its source, and no request carries credentials.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  callToolThenReport,
  launchBrowser,
  openSidePanel,
  openVerdictDetails,
  ROOT,
  sendChat,
  startMockModel,
  startPageServer,
  startServer,
} from "./harness.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-5x",
);
const TENANT = "0f000000-0000-7000-8000-000000000000";
const APP = "0a000000-0000-7000-8000-000000000001";
const ENV = "0e000000-0000-7000-8000-000000000002";
const AGENT_SOURCE = "(published file, fetched by the Agent)";

let browser;
let model;
let site;
let cdn;
const served = [];

before(async () => {
  model = await startMockModel();
  const files = Object.fromEntries(
    readdirSync(FIXTURES).map((name) => [
      name,
      readFileSync(join(FIXTURES, name), "utf8"),
    ]),
  );
  const tenant = `/tenant-${TENANT}`;
  const app = `${tenant}/app-${APP}`;
  const routes = {
    [`${tenant}/app-urls.json`]: files["app-urls.json"],
    [`${app}/app-data.json`]: files["app-data.json"],
    ...Object.fromEntries(
      Object.entries(files)
        .filter(([name]) => name !== "tooltip.json")
        .map(([name, text]) => [`${app}/env-${ENV}/${name}`, text]),
    ),
  };
  cdn = await startServer((req, res) => {
    const url = new URL(req.url, "http://x");
    served.push({
      path: url.pathname,
      method: req.method,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
      timestamp: url.searchParams.get("timestamp"),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      routes[url.pathname] ??
        JSON.stringify({ message: "No data found", status: 404 }),
    );
  });
  site = await startPageServer({
    "/app.html": `<title>CRM</title><h1>Leads</h1><script>window.__APTY_PLAYER_CONFIG__ = ${JSON.stringify(
      { contentURL: cdn.origin, tenantId: TENANT },
    )};</script>`,
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  cdn?.close();
});

async function pinnedPanel() {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app);
  model.script(
    callToolThenReport("resolve_apty_context", {
      tenantId: TENANT,
      applicationId: APP,
      environmentId: ENV,
    }),
  );
  await sendChat(
    panel,
    `Use tenant id ${TENANT}, application id ${APP} and environment id ${ENV}`,
  );
  await panel.getByText(/RESULT: .*"pinned":true/).waitFor({ timeout: 30_000 });
  return { app, panel };
}

describe("checks on published files the Agent fetches for given IDs, with no Client", () => {
  it("finds a workflow hidden from the widget, each file row naming the Agent's fetch", async () => {
    const { app, panel } = await pinnedPanel();
    const before = model.requests.length;
    const requestsBefore = served.length;

    await sendChat(
      panel,
      "My workflow 'Take a tour' is not visible in the widget",
    );

    const card = panel.getByRole("region", {
      name: "Why “Take a tour” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await openVerdictDetails(card);
    await card.getByText("Cause found").waitFor();
    await card.getByText("workflow.json: hideFromWidget = true").waitFor();
    await card.getByText(AGENT_SOURCE).first().waitFor();
    await card
      .getByText(
        "Content files fetched by the Agent from Apty's content host",
        {
          exact: false,
        },
      )
      .waitFor();
    assert.equal(
      model.requests.length,
      before,
      "the check made no model request",
    );

    const fetched = served.slice(requestsBefore);
    assert.ok(
      fetched.some((r) => r.path.endsWith(`/env-${ENV}/workflow.json`)),
      "workflow.json was fetched for the given environment",
    );
    const text = await card.textContent();
    assert.ok(!text.includes("http"), "the card shows no URL");
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("says the tooltip file is not published when the host serves its not-found page", async () => {
    const { app, panel } = await pinnedPanel();
    const before = model.requests.length;

    await sendChat(panel, "My tooltip 'Lead source help' is not visible");

    const card = panel.getByRole("region", {
      name: "Why “Lead source help” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await openVerdictDetails(card);
    await card.getByText(AGENT_SOURCE).first().waitFor();
    await card.getByText("404", { exact: false }).first().waitFor();
    assert.equal(
      model.requests.length,
      before,
      "the check made no model request",
    );
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("made only GETs, with no cookie or credentials, and the player's timestamp", () => {
    assert.ok(served.length > 0);
    for (const request of served) {
      assert.equal(request.method, "GET");
      assert.equal(request.cookie, undefined);
      assert.equal(request.authorization, undefined);
      assert.match(request.timestamp ?? "", /^\d+$/);
    }
  });
});
