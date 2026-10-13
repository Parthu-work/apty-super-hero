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

const FORM_PAGE = `<!doctype html><title>Intake</title><main>
<h1>Chart summary</h1>
<label>Patient name <input id="n" value="Jane Testpatient"></label>
<label>Visit notes <textarea id="t">Note-Marker-Asthma</textarea></label>
<label>Referral <select id="s"><option value="a">Active</option><option value="r" selected>Referral-Marker-Cardio</option></select></label>
<div id="e" contenteditable="true" role="textbox" aria-label="Editor">Editor-Marker-Seven</div>
<button type="button">Open chart</button></main>`;

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
    "/form.html": FORM_PAGE,
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
  it("cuts a tool result larger than 2,000 tokens before it is sent, keeping it valid JSON", async () => {
    const { app, tabId } = await openPage("/big.html");
    model.script((request) =>
      toolResults(request).length === 0
        ? { tool: "search_elements", args: { tabId, query: "*Row*" } }
        : { text: "RESULT: done" },
    );
    const panel = await openSidePanel(browser, model, app);
    await chatAndWait(panel, "check the form field text on this page");
    const [sent] = toolMessages(model.requests.at(-1));
    assert.ok(sent.length <= 8000, `sent ${sent.length} characters`);
    const result = JSON.parse(sent);
    assert.equal(result.success, true, "keys survive the cut");
    assert.match(result.data, /more characters not sent\]$/);
    assert.ok(result.truncatedForModel.originalChars > 8000);
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

const VALUE_MARKERS = [
  "Jane Testpatient",
  "Note-Marker-Asthma",
  "Referral-Marker-Cardio",
  "Editor-Marker-Seven",
];

/**
 * Reads the form through search_elements, then asks get_editor_value for the
 * notes field; returns what the model received for both.
 */
async function readForm(mode) {
  const { app, tabId } = await openPage("/form.html");
  model.script((request) => {
    const results = toolResults(request);
    if (results.length === 0) {
      return { tool: "search_elements", args: { tabId, query: "*" } };
    }
    if (results.length === 1) {
      const text = JSON.stringify(results[0]);
      const uid = /uid=([^\s\\"]+) textbox \\?"Visit notes/.exec(text)?.[1];
      assert.ok(uid, `no uid for the notes field in ${text.slice(0, 400)}`);
      return { tool: "get_editor_value", args: { tabId, uid } };
    }
    return { text: "RESULT: done" };
  });
  const panel = await openSidePanel(browser, model, app, {
    redactionMode: mode,
  });
  await chatAndWait(panel, "check the form field values on this page");
  const [search, editor] = toolMessages(model.requests.at(-1));
  await panel.close();
  await app.close();
  return { search, editor };
}

describe("typed values in page reads (O3)", () => {
  it("Strict leaves every typed value out and says the editor value is withheld", async () => {
    const { search, editor } = await readForm("strict");
    for (const marker of VALUE_MARKERS) {
      assert.ok(!search.includes(marker), `${marker} reached the model`);
      assert.ok(!editor.includes(marker), `${marker} reached the model`);
    }
    assert.match(search, /Chart summary/);
    assert.match(search, /Visit notes/);
    assert.match(editor, /withheld/);
  });

  it("Standard masks typed values", async () => {
    const { search, editor } = await readForm("standard");
    for (const marker of VALUE_MARKERS) {
      assert.ok(!search.includes(marker), `${marker} reached the model`);
      assert.ok(!editor.includes(marker), `${marker} reached the model`);
    }
    assert.match(search, /\[masked\]/);
    assert.match(editor, /\[masked\]/);
  });

  it("Off sends typed values as the page has them", async () => {
    const { search, editor } = await readForm("off");
    assert.ok(search.includes("Jane Testpatient"));
    assert.ok(editor.includes("Note-Marker-Asthma"));
  });
});

/**
 * Asks for a screenshot sent to the model; `answer` clicks a button on the
 * approval prompt (or nothing). Returns the tool result and whether any
 * request carried an image.
 */
async function screenshotWith(settings, answer) {
  const { app } = await openPage("/notes.html");
  model.script((request) =>
    model.requests.length === 1
      ? { tool: "capture_screenshot", args: { sendToLLM: true } }
      : { text: "RESULT: done" },
  );
  const panel = await openSidePanel(browser, model, app, settings);
  await chatAndWait(panel, "take a screenshot of this page", {
    whileWaiting: answer
      ? async () => {
          const prompt = panel.getByRole("alertdialog");
          await prompt.waitFor({ timeout: 30_000 });
          assert.match(
            await prompt.innerText(),
            /Send a screenshot of http:\/\/127\.0\.0\.1:\d+ to your AI provider/,
          );
          await prompt.getByRole("button", { name: answer }).click();
        }
      : undefined,
  });
  const [first] = toolMessages(model.requests[1]);
  const imageSent = model.requests.some((r) =>
    JSON.stringify(r.messages).includes("data:image/"),
  );
  await panel.close();
  await app.close();
  return { result: JSON.parse(first), imageSent };
}

describe("screenshot consent (O4)", () => {
  it("asks by default, and a Deny sends no image", async () => {
    const { result, imageSent } = await screenshotWith({}, "Deny");
    assert.equal(result.status, "denied");
    assert.equal(imageSent, false);
  });

  it("sends the image after Allow once", async () => {
    const { result, imageSent } = await screenshotWith({}, "Allow once");
    assert.notEqual(result.status, "denied");
    assert.equal(imageSent, true);
  });

  it("sends without asking when set to always allow", async () => {
    const { imageSent } = await screenshotWith({ screenshotPolicy: "allow" });
    assert.equal(imageSent, true);
  });

  it("refuses without asking when set to never", async () => {
    const { result, imageSent } = await screenshotWith({
      screenshotPolicy: "never",
    });
    assert.equal(result.status, "refused");
    assert.equal(imageSent, false);
  });
});
