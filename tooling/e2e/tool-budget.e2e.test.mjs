/**
 * KB-RAG K27, F1: Anthropic refuses a request with more than 20 strict
 * tools ("Too many strict tools (22). The maximum number of strict tools is
 * 20"). A fake Anthropic Messages endpoint answers exactly that; both file
 * questions from the first real-pack test still get the model's answer, and
 * an investigation that offers more than 20 tools sends at most 20 strict.
 * Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startPageServer,
  startServer,
  tempDir,
} from "./harness.mjs";
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

const MAX_STRICT = 20;

function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
  for (const event of events) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

let browser;
let api;
let site;
const requests = [];

before(async () => {
  api = await startServer((req, res, body) => {
    if (req.method !== "POST" || !req.url.endsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    const request = JSON.parse(body);
    requests.push(request);
    const strict = (request.tools ?? []).filter((t) => t.strict === true);
    if (strict.length > MAX_STRICT) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: `Too many strict tools (${strict.length}). The maximum number of strict tools is ${MAX_STRICT}.`,
          },
        }),
      );
      return;
    }
    sse(res, `RESULT: answer ${requests.length}, the FIXTURE file lists ids.`);
  });
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const { file } = writeFixturePack(tempDir("apty-kb-budget-"));
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  api?.close();
  site?.close();
});

describe("the tool budget on Anthropic (KB-RAG K27, F1)", () => {
  it("answers both file questions and an investigation, never offering more than 20 strict tools", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(
      browser,
      { baseUrl: `${api.origin}/v1` },
      app,
      {
        aiProvider: "anthropic",
        aiHost: `${api.origin}/v1`,
        aiToken: "sk-ant-e2e-key",
        aiModel: "claude-sonnet-4-5",
      },
    );
    for (const question of [
      "what does flow.json mean",
      // K28, F1: "from flows.json check if workflow Alpha is in segment Beta" is now a lookup answered with no model call.
      "from flows.json check whether workflow Alpha has any steps",
      "investigate why flow.json is empty on this page",
    ]) {
      const reply = await chatAndWait(panel, question);
      assert.match(reply, /RESULT: answer \d+/, question);
    }
    assert.equal(
      await panel.getByText(/Too many strict tools/).count(),
      0,
      "the 400 must not reach the chat",
    );
    assert.ok(requests.length >= 3, `requests: ${requests.length}`);
    for (const request of requests) {
      const offered = request.tools ?? [];
      assert.ok(offered.filter((t) => t.strict === true).length <= MAX_STRICT);
    }
    const fileQuestion = requests[0].tools ?? [];
    assert.ok(fileQuestion.length <= 8, `offered ${fileQuestion.length}`);
    assert.ok(
      requests.at(-1).tools.length > MAX_STRICT,
      "the investigation offers more than 20 tools, so the cap is exercised",
    );
    await panel.close();
    await app.close();
  });
});
