/**
 * The Ask Dapty check with an Apty Client that reports nothing, as every
 * Client does today: like 5.x, it takes every external message and answers
 * none of the Agent's, and no Client ID is saved in the Agent. The Client only does what the real one does on every page:
 * inject `chrome-extension://<id>/window-script.js` and serve its
 * web-accessible `player-config.json`. The Agent finds the Client from the
 * page, reads the content files and the user's stored chat from the content
 * CDN (a local server here), and shows each suggestion's outcome with ids,
 * with no model request. With Settings' content CDN switch off, it reads
 * nothing from the CDN.
 */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  launchBrowser,
  openSidePanel,
  ROOT,
  sendChat,
  startMockModel,
  startPageServer,
  startServer,
  tempDir,
} from "./harness.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-5x",
);
const TENANT = "0f000000-0000-7000-8000-000000000000";
const APP = "0a000000-0000-7000-8000-000000000001";
const ENV = "0e000000-0000-7000-8000-000000000002";
const CHAT_ID = "0197aaaa-0000-7000-8000-000000000001";
const STORED_CHAT = {
  id: CHAT_ID,
  name: "Reports",
  messages: [
    {
      id: "m1",
      role: "user",
      content: "How do I export my pipeline? I am jane.doe@example.com",
    },
    {
      id: "m2",
      role: "assistant",
      content: "Try these workflows.",
      suggestions: [
        {
          id: "0c000000-0000-7000-8000-000000000005",
          name: "Export a report",
          type: "workflow",
        },
        {
          id: "0c000000-0000-7000-8000-000000000008",
          name: "Qualify a lead",
          type: "workflow",
        },
        {
          id: "0c000000-0000-7000-8000-0000000000ff",
          name: "Retired flow",
          type: "workflow",
        },
      ],
    },
  ],
};

/** An Apty Client as it ships: a page script and a config, and no answer to other extensions. */
function writeUnpatchedClient(dir, contentURL) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Apty Client E2E (unpatched)",
      version: "1.0.0",
      background: { service_worker: "background.js" },
      content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }],
      web_accessible_resources: [
        { matches: ["<all_urls>"], resources: ["player-config.json"] },
        { matches: ["<all_urls>"], resources: ["window-script.js"] },
      ],
    }),
  );
  writeFileSync(
    join(dir, "content.js"),
    `const script = document.createElement("script");
script.src = chrome.runtime.getURL("window-script.js");
(document.head ?? document.documentElement).appendChild(script);
`,
  );
  writeFileSync(join(dir, "window-script.js"), "void 0;\n");
  // Like the 5.x Client's IPC receiver (chrome-background-transport.ts): it
  // takes every external message and never answers one it does not know.
  writeFileSync(
    join(dir, "background.js"),
    "chrome.runtime.onMessageExternal.addListener(() => true);\n",
  );
  writeFileSync(
    join(dir, "player-config.json"),
    JSON.stringify({ contentURL, tenantId: TENANT, isSelfHosted: false }),
  );
  return dir;
}

let browser;
let model;
let site;
let cdn;
const served = [];

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html":
      "<title>CRM</title><h1>Reports</h1><script>window.crmUser = { id: 'u-7' };</script>",
  });
  const files = Object.fromEntries(
    readdirSync(FIXTURES).map((name) => [
      name,
      readFileSync(join(FIXTURES, name), "utf8"),
    ]),
  );
  const appData = JSON.parse(files["app-data.json"]);
  appData.config.userIdentificationConfig = {
    type: "WindowStorage",
    value: "crmUser.id",
  };
  const appUrls = [
    {
      id: APP,
      environments: [{ id: ENV, order: 1, urls: [`${site.origin}/*`] }],
    },
  ];
  const tenant = `/tenant-${TENANT}`;
  const app = `${tenant}/app-${APP}`;
  const routes = {
    [`${tenant}/app-urls.json`]: JSON.stringify(appUrls),
    [`${app}/app-data.json`]: JSON.stringify(appData),
    [`${app}/users/u-7/widget-chat/chat-list.json`]: JSON.stringify({
      chats: [{ id: CHAT_ID, name: "Reports", lastUpdate: "2026-10-31" }],
    }),
    [`${app}/users/u-7/widget-chat/${CHAT_ID}.json`]:
      JSON.stringify(STORED_CHAT),
    ...Object.fromEntries(
      Object.entries(files).map(([name, text]) => [
        `${app}/env-${ENV}/${name}`,
        text,
      ]),
    ),
  };
  cdn = await startServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    served.push({ path, cookie: req.headers.cookie });
    if (routes[path] === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(routes[path]);
  });
  const clientDir = writeUnpatchedClient(
    join(tempDir("apty-e2e-dapty-cdn-"), "client"),
    cdn.origin,
  );
  browser = await launchBrowser({ extraExtensions: [clientDir] });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  cdn?.close();
});

describe("checks with an unpatched Apty Client", () => {
  it("finds the Client from the page, reads the stored chat and content files from the CDN, and checks each suggestion by id", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    await app.waitForFunction(() =>
      document.querySelector('script[src$="/window-script.js"]'),
    );
    const panel = await openSidePanel(browser, model, app);
    const before = model.requests.length;

    const asked = Date.now();
    await sendChat(panel, "Dapty suggested a workflow but nothing opens");

    const card = panel.getByRole("region", { name: "Ask Dapty chat check" });
    await card.waitFor({ timeout: 30_000 });
    const tookMs = Date.now() - asked;
    await card
      .getByText("From the stored chat on Apty's content CDN: 2 turn(s).")
      .waitFor();
    await card.getByText("Rule DAP-06").waitFor();
    await card.getByText("Not published here: opens nothing").waitFor();
    await card
      .getByText("Opens only if visibility rule “On a lead page” passes")
      .waitFor();
    await card
      .getByText(
        "Content files read from Apty's content CDN, as the Apty Client does not report its calls.",
      )
      .waitFor();
    const text = await card.textContent();
    assert.ok(!text.includes("Matched by name"), "suggestions carry ids");
    assert.ok(!text.includes("http"), "the card shows no URL");
    assert.ok(!text.includes("jane.doe@example.com"), "the email is masked");
    assert.equal(model.requests.length, before, "the model was not asked");
    assert.ok(
      tookMs < 6_000,
      `the check did not wait on a Client that never answers (${tookMs} ms)`,
    );
    assert.ok(
      served.some((r) => r.path.endsWith(`/widget-chat/${CHAT_ID}.json`)),
      "the stored chat was read from the CDN",
    );
    assert.ok(
      served.every((r) => r.cookie === undefined),
      "no credentials were sent",
    );
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("exports the evidence bundle from the card with Developer tools on, with no email or user id in it", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    await app.waitForFunction(() =>
      document.querySelector('script[src$="/window-script.js"]'),
    );
    const panel = await openSidePanel(browser, model, app, {
      developerTools: true,
    });

    await sendChat(panel, "Dapty suggested a workflow but nothing opens");
    const card = panel.getByRole("region", { name: "Ask Dapty chat check" });
    await card.waitFor({ timeout: 30_000 });
    await card.getByRole("button", { name: "Export evidence" }).click();
    const review = panel.getByRole("region", {
      name: "Ask Dapty evidence bundle",
    });
    await review.waitFor();
    const text = await review.textContent();
    const bundle = JSON.parse(text);

    assert.equal(bundle.bundleVersion, "apty-dapty-evidence/1");
    assert.equal(bundle.result.packId, "dapty-conversation");
    assert.equal(typeof bundle.versions.agent, "string");
    assert.ok("commit" in bundle.versions && "chrome" in bundle.versions);
    assert.equal(bundle.evidence.answeredBy, "cdn");
    assert.equal(bundle.evidence.clientPing, "silent");
    assert.equal(bundle.evidence.storedChat, "read");
    assert.equal(bundle.evidence.storedChatFile.messages, 2);
    assert.ok(
      bundle.evidence.files.some(
        (f) => f.name === "app-data.json" && f.scope === "app",
      ),
    );
    assert.ok(typeof bundle.evidence.totalMs === "number");
    for (const secret of [
      "jane.doe@example.com",
      "u-7",
      "crmUser",
      TENANT,
      APP,
      ENV,
      CHAT_ID,
      "How do I export my pipeline",
    ]) {
      assert.ok(!text.includes(secret), `the bundle holds ${secret}`);
    }
    assert.ok(!/https?:\/\//.test(text), "the bundle holds no URL");
    await panel.getByRole("button", { name: "Cancel" }).click();
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("runs the widget check from the content CDN too, with no Client ID saved", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    await app.waitForFunction(() =>
      document.querySelector('script[src$="/window-script.js"]'),
    );
    const panel = await openSidePanel(browser, model, app);
    const before = model.requests.length;
    const asked = Date.now();

    await sendChat(panel, "the Apty widget is not appearing");

    const card = panel.getByRole("region", {
      name: "Why the widget may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    const tookMs = Date.now() - asked;
    await card
      .getByText(
        "Content files read from Apty's content CDN, as the Apty Client does not report its calls.",
      )
      .waitFor();
    const text = await card.textContent();
    assert.ok(!text.includes("http"), "the card shows no URL");
    assert.ok(
      !/No Apty Client extension ID is saved/.test(text),
      "the check did not stop at the missing Client ID",
    );
    assert.equal(model.requests.length, before, "the model was not asked");
    assert.ok(tookMs < 6_000, `the check finished quickly (${tookMs} ms)`);
    assert.ok(
      served.some((r) => r.path.endsWith(`/env-${ENV}/segment.json`)),
      "segment.json was read from the CDN",
    );
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("reads nothing from the content CDN with Settings' content CDN switch off, and says the Client gave nothing", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    await app.waitForFunction(() =>
      document.querySelector('script[src$="/window-script.js"]'),
    );
    const panel = await openSidePanel(browser, model, app, {
      aptyCdnFallback: false,
    });
    const requestsBefore = served.length;
    const before = model.requests.length;

    await sendChat(panel, "the Apty widget is not appearing");

    const card = panel.getByRole("region", {
      name: "Why the widget may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card
      .getByText("No Apty Client extension ID is saved", { exact: false })
      .first()
      .waitFor();
    const text = await card.textContent();
    assert.ok(
      !text.includes("Apty's content CDN"),
      "the card does not mention the CDN",
    );
    assert.equal(model.requests.length, before, "the model was not asked");
    assert.equal(
      served.length,
      requestsBefore,
      `the content CDN got no request (${served
        .slice(requestsBefore)
        .map((r) => r.path)
        .join(", ")})`,
    );
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });
});
