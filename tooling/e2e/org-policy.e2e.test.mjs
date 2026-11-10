/**
 * KB-RAG K22 S2: an organization policy (set through the E2E build's test
 * seam, since Playwright cannot set managed storage) locks what it presets.
 * Options shows the preset AI fields and the redaction floor read-only, a
 * direct write to chrome.storage.local does not change them, and the side
 * panel's requests use the preset values. S3: a host outside the allowed
 * origins gets no request, and the chat says why. S6: with the bridge
 * forbidden, Options shows it locked off and a connect is refused.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
} from "./harness.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser({ extensionDir: ensurePolicyBuild() });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("organization policy: locked fields (KB-RAG K22 S2)", () => {
  it("shows the preset AI fields and the redaction floor locked, and the panel uses them", async () => {
    await setTestPolicy(browser, {
      preset: {
        aiProvider: "custom",
        aiHost: model.baseUrl,
        aiModel: "org-model",
        aiToken: "org-key-not-shown",
      },
      redactionFloor: "strict",
    });

    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=ai",
    );
    const card = options.getByTestId("org-policy-ai-card");
    await card.waitFor();
    assert.equal(await card.getByText("Set by your organization").count(), 4);
    assert.match(await card.innerText(), /org-model/);
    assert.doesNotMatch(await card.innerText(), /org-key-not-shown/);
    assert.equal(
      await card.getByRole("textbox", { name: "AI Model" }).count(),
      0,
    );

    await options.goto(
      options.url().replace("?tab=ai", "?tab=general#data-handling"),
    );
    const radio = (name) => options.getByRole("radio", { name });
    const off = radio("Off (development only)");
    await off.waitFor();
    assert.equal(await off.isDisabled(), true);
    assert.equal(await radio("Standard").isDisabled(), true);
    assert.equal(await radio("Strict (recommended)").isChecked(), true);
    await options.close();

    model.script(() => ({ text: "RESULT: answered" }));
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    // openSidePanel writes its own provider, model and key to storage, as a
    // direct write would: the policy's values still win.
    const panel = await openSidePanel(browser, model, app, {
      aiModel: "mine",
      aiToken: "mine-key",
      redactionMode: "off",
    });
    await chatAndWait(panel, "hello there");
    const [request] = model.requests;
    assert.equal(request.model, "org-model");
    await panel.close();
    await app.close();
  });

  it("refuses an AI host outside the allowed origins: no request, and the chat says why (S3)", async () => {
    const other = await startMockModel();
    try {
      other.script(() => ({ text: "RESULT: should not be asked" }));
      model.script(() => ({ text: "RESULT: should not be asked" }));
      await setTestPolicy(browser, {
        allowedOrigins: [model.server.origin],
      });
      const app = await browser.context.newPage();
      await app.goto(`${site.origin}/app.html`);
      const panel = await openSidePanel(browser, model, app, {
        aiHost: other.baseUrl,
      });
      await sendChat(panel, "hello there");
      await panel
        .getByText(
          `This AI provider is not allowed by your organization. Allowed: ${model.server.origin}.`,
        )
        .first()
        .waitFor({ timeout: 30_000 });
      assert.equal(other.requests.length, 0, "no request to the refused host");
      assert.equal(model.requests.length, 0);
      await panel.close();
      await app.close();
    } finally {
      other.close();
    }
  });

  it("keeps the MCP bridge off when the policy forbids it (S6)", async () => {
    await setTestPolicy(browser, { allowMcpBridge: false });
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=connection#mcp-bridge",
    );
    const locked = options.getByTestId("mcp-bridge-locked");
    await locked.waitFor();
    assert.match(await locked.innerText(), /does not allow the MCP bridge/);
    assert.match(await locked.innerText(), /Set by your organization/);
    assert.equal(await options.locator("#mcp-bridge-token").count(), 0);
    const answer = await options.evaluate(() =>
      chrome.runtime.sendMessage({
        request: "ws-bridge-connect",
        url: "ws://localhost:9223",
        token: "a".repeat(43),
      }),
    );
    assert.deepEqual(answer, {
      success: false,
      error: "Your organization does not allow the MCP bridge.",
    });
    await options.close();
  });
});
