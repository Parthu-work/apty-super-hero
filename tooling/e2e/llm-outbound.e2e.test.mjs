/**
 * O1: what the model receives. A secret on the page that a tool returns
 * unmasked (the page snapshot keeps text nodes as they are), and a secret the
 * person types, are checked in the real request bodies the mock model gets.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  toolResults,
} from "./harness.mjs";

const PAGE_TOKEN = `ghp_${"Ab12Cd34Ef".repeat(3)}`;
const TYPED_TOKEN = `ghp_${"Zy98Xw76Vu".repeat(3)}`;

const rows = (n) =>
  Array.from({ length: n }, (_, i) => `<p>Row ${i} of the order list</p>`).join(
    "",
  );

const BIG_PAGE = `<!doctype html><title>Orders</title><main>${rows(3000)}</main>`;
const MEDIUM_PAGE = `<!doctype html><title>Orders</title><main>${rows(150)}</main>`;

const PAGE = `<!doctype html><title>Notes</title><main><h1>Notes</h1>
<p>Deploy key: ${PAGE_TOKEN}</p><button type="button">Done</button></main>`;

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/notes.html": PAGE,
    "/big.html": BIG_PAGE,
    "/medium.html": MEDIUM_PAGE,
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

function everythingSent() {
  return JSON.stringify(model.requests);
}

/** Calls search_elements on the page, then reports; returns after the model answered. */
async function askAboutPage(settings, prompt) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/notes.html`);
  const tabId = await browser.agentWorker.evaluate(
    async (url) => (await chrome.tabs.query({ url })).at(0)?.id,
    `${site.origin}/notes.html`,
  );
  model.script((request) =>
    toolResults(request).length === 0
      ? { tool: "search_elements", args: { tabId, query: "*Deploy*" } }
      : { text: "RESULT: done" },
  );
  const panel = await openSidePanel(browser, model, app, settings);
  await chatAndWait(panel, prompt);
  await panel.close();
  await app.close();
}

describe("outbound filter (O1)", () => {
  it("masks a secret in a tool result and one the person typed, in Strict", async () => {
    await askAboutPage(
      { redactionMode: "strict" },
      `check the form field text on this page, my key is ${TYPED_TOKEN}`,
    );
    assert.ok(
      model.requests.length >= 2,
      "the snapshot result was sent back to the model",
    );
    const sent = everythingSent();
    assert.ok(!sent.includes(PAGE_TOKEN), "page secret reached the model");
    assert.ok(!sent.includes(TYPED_TOKEN), "typed secret reached the model");
    assert.match(sent, /Deploy key/, "the rest of the page still arrives");
  });

  it("masks a secret in a tool result in Standard", async () => {
    await askAboutPage(
      { redactionMode: "standard" },
      "check the form field text on this page",
    );
    assert.ok(!everythingSent().includes(PAGE_TOKEN));
  });

  it("in Off sends what the person typed but still masks a secret a tool returns", async () => {
    await askAboutPage(
      { redactionMode: "off" },
      `check the form field text on this page, my key is ${TYPED_TOKEN}`,
    );
    const sent = everythingSent();
    assert.ok(sent.includes(TYPED_TOKEN), "Off sends the typed text as is");
    assert.ok(
      !sent.includes(PAGE_TOKEN),
      "tool results keep structural masking",
    );
  });
});

const toolMessages = (request) =>
  (request.messages ?? [])
    .filter((m) => m.role === "tool")
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    );

async function openPage(path) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}${path}`);
  const tabId = await browser.agentWorker.evaluate(
    async (url) => (await chrome.tabs.query({ url })).at(0)?.id,
    `${site.origin}${path}`,
  );
  return { app, tabId };
}

describe("request budget (O2)", () => {
  it("cuts a tool result larger than 2,000 tokens before it is sent", async () => {
    const { app, tabId } = await openPage("/big.html");
    model.script((request) =>
      toolResults(request).length === 0
        ? { tool: "search_elements", args: { tabId, query: "*Row*" } }
        : { text: "RESULT: done" },
    );
    const panel = await openSidePanel(browser, model, app);
    await chatAndWait(panel, "check the form field text on this page");
    const [sent] = toolMessages(model.requests.at(-1));
    assert.ok(sent.length < 8000 + 300, `sent ${sent.length} characters`);
    assert.match(sent, /\[truncated: first 8000 of \d+ characters sent\]/);
    await panel.close();
    await app.close();
  });

  it("sends old results as stubs and keeps the newest four whole", async () => {
    const { app, tabId } = await openPage("/medium.html");
    model.script((request) =>
      toolResults(request).length === 0
        ? { tool: "search_elements", args: { tabId, query: "*Row*" } }
        : { text: "RESULT: done" },
    );
    const panel = await openSidePanel(browser, model, app);
    for (let turn = 1; turn <= 6; turn++) {
      await chatAndWait(
        panel,
        `check the form field text on this page (${turn})`,
      );
    }
    const sent = toolMessages(model.requests.at(-1));
    assert.equal(sent.length, 6, "all six results are still in the request");
    const stubs = sent.filter((m) => m.startsWith('{"stubbed":true'));
    assert.equal(stubs.length, 2, "the two oldest are stubs");
    assert.deepEqual(
      sent.slice(0, 2).map((m) => m.startsWith('{"stubbed":true')),
      [true, true],
    );
    for (const whole of sent.slice(2)) {
      assert.ok(!whole.startsWith('{"stubbed":true'));
      assert.ok(whole.length > 1000);
    }
    const stub = JSON.parse(stubs[0]);
    assert.equal(stub.tool, "search_elements");
    assert.ok(stub.size > 1000);
    assert.ok(stub.preview.length <= 200);
    await panel.close();
    await app.close();
  });
});
