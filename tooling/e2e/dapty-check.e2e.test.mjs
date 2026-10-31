/**
 * The Ask Dapty check in Chromium with the built Agent: an end user asked
 * the widget's AI assistant and got suggestions that do not open, or no
 * answer at all. From a fake Apty Client that recorded the chat call
 * (Extension mode), and from a customer's HAR (Injected mode), the side
 * panel shows what each suggestion does on a click, why a call failed, and
 * the cause, with no model request; a follow-up reaches the model with the
 * check in its history, never a URL.
 */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  openToolPage,
  ROOT,
  runAxe,
  savedPeerId,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
  unpackedExtensionId,
} from "./harness.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-5x",
);
const files = Object.fromEntries(
  readdirSync(FIXTURES).map((name) => [
    name,
    readFileSync(join(FIXTURES, name), "utf8"),
  ]),
);
const APP = "0a000000-0000-7000-8000-000000000001";
const ENV_PATH = `https://client.apty.example/tenant-0f000000-0000-7000-8000-000000000000/app-${APP}/env-0e000000-0000-7000-8000-000000000002`;
const CHAT = `https://api.app.apty.ai/ai-service/api/v1/ai/0f000000-0000-7000-8000-000000000000/widget/chat?applicationId=${APP}`;
const STORED = `https://client.apty.example/tenant-0f000000-0000-7000-8000-000000000000/app-${APP}/users/u-1/widget-chat/0197aaaa-0000-7000-8000-000000000001.json`;
const ANSWER = JSON.stringify({
  reply: "Try these workflows.",
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
});
const STORED_CHAT = JSON.stringify({
  id: "0197aaaa-0000-7000-8000-000000000001",
  name: "Reports",
  messages: [
    {
      id: "msg-0",
      role: "user",
      content: "How do I export my pipeline? I am jane.doe@example.com",
    },
  ],
});

/**
 * A fake Apty Client in Extension mode: it serves the content files and the
 * chat calls it made from its own service worker, the way the reference
 * module's observedFetch records them.
 */
function writeDaptyClient(dir) {
  mkdirSync(dir, { recursive: true });
  const names = Object.keys(files);
  const resources = [
    ...names.map((name, i) => ({
      requestId: `c${i + 1}`,
      url: `${ENV_PATH}/${name}?timestamp=${i + 1}`,
      method: "GET",
      status: 200,
      mimeType: "application/json",
      timestamp: i + 1,
      hasBody: true,
    })),
    {
      requestId: "stored-1",
      url: `${STORED}?timestamp=90`,
      method: "GET",
      status: 200,
      mimeType: "application/json",
      timestamp: 90,
      hasBody: true,
    },
    {
      requestId: "chat-1",
      url: CHAT,
      method: "POST",
      status: 200,
      mimeType: "application/json",
      timestamp: 100,
      hasBody: true,
    },
  ];
  const bodies = {
    ...Object.fromEntries(names.map((name, i) => [`c${i + 1}`, files[name]])),
    "stored-1": STORED_CHAT,
    "chat-1": ANSWER,
  };
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Apty Client E2E (Ask Dapty)",
      version: "1.0.0",
      background: { service_worker: "background.js" },
      externally_connectable: { ids: [AGENT_EXTENSION_ID] },
    }),
  );
  writeFileSync(
    join(dir, "background.js"),
    `const RESOURCES = ${JSON.stringify(resources)};
const BODIES = ${JSON.stringify(bodies)};
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.id !== ${JSON.stringify(AGENT_EXTENSION_ID)}) return false;
  switch (message?.type) {
    case "apty-debug-agent:get-service-worker-status":
      sendResponse({ running: true, lastActivity: Date.now() });
      return true;
    case "apty-debug-agent:get-service-worker-logs":
      sendResponse({ logs: [] });
      return true;
    case "apty-debug-agent:list-observed-resources":
      sendResponse({ resources: RESOURCES });
      return true;
    case "apty-debug-agent:get-resource-body":
      sendResponse(BODIES[message.requestId]
        ? { found: true, body: BODIES[message.requestId], base64Encoded: false }
        : { found: false });
      return true;
    default:
      return false;
  }
});
`,
  );
  return dir;
}

/** A customer's HAR from Injected mode: the page called ai-service itself, and the call never got an answer. */
function injectedHar(pageUrl) {
  const pageOrigin = new URL(pageUrl).origin;
  return JSON.stringify({
    log: {
      entries: [
        {
          _resourceType: "document",
          startedDateTime: "2026-10-29T10:00:00.000Z",
          request: { method: "GET", url: pageUrl },
          response: { status: 200, content: { mimeType: "text/html" } },
        },
        ...Object.entries(files).map(([name, text], i) => ({
          startedDateTime: new Date(
            Date.parse("2026-10-29T10:00:01Z") + i * 1000,
          ).toISOString(),
          request: { method: "GET", url: `${ENV_PATH}/${name}?timestamp=${i}` },
          response: {
            status: 200,
            content: { mimeType: "application/json", text },
          },
        })),
        {
          startedDateTime: "2026-10-29T10:01:00.000Z",
          request: {
            method: "POST",
            url: CHAT,
            headers: [{ name: "Origin", value: pageOrigin }],
            postData: {
              mimeType: "application/json",
              text: JSON.stringify({
                message: "Where do I export reports?",
                context: [],
              }),
            },
          },
          response: {
            status: 0,
            _error: "net::ERR_FAILED",
            content: { mimeType: "" },
          },
        },
      ],
    },
  });
}

const clientDir = writeDaptyClient(join(tempDir("apty-e2e-dapty-"), "client"));
const clientId = unpackedExtensionId(clientDir);

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<title>CRM</title><h1>Reports</h1>",
  });
  browser = await launchBrowser({ extraExtensions: [clientDir] });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function connectClient() {
  const options = await extensionPage(browser);
  if (!(await savedPeerId(options, "client"))) {
    await options.getByRole("tab", { name: "Connection" }).click();
    await options.getByLabel("Extension ID").fill(clientId);
    await options
      .getByLabel("Extension ID")
      .locator("..")
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await options.getByText("Answering").waitFor({ timeout: 30_000 });
  }
  await options.close();
}

describe("Ask Dapty check, end to end", () => {
  it("answers from the Client's record of the chat with no model request, axe clean, no URL", async () => {
    await connectClient();
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    const before = model.requests.length;

    await sendChat(panel, "Dapty suggested a workflow but nothing opens");

    const card = panel.getByRole("region", { name: "Ask Dapty chat check" });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Cause found").waitFor();
    await card.getByText("Rule DAP-06").waitFor();
    await card.getByText("Not published here: opens nothing").waitFor();
    await card
      .getByText("Opens only if visibility rule “On a lead page” passes")
      .waitFor();
    await card
      .getByText("From the Apty Client's record of the chat: 2 turn(s).")
      .waitFor();
    const text = await card.textContent();
    assert.ok(!text.includes("https://"), "the card shows no URL");
    assert.ok(
      !text.includes("jane.doe@example.com"),
      "the user's email is masked",
    );
    assert.equal(model.requests.length, before, "the model was not asked");
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));

    model.script(() => ({ text: "FOLLOW-UP ANSWERED" }));
    await sendChat(panel, "Why does Retired flow not open?");
    await panel.getByText("FOLLOW-UP ANSWERED").waitFor({ timeout: 30_000 });
    const sent = JSON.stringify(model.requests.at(-1));
    assert.match(sent, /Ask Dapty chat check/);
    assert.match(sent, /Retired flow/);
    assert.ok(
      !sent.includes("api.app.apty.ai"),
      "no chat URL reached the model",
    );
    assert.ok(
      !sent.includes("jane.doe@example.com"),
      "no unmasked email reached the model",
    );
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("names the rejected origin behind a failed chat call in a customer's HAR", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    const before = model.requests.length;

    await openToolPage(panel, "Check a HAR file");
    await panel.getByLabel("Choose a HAR file").setInputFiles({
      name: "customer-tenant.har",
      mimeType: "application/json",
      buffer: Buffer.from(
        injectedHar("https://intranet.other.example/reports"),
      ),
    });
    await panel
      .getByText("Ask Dapty: 1 chat call(s) and 0 stored chat(s).")
      .waitFor({ timeout: 30_000 });
    await panel.getByLabel("What is missing?").selectOption("dapty");
    await panel.getByRole("button", { name: "Check", exact: true }).click();

    const card = panel.getByRole("region", { name: "Ask Dapty chat check" });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Rule DAP-04").waitFor();
    await card.getByText("Rule DAP-02").waitFor();
    const text = await card.textContent();
    assert.ok(
      !text.includes("intranet.other.example"),
      "the card shows no URL",
    );
    assert.equal(model.requests.length, before, "the model was not asked");
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await panel.close();
    await app.close();
  });
});
