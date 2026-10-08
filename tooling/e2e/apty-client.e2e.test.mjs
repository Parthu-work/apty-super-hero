/**
 * The Apty Client integration against real fake-Client extensions loaded
 * next to the Agent: the options-page handshake for a working Client, one
 * that doesn't allow-list the Agent and one without the bridge, and the
 * chat agent pulling a large segments body plus a 403 body from the Client.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  callToolThenReport,
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  tempDir,
  toolResults,
  unpackedExtensionId,
  writeFakeClient,
} from "./harness.mjs";

const base = tempDir("apty-e2e-clients-");
const clients = Object.fromEntries(
  ["working", "bridge-missing", "not-allowlisted"].map((mode) => {
    const dir = writeFakeClient(join(base, mode), mode, AGENT_EXTENSION_ID);
    return [mode, { dir, id: unpackedExtensionId(dir) }];
  }),
);

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<title>App</title><h1>App</h1>",
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

/** The Apty Client panel's ID field and its buttons (the MCP panel has its own Connect). */
function aptyRow(options) {
  return options.getByLabel("Extension ID").locator("..");
}

async function connectInOptions(clientId) {
  const options = await extensionPage(browser);
  await options.getByText("Apty Integration").click();
  const disconnect = aptyRow(options).getByRole("button", {
    name: "Disconnect",
  });
  if (await disconnect.isVisible()) await disconnect.click();
  await options.getByLabel("Extension ID").fill(clientId);
  await aptyRow(options)
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  return options;
}

/** Save the working Client in options, as a user would before chatting. */
async function useWorkingClient() {
  const options = await connectInOptions(clients.working.id);
  await options.getByText("Answering").waitFor({ timeout: 30_000 });
  await options.close();
}

async function disconnectInOptions(options) {
  await aptyRow(options).getByRole("button", { name: "Disconnect" }).click();
  await options.close();
}

describe("Apty Client integration in a real browser", () => {
  it("shows the Agent's own id for the Client team", async () => {
    const options = await extensionPage(browser);
    await options.getByText("Apty Integration").click();
    await options.getByText(AGENT_EXTENSION_ID).waitFor();
    await options.close();
  });

  it("reports a Client that doesn't allow-list the Agent", async () => {
    const options = await connectInOptions(clients["not-allowlisted"].id);

    await options
      .getByText("Installed, but not answering the Agent.")
      .waitFor({ timeout: 30_000 });
    assert.match(
      await options.locator("body").innerText(),
      /externally_connectable\.ids/,
    );
    await disconnectInOptions(options);
  });

  it("reports a Client whose bridge doesn't answer", async () => {
    const options = await connectInOptions(clients["bridge-missing"].id);

    await options
      .getByText("Installed, but not answering the Agent.")
      .waitFor({ timeout: 40_000 });
    // Chrome either fails the call ("message port closed") or leaves it
    // hanging until the Agent's timeout; both must point at the bridge.
    const text = await options.locator("body").innerText();
    assert.match(
      text,
      /does not implement the apty-debug-agent:get-service-worker-status message/,
    );
    assert.doesNotMatch(text, /Chrome refused to send/);
    await disconnectInOptions(options);
  });

  it("confirms a working Client with a real handshake, and Test connection repeats it", async () => {
    const options = await connectInOptions(clients.working.id);

    await options.getByText("Answering").waitFor({ timeout: 30_000 });
    await aptyRow(options)
      .getByRole("button", { name: "Test connection" })
      .click();
    await options.getByText("Answering").waitFor({ timeout: 30_000 });
    await options.close();
  });

  it("lets the agent read the full segments body, and shows the user all of it", async () => {
    await useWorkingClient();
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    model.script(
      callToolThenReport("inspect_extension_network", {
        resourceQuery: "segments.json",
      }),
    );

    await chatAndWait(
      panel,
      "get the data from segments.json in the apty client",
    );

    const result = toolResults(model.requests.at(-1)).at(-1);
    assert.equal(result.found, true, JSON.stringify(result).slice(0, 500));
    assert.match(result.request.url, /segment\.json$/);
    assert.ok(
      result.response.truncated,
      "the model should only get a bounded preview",
    );
    assert.ok(result.response.fullLength > 80_000);
    assert.ok(result.response.evidenceId);

    // Tool calls sit in the collapsed thinking section, as for any tool.
    await panel.getByText("Show thinking details").click();
    await panel.getByRole("button", { name: "View full response" }).click();
    await panel.getByText("Array(206)").waitFor();
    assert.equal(await panel.getByText("{3 keys}").count(), 100);
    await panel.getByRole("button", { name: /Show 100 more/ }).click();
    await panel.getByRole("button", { name: /Show 6 more/ }).click();
    assert.equal(await panel.getByText("{3 keys}").count(), 206);

    const persisted = await panel.evaluate(async (evidenceId) => {
      const stored = (await chrome.storage.session.get("apty_evidence_store"))
        .apty_evidence_store;
      return JSON.stringify(stored ?? []).includes(evidenceId);
    }, result.response.evidenceId);
    assert.ok(persisted, "evidence should be written to session storage");
    await panel.close();
    await app.close();
  });

  it("returns the body of a 403 response too", async () => {
    await useWorkingClient();
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    model.script(
      callToolThenReport("inspect_extension_network", {
        resourceQuery: "themes.json",
      }),
    );

    await chatAndWait(panel, "show me themes.json from the apty client");

    const result = toolResults(model.requests.at(-1)).at(-1);
    assert.equal(
      result.status,
      "http_error",
      JSON.stringify(result).slice(0, 500),
    );
    assert.equal(result.request.status, 403);
    assert.match(result.response.bodyPreview, /token expired/);
    await panel.close();
    await app.close();
  });
});
