/**
 * KB-RAG K25, A1: Anthropic's strict tool use refuses `minimum`, `maximum`
 * and the other limits its JSON Schema subset does not support, with a 400
 * for the whole request. A fake Anthropic Messages endpoint answers exactly
 * that when any tool in the request carries one; with a demo pack loaded
 * and an Anthropic key, a product question still gets the model's answer,
 * through search_kb, not the error. Synthetic cards only.
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

const UNSUPPORTED = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
];

/** The first unsupported keyword in a tool's schema, with the tool's index. */
function firstUnsupported(tools) {
  for (const [i, tool] of (tools ?? []).entries()) {
    const found = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (UNSUPPORTED.includes(key)) found.push(key);
        if (key !== "enum" && key !== "const") walk(value);
      }
    };
    walk(tool.input_schema);
    if (found.length > 0) return { index: i, keywords: [...new Set(found)] };
  }
  return undefined;
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

function message(content, stopReason) {
  const start = {
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
  };
  return [
    start,
    ...content,
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
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
    const bad = firstUnsupported(request.tools);
    if (bad) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: `tools.${bad.index}.custom: For 'integer' type, properties ${bad.keywords.join(", ")} are not supported`,
          },
        }),
      );
      return;
    }
    const last = request.messages.at(-1);
    const toolResult = Array.isArray(last.content)
      ? last.content.find((part) => part.type === "tool_result")
      : undefined;
    if (!toolResult) {
      sse(
        res,
        message(
          [
            {
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "tool_use",
                id: "toolu_e2e",
                name: "search_kb",
                input: {},
              },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "input_json_delta",
                partial_json: JSON.stringify({
                  query: "turn on banner glow",
                  topK: 2,
                  layers: null,
                  aptyVersion: null,
                }),
              },
            },
            { type: "content_block_stop", index: 0 },
          ],
          "tool_use",
        ),
      );
      return;
    }
    const text =
      typeof toolResult.content === "string"
        ? toolResult.content
        : JSON.stringify(toolResult.content);
    const cite = /kb:\/\/\d+#L\d/.exec(text)?.[0] ?? "no cite";
    sse(
      res,
      message(
        [
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: `RESULT: turn on the Glowing Banner setting (${cite}).`,
            },
          },
          { type: "content_block_stop", index: 0 },
        ],
        "end_turn",
      ),
    );
  });
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const { file } = writeFixturePack(tempDir("apty-kb-anthropic-"));
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  api?.close();
  site?.close();
});

describe("Anthropic with a KB pack loaded (KB-RAG K25, A1)", () => {
  it("answers through search_kb; no tool carries a keyword Anthropic refuses", async () => {
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
    const reply = await chatAndWait(
      panel,
      "how do I turn the banner glow on in Studio?",
    );

    assert.match(reply, /Glowing Banner setting \(KB card 101, layer 1\)/);
    assert.equal(
      await panel.getByText(/are not supported/).count(),
      0,
      "the 400 must not reach the chat",
    );
    assert.ok(requests.length >= 2, `requests: ${requests.length}`);
    for (const request of requests) {
      assert.equal(firstUnsupported(request.tools), undefined);
    }
    const searchKb = requests[0].tools.find((t) => t.name === "search_kb");
    assert.ok(searchKb, "search_kb is offered");
    await panel.close();
    await app.close();
  });
});
