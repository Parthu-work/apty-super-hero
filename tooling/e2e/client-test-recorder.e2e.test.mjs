/**
 * The 5.x Client test-recorder build (tooling/scripts/build-client-test-recorder.mjs)
 * of a tiny fake 5.x Client (fixtures/fake-5x-client), loaded in Chromium
 * next to the Agent. Its service worker makes the calls the real Client
 * makes: a content file, the widget chat call, an analytics call and an
 * axios-style storage save of a stored chat (a Request object). The Agent
 * then asks it, as it would a patched Client, for its status, its recorded
 * calls and the Widget's chats.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildTestRecorder } from "../scripts/build-client-test-recorder.mjs";
import {
  extensionPage,
  launchBrowser,
  ROOT,
  startServer,
  tempDir,
  unpackedExtensionId,
  waitForWorker,
} from "./harness.mjs";

const FAKE_CLIENT = join(ROOT, "tooling/e2e/fixtures/fake-5x-client");
const TENANT = "0f000000-0000-7000-8000-000000000000";
const SUGGESTION = "0c000000-0000-7000-8000-000000000005";

let browser;
let api;
let recorderId;
let worker;
const served = [];

before(async () => {
  api = await startServer((req, res) => {
    served.push(`${req.method} ${new URL(req.url, "http://x").pathname}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      req.url.includes("/widget/chat")
        ? JSON.stringify({
            reply: "Try Export a report.",
            suggestions: [
              { id: SUGGESTION, name: "Export a report", type: "workflow" },
            ],
          })
        : "[]",
    );
  });
  const work = tempDir("apty-e2e-recorder-");
  const zip = join(work, "client.zip");
  execFileSync("zip", ["-qr", zip, "."], { cwd: FAKE_CLIENT });
  const out = join(work, "recorder.zip");
  await buildTestRecorder({ input: zip, output: out });
  const dir = join(work, "recorder");
  mkdirSync(dir);
  execFileSync("unzip", ["-q", out, "-d", dir]);
  recorderId = unpackedExtensionId(dir);
  browser = await launchBrowser({ extraExtensions: [dir] });
  worker = await waitForWorker(browser.context, (url) =>
    url.startsWith(`chrome-extension://${recorderId}/`),
  );
  await worker.evaluate(
    async ({ origin, tenant, suggestion }) => {
      await fetch(
        `${origin}/tenant-${tenant}/app-a/env-e/workflow.json?timestamp=1`,
      );
      await fetch(
        `${origin}/ai-service/api/v1/ai/${tenant}/widget/chat?applicationId=a`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "How do I export?",
            context: [],
            envId: "e",
            applicationType: "SALESFORCE",
          }),
        },
      );
      await fetch(`${origin}/event-gateway/api/v1/events`, {
        method: "POST",
        body: "{}",
      });
      await fetch(
        new Request(`${origin}/widget-storage-service/api/v1/storage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: `tenant-${tenant}/app-a/users/u-1/widget-chat/c-1.json`,
            data: {
              id: "c-1",
              name: "Export",
              messages: [
                { id: "m1", role: "user", content: "How do I export?" },
                {
                  id: "m2",
                  role: "assistant",
                  content: "Try Export a report.",
                  suggestions: [
                    {
                      id: suggestion,
                      name: "Export a report",
                      type: "workflow",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );
      // The recorder saves its record after a short pause.
      await new Promise((resolve) => setTimeout(resolve, 800));
    },
    { origin: api.origin, tenant: TENANT, suggestion: SUGGESTION },
  );
});

after(async () => {
  await browser?.close();
  api?.close();
});

async function ask(message) {
  const page = await extensionPage(browser);
  try {
    return await page.evaluate(
      ({ id, message }) => chrome.runtime.sendMessage(id, message),
      { id: recorderId, message },
    );
  } finally {
    await page.close();
  }
}

describe("the 5.x Client test-recorder build", () => {
  it("answers the Agent's status ping, which the Client itself never answers", async () => {
    const status = await ask({
      type: "apty-debug-agent:get-service-worker-status",
    });
    assert.equal(status?.running, true);
  });

  it("records the content file and the chat call with its request body, and leaves analytics alone", async () => {
    const { resources } = await ask({
      type: "apty-debug-agent:list-observed-resources",
    });
    const urls = resources.map((r) => new URL(r.url).pathname);

    assert.ok(urls.some((u) => u.endsWith("/env-e/workflow.json")));
    const chat = resources.find((r) => r.url.includes("/widget/chat"));
    assert.equal(chat?.method, "POST");
    assert.equal(chat?.status, 200);
    assert.equal(JSON.parse(chat.requestBody).message, "How do I export?");
    assert.ok(!urls.some((u) => u.includes("event-gateway")), "analytics");
    assert.ok(!urls.some((u) => u.includes("widget-storage-service")));
    assert.ok(
      served.includes("POST /event-gateway/api/v1/events") &&
        served.includes("POST /widget-storage-service/api/v1/storage"),
      "every call still reached the network unchanged",
    );
  });

  it("reports the saved chat's turns with the suggestions' ids", async () => {
    const answer = await ask({ type: "apty-debug-agent:get-widget-chat" });

    assert.equal(answer.ok, true);
    const chat = answer.chats.at(-1);
    assert.equal(chat.chatId, "c-1");
    assert.deepEqual(
      chat.turns.map((t) => t.role),
      ["user", "assistant"],
    );
    assert.deepEqual(chat.turns[1].suggestions, [
      { id: SUGGESTION, name: "Export a report", type: "workflow" },
    ]);
  });
});
