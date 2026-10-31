/**
 * The Ask Dapty capture layer in a real Chromium with the built Agent: the
 * injected Widget's chat call seen on the tab's network (passively, then
 * with both bodies while recording), the same call made by another
 * extension's service worker (extension mode) seen by neither source, and
 * the Widget's chat panel read from its open shadow root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  extensionPage,
  launchBrowser,
  startServer,
  waitForWorker,
} from "./harness.mjs";

const FIXTURES = fileURLToPath(
  new URL("./fixtures/dapty-capture/", import.meta.url),
);
const CLIENT_DIR = join(FIXTURES, "extension-mode-client");
const CHAT_PATH = "/ai-service/api/v1/ai/tenant-1/widget/chat";
const WIDGET_PAGE = readFileSync(join(FIXTURES, "widget-page.html"), "utf8");

let browser;
let server;
let agentPage;
const asked = [];

function replyTo(message) {
  return {
    reply: `Answer to: ${message}`,
    suggestions: [{ id: "wf-1", name: "Create vendor", type: "workflow" }],
    title: "Vendors",
  };
}

before(async () => {
  server = await startServer((req, res, body) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === CHAT_PATH) {
      const { message } = JSON.parse(body);
      asked.push(message);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(replyTo(message)));
      return;
    }
    if (url.pathname === "/widget.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(WIDGET_PAGE);
      return;
    }
    res.writeHead(404).end();
  });
  browser = await launchBrowser({ extraExtensions: [CLIENT_DIR] });
  agentPage = await extensionPage(browser);
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** Sends a runtime message from the Agent's own extension page, as the side panel does. */
function askAgent(message) {
  return agentPage.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

async function tabIdOf(url) {
  return agentPage.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return tab?.id;
  }, url);
}

async function pageCalls(tabId) {
  const answer = await askAgent({ type: "apty-agent:dapty-page-calls", tabId });
  return answer?.calls ?? [];
}

async function eventually(read, done, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out; last value: ${JSON.stringify(last)}`);
}

async function openWidgetPage() {
  const page = await browser.context.newPage();
  const url = `${server.origin}/widget.html`;
  await page.goto(url);
  return { page, tabId: await tabIdOf(url) };
}

describe("Ask Dapty capture", () => {
  it("returns the injected Widget's chat call, with both bodies while recording", async () => {
    const { page, tabId } = await openWidgetPage();
    assert.equal(typeof tabId, "number");

    await page.evaluate(() => window.askDapty("How do I add a vendor?"));
    const passive = await eventually(
      () => pageCalls(tabId),
      (calls) => calls.some((c) => c.status === 200),
    );
    assert.equal(passive.length, 1);
    assert.equal(passive[0].source, "page");
    assert.equal(passive[0].kind, "chat");
    assert.equal(passive[0].method, "POST");
    assert.ok(passive[0].url.startsWith(`${server.origin}${CHAT_PATH}`));
    assert.equal(
      JSON.parse(passive[0].requestBody).message,
      "How do I add a vendor?",
    );

    const recording = await askAgent({
      type: "apty-agent:dapty-record",
      tabId,
      maxMs: 30_000,
    });
    assert.equal(recording?.ok, true);
    const context = [
      { role: "user", content: "How do I add a vendor?" },
      { role: "assistant", content: "Answer to: How do I add a vendor?" },
    ];
    await page.evaluate(
      (c) => window.askDapty("And who approves it?", c),
      context,
    );
    const recorded = await eventually(
      () => pageCalls(tabId),
      (calls) => calls.some((c) => c.responseBody),
    );
    await askAgent({ type: "apty-agent:dapty-stop-recording", tabId });

    assert.equal(recorded.length, 2, JSON.stringify(recorded));
    const second = recorded[1];
    assert.equal(second.status, 200);
    assert.deepEqual(JSON.parse(second.requestBody), {
      message: "And who approves it?",
      context,
      envId: "prod",
      applicationType: "web",
    });
    assert.deepEqual(
      JSON.parse(second.responseBody),
      replyTo("And who approves it?"),
    );
    await page.close();
  });

  it("returns nothing for the same call made from another extension's service worker", async () => {
    const { page, tabId } = await openWidgetPage();
    const clientWorker = await waitForWorker(browser.context, (url) =>
      url.endsWith("/worker.js"),
    );
    const clientId = new URL(clientWorker.url()).host;
    const trigger = await browser.context.newPage();
    await trigger.goto(`chrome-extension://${clientId}/trigger.html`);
    const triggerTabId = await tabIdOf(
      `chrome-extension://${clientId}/trigger.html`,
    );

    const answer = await trigger.evaluate(
      (origin) =>
        chrome.runtime.sendMessage({
          type: "fake-client:ask-dapty",
          origin,
          message: "extension-mode question",
        }),
      server.origin,
    );
    assert.equal(answer?.ok, true, JSON.stringify(answer));
    assert.ok(asked.includes("extension-mode question"));
    await new Promise((resolve) => setTimeout(resolve, 1000));

    for (const id of [tabId, triggerTabId]) {
      const calls = await pageCalls(id);
      assert.ok(
        !JSON.stringify(calls).includes("extension-mode question"),
        JSON.stringify(calls),
      );
    }
    assert.deepEqual(await pageCalls(tabId), []);
    await trigger.close();
    await page.close();
  });

  it("reads the Widget's chat panel from its open shadow root", async () => {
    const { page, tabId } = await openWidgetPage();

    const read = await askAgent({
      type: "apty-agent:dapty-widget-turns",
      tabId,
    });

    assert.deepEqual(read, {
      ok: true,
      turns: [
        {
          role: "user",
          text: "How do I add a vendor?",
          suggestionNames: [],
        },
        {
          role: "assistant",
          text: "Use the Create vendor workflow.\n\nOpen Vendors\nClick New",
          suggestionNames: ["Create vendor", "Vendor policy"],
        },
        { role: "user", text: "And who approves it?", suggestionNames: [] },
        {
          role: "error",
          text: "Something went wrong. Try again.",
          suggestionNames: [],
        },
      ],
    });
    await page.close();
  });
});
