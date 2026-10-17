/**
 * The preflight page (C2) in the real Options page: all green against the
 * fixture Apty Client, a configured mock model that calls tools and a
 * framed web page; then each failure state shows its own fix. Run alone
 * with `pnpm demo:check`.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  extensionPage,
  launchBrowser,
  startMockModel,
  startPageServer,
  tempDir,
  unpackedExtensionId,
  writeFakeClient,
} from "./harness.mjs";

const base = tempDir("apty-e2e-preflight-");
const clients = Object.fromEntries(
  ["working", "bridge-missing", "not-allowlisted"].map((mode) => {
    const dir = writeFakeClient(join(base, mode), mode, AGENT_EXTENSION_ID);
    return [mode, { dir, id: unpackedExtensionId(dir) }];
  }),
);

let browser;
let model;
let site;
let app;

const SETTINGS = () => ({
  aiProvider: "custom",
  aiHost: model.baseUrl,
  aiToken: "e2e-key",
  aiModel: "mock-model",
  providerEnabled: true,
});

before(async () => {
  model = await startMockModel();
  // The basic Test Connection call answers in text; the probe calls its tool.
  model.script((request) =>
    request.tools?.some((t) => (t.function?.name ?? t.name) === "report_probe")
      ? { tool: "report_probe", args: { value: "ok" } }
      : { text: "Hello" },
  );
  site = await startPageServer({
    "/app.html":
      '<title>App</title><main><h1>Orders</h1><iframe src="/inner.html"></iframe></main>',
    "/inner.html": "<p>inner frame</p>",
  });
  browser = await launchBrowser({
    extraExtensions: Object.values(clients).map((c) => c.dir),
  });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function store(values) {
  const page = await extensionPage(browser);
  await page.evaluate((v) => chrome.storage.local.set(v), values);
  await page.close();
}

async function useClient(mode) {
  await store({
    "apty-integration-config": { clientExtensionId: clients[mode].id },
  });
}

async function openApp() {
  app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  await app.frameLocator("iframe").getByText("inner frame").waitFor();
}

/** Run every check from `#preflight`; returns `{ [id]: { status, text } }`. */
async function runChecks() {
  const options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html#preflight",
  );
  await options.getByRole("button", { name: "Run all checks" }).click();
  const results = options.getByRole("list", { name: "Preflight results" });
  await results.waitFor({ timeout: 90_000 });
  const rows = await results
    .locator("li")
    .evaluateAll((items) =>
      items.map((li) => [
        li.dataset.check,
        { status: li.dataset.status, text: li.textContent },
      ]),
    );
  return { options, checks: Object.fromEntries(rows) };
}

describe("preflight (C2)", () => {
  it("is all green with a configured provider, the working Client and an open page", async () => {
    await store({ apty_settings: SETTINGS() });
    await useClient("working");
    await openApp();

    const { options, checks } = await runChecks();

    assert.deepEqual(
      Object.fromEntries(
        Object.entries(checks).map(([id, c]) => [id, c.status]),
      ),
      {
        "ai-provider": "pass",
        "apty-client": "pass",
        "agent-id": "pass",
        "bound-tab": "pass",
        "console-bridge": "pass",
        clipboard: "pass",
        "storage-access": "pass",
        "data-handling": "pass",
      },
      JSON.stringify(checks, null, 1),
    );
    assert.match(
      checks["ai-provider"].text,
      /mock-model answered in \d+ ms and calls tools/,
    );
    assert.match(checks["bound-tab"].text, /all 2 frame\(s\) answer/);
    assert.match(checks["agent-id"].text, new RegExp(AGENT_EXTENSION_ID));
    await options.getByText("All checks passed.").waitFor();
    await options.close();
  });

  it("without an API key: the AI provider check says where to add one", async () => {
    await store({ apty_settings: { ...SETTINGS(), aiToken: "" } });
    const { options, checks } = await runChecks();
    assert.equal(checks["ai-provider"].status, "fail");
    assert.match(checks["ai-provider"].text, /No API key or model is set/);
    assert.match(
      checks["ai-provider"].text,
      /Fix: Open Settings → AI Configuration/,
    );
    await store({ apty_settings: SETTINGS() });
    await options.close();
  });

  it("with a Client that does not allow-list the Agent: names the manifest change with this ID", async () => {
    await useClient("not-allowlisted");
    const { options, checks } = await runChecks();
    assert.equal(checks["apty-client"].status, "fail");
    assert.match(
      checks["apty-client"].text,
      new RegExp(`Add "${AGENT_EXTENSION_ID}" to externally_connectable.ids`),
    );
    await options.close();
  });

  it("with a Client that has no bridge module: says to install it", async () => {
    await useClient("bridge-missing");
    const { options, checks } = await runChecks();
    assert.equal(checks["apty-client"].status, "fail");
    assert.match(
      checks["apty-client"].text,
      /Install the Agent bridge module|install or update the Agent bridge module/i,
    );
    await useClient("working");
    await options.close();
  });

  it("with no web page open: the page check says to open one", async () => {
    await app.close();
    const { options, checks } = await runChecks();
    assert.equal(checks["bound-tab"].status, "fail");
    assert.match(checks["bound-tab"].text, /No web page is open/);
    assert.match(
      checks["bound-tab"].text,
      /Fix: Open the application in a tab/,
    );
    await options.close();
  });
});
