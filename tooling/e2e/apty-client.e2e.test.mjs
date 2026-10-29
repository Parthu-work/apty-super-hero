/**
 * The Apty Client integration against real fake-Client extensions loaded
 * next to the Agent: the options-page handshake for a working Client, one
 * that doesn't allow-list the Agent and one without the bridge, the chat
 * agent pulling a large segments body plus a 403 body from the Client, and
 * a bare "get segments.json" answered from the Client with no model call.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  callToolThenReport,
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  savedPeerId,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
  toolResults,
  unpackedExtensionId,
  waitForWorker,
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
  await options.getByRole("tab", { name: "Connection" }).click();
  if (await savedPeerId(options, "client")) {
    await aptyRow(options).getByRole("button", { name: "Disconnect" }).click();
  }
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

/** Every tool result in a request, earlier turns included, parsed when it is JSON. */
function allToolResults(request) {
  return (request.messages ?? [])
    .filter((m) => m.role === "tool")
    .map((m) => {
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    });
}

async function disconnectInOptions(options) {
  await aptyRow(options).getByRole("button", { name: "Disconnect" }).click();
  await options.close();
}

describe("Apty Client integration in a real browser", () => {
  it("shows the Agent's own id for the Client team", async () => {
    const options = await extensionPage(browser);
    await options.getByRole("tab", { name: "Connection" }).click();
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
      "get the data from segments.json in the apty client and summarize it",
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
      // One snapshot key per context (S7): apty_evidence_store:<context>.
      const stored = Object.entries(await chrome.storage.session.get(null))
        .filter(([key]) => key.startsWith("apty_evidence_store"))
        .map(([, value]) => value);
      return JSON.stringify(stored ?? []).includes(evidenceId);
    }, result.response.evidenceId);
    assert.ok(persisted, "evidence should be written to session storage");
    await panel.close();
    await app.close();
  });

  it("inspecting the same body again returns the stored evidence id, which the viewer opens", async () => {
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
      "get segments.json from the apty client again and summarize it",
    );

    const result = toolResults(model.requests.at(-1)).at(-1);
    assert.ok(result.response.evidenceId);
    await panel.getByText("Show thinking details").click();
    await panel.getByRole("button", { name: "View full response" }).click();
    await panel.getByText("Array(206)").waitFor();
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

    await chatAndWait(
      panel,
      "show me themes.json from the apty client and summarize it",
    );

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

  it("never shows the model a record number in a resource name in Strict", async () => {
    await useWorkingClient();
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, {
      redactionMode: "strict",
    });
    model.script(callToolThenReport("list_extension_network_resources", {}));

    await chatAndWait(panel, "what did the apty client load?");

    const result = toolResults(model.requests.at(-1)).at(-1);
    assert.equal(result.connected, true, JSON.stringify(result));
    assert.ok(
      result.resources.some((r) => r.resourceName === ":id.json"),
      JSON.stringify(result.resources),
    );
    assert.ok(!JSON.stringify(result).includes("4815162342"));
    await panel.close();
    await app.close();
  });

  it("withholds a body on the deny list without asking the Client for it (A2)", async () => {
    await useWorkingClient();
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, {
      networkBodyCaptureDenyList: ["/users/"],
      redactionMode: "standard",
    });
    const client = await waitForWorker(browser.context, (url) =>
      url.startsWith(`chrome-extension://${clients.working.id}/`),
    );
    await client.evaluate(() => {
      globalThis.bodyRequests = [];
    });
    const ask = async (resourceQuery, prompt) => {
      model.script(
        callToolThenReport("inspect_extension_network", { resourceQuery }),
      );
      await chatAndWait(panel, prompt);
      return toolResults(model.requests.at(-1)).at(-1);
    };

    const denied = await ask(
      "4815162342.json",
      "get 4815162342.json from the apty client and summarize it",
    );
    assert.equal(denied.status, "body_denied", JSON.stringify(denied));
    assert.equal(denied.deniedBy, "/users/");
    assert.match(denied.request.url, /\/users\/4815162342\.json$/);
    assert.equal(denied.response, undefined);
    assert.ok(!JSON.stringify(denied).includes("en-GB"));

    const allowed = await ask(
      "segments.json",
      "get the data from segments.json in the apty client and summarize it",
    );
    assert.equal(allowed.found, true);
    assert.ok(allowed.response.fullLength > 80_000);

    assert.deepEqual(
      await client.evaluate(() => globalThis.bodyRequests),
      ["r1"],
      "the Client was never asked for the denied body",
    );

    await panel.evaluate(async () => {
      const { apty_settings } = await chrome.storage.local.get("apty_settings");
      await chrome.storage.local.set({
        apty_settings: { ...apty_settings, networkBodyCaptureDenyList: [] },
      });
    });
    const restored = await ask(
      "4815162342.json",
      "get 4815162342.json from the apty client again and summarize it",
    );
    assert.equal(restored.status, "ok", JSON.stringify(restored));
    assert.match(restored.response.bodyPreview, /en-GB/);
    await panel.close();
    await app.close();
  });

  it("answers a bare file request with no model request, and the model can page that evidence on a follow-up (B2)", async () => {
    await useWorkingClient();
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    model.script(() => ({ text: "No script set." }));

    await sendChat(panel, "get segments.json");
    await panel
      .getByRole("button", { name: "View full response" })
      .click({ timeout: 30_000 });
    await panel.getByText("Array(206)").waitFor();
    assert.equal(
      model.requests.length,
      0,
      "the file was read without the model",
    );

    model.script((request) => {
      const results = toolResults(request);
      if (results.length > 0) {
        return {
          text: `RESULT: ${JSON.stringify(results.at(-1)).slice(0, 400)}`,
        };
      }
      const fetched = allToolResults(request).find(
        (r) => r?.response?.evidenceId,
      );
      return {
        tool: "get_evidence_json",
        args: {
          evidenceId: fetched?.response?.evidenceId ?? "missing",
          path: "",
          limit: 1,
          offset: 205,
        },
      };
    });
    await chatAndWait(
      panel,
      "show the last entry of that segments.json from the apty client",
    );

    const fetched = allToolResults(model.requests[0])[0];
    assert.equal(fetched.found, true, JSON.stringify(fetched).slice(0, 500));
    assert.ok(
      fetched.response.truncated,
      "the model gets the same bounded preview as when it calls the tool",
    );
    assert.ok(fetched.response.fullLength > 80_000);
    const page = toolResults(model.requests.at(-1)).at(-1);
    assert.equal(page.found, true, JSON.stringify(page).slice(0, 500));
    assert.equal(page.total, 206);
    assert.equal(page.value.length, 1);
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("withholds a body on the deny list on the fast path too, without asking the Client for it (B2)", async () => {
    await useWorkingClient();
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, {
      networkBodyCaptureDenyList: ["/users/"],
      redactionMode: "standard",
    });
    const client = await waitForWorker(browser.context, (url) =>
      url.startsWith(`chrome-extension://${clients.working.id}/`),
    );
    await client.evaluate(() => {
      globalThis.bodyRequests = [];
    });
    model.script(() => ({ text: "RESULT: noted" }));

    await sendChat(panel, "get 4815162342.json");
    await panel
      .getByText("Completed", { exact: true })
      .waitFor({ timeout: 30_000 });
    assert.equal(
      model.requests.length,
      0,
      "the file was read without the model",
    );
    assert.deepEqual(
      await client.evaluate(() => globalThis.bodyRequests),
      [],
      "the Client was never asked for the denied body",
    );

    await chatAndWait(panel, "what does that mean?");
    const denied = allToolResults(model.requests[0])[0];
    assert.equal(denied.status, "body_denied", JSON.stringify(denied));
    assert.equal(denied.deniedBy, "/users/");
    assert.equal(denied.response, undefined);
    assert.ok(!JSON.stringify(model.requests[0]).includes("en-GB"));
    await panel.close();
    await app.close();
  });
});

describe("Widget network calls in Options, with no model involved", () => {
  async function denyUsersBodies(options) {
    await options.evaluate(async () => {
      const { apty_settings } = await chrome.storage.local.get("apty_settings");
      await chrome.storage.local.set({
        apty_settings: {
          ...apty_settings,
          redactionMode: "strict",
          networkBodyCaptureDenyList: ["/users/"],
        },
      });
    });
  }

  async function downloaded(options, click) {
    const [download] = await Promise.all([
      options.waitForEvent("download"),
      click(),
    ]);
    return {
      name: download.suggestedFilename(),
      text: readFileSync(await download.path(), "utf8"),
    };
  }

  it("lists, filters and downloads the Client's calls, and reads bodies on demand", async () => {
    const client = await waitForWorker(browser.context, (url) =>
      url.startsWith(`chrome-extension://${clients.working.id}/`),
    ).catch(() => null);
    const options = await connectInOptions(clients.working.id);
    await options.getByText("Answering").waitFor({ timeout: 30_000 });
    await denyUsersBodies(options);
    const worker =
      client ??
      (await waitForWorker(browser.context, (url) =>
        url.startsWith(`chrome-extension://${clients.working.id}/`),
      ));
    await worker.evaluate(() => {
      globalThis.bodyRequests = [];
    });

    const section = options.getByRole("region", {
      name: "Widget network calls",
    });
    await section.getByRole("button", { name: "Load network calls" }).click();
    await section
      .getByText("5 unique requests (5 calls).")
      .waitFor({ timeout: 30_000 });
    const listed = await section.innerText();
    assert.match(listed, /missing\.json/);
    assert.match(listed, /404/);
    assert.match(listed, /users\/:id\.json/);
    assert.doesNotMatch(listed, /4815162342/);
    const failedRow = section.getByRole("row", { name: /flows\.json/ });
    assert.match(
      await failedRow.innerText(),
      /Failed[\s\S]*ERR_CONNECTION_RESET/,
    );

    await section.getByRole("button", { name: "4xx" }).click();
    await section
      .getByText("Showing 2 of 5 unique requests (5 calls).")
      .waitFor();
    await section.getByRole("button", { name: "All", exact: true }).click();
    await section.getByLabel("Filter by name, URL or method").fill("segment");
    await section
      .getByText("Showing 1 of 5 unique requests (5 calls).")
      .waitFor();

    const list = await downloaded(options, () =>
      section.getByRole("button", { name: "Download JSON" }).click(),
    );
    assert.equal(list.name, "apty-client-network-calls.redaction-strict.json");
    const parsed = JSON.parse(list.text);
    assert.equal(parsed.redactionMode, "strict");
    assert.deepEqual(parsed.filter, { text: "segment", status: "all" });
    assert.equal(
      parsed.summary,
      "shown 1 of 5 calls, in 1 of 5 unique requests",
    );
    assert.deepEqual(
      parsed.calls.map((call) => call.resourceName),
      ["segment.json"],
    );
    await section.getByLabel("Filter by name, URL or method").fill("");

    await section
      .getByRole("button", { name: "View the body of missing.json" })
      .click();
    await section.getByText('"Not Found"').waitFor({ timeout: 30_000 });

    await section
      .getByRole("button", { name: "View the body of :id.json" })
      .click();
    await section
      .getByText(/Not fetched: its URL matches "\/users\/"/)
      .waitFor({ timeout: 30_000 });
    assert.deepEqual(
      await worker.evaluate(() => globalThis.bodyRequests),
      ["r4"],
      "the Client was never asked for the denied body",
    );

    await section
      .getByRole("button", { name: "View the body of segment.json" })
      .click();
    await section.getByText("Array(206)").waitFor({ timeout: 30_000 });
    const body = await downloaded(options, () =>
      section.getByRole("button", { name: "Download", exact: true }).click(),
    );
    assert.equal(body.name, "segment.json.redaction-strict.json");
    assert.equal(JSON.parse(body.text).length, 206);

    await options.evaluate(async () => {
      const { apty_settings } = await chrome.storage.local.get("apty_settings");
      await chrome.storage.local.set({
        apty_settings: { ...apty_settings, networkBodyCaptureDenyList: [] },
      });
    });
    await disconnectInOptions(options);
  });

  it("names a Client that doesn't allow-list the Agent, with the fix", async () => {
    const options = await connectInOptions(clients["not-allowlisted"].id);
    const section = options.getByRole("region", {
      name: "Widget network calls",
    });
    await section.getByRole("button", { name: "Load network calls" }).click();

    await section
      .getByText("Couldn't load the Client's network calls")
      .waitFor({ timeout: 30_000 });
    const text = await section.innerText();
    assert.match(text, /externally_connectable\.ids/);
    assert.ok(text.includes(AGENT_EXTENSION_ID), text);
    await disconnectInOptions(options);
  });
});
