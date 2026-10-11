/**
 * An Anthropic API key that is not scoped to a workspace must send
 * `anthropic-workspace-id` on every request. A mock of the Anthropic
 * Messages and Models endpoints answers 400 with Anthropic's own message
 * when the header is missing; Settings → AI Configuration names the fix,
 * and with the Workspace ID entered, Test Connection and Fetch models carry
 * the header.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { extensionPage, launchBrowser, startServer } from "./harness.mjs";

const WORKSPACE = "wrkspc_01MockWorkspace0000000";
const NOT_SCOPED =
  "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.";

let browser;
let api;
let options;
const seen = [];

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  api = await startServer((req, res, body) => {
    const workspace = req.headers["anthropic-workspace-id"] ?? null;
    seen.push({ path: new URL(req.url, "http://x").pathname, workspace });
    if (!workspace) {
      reply(res, 400, {
        type: "error",
        error: { type: "invalid_request_error", message: NOT_SCOPED },
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/v1/models")) {
      reply(res, 200, {
        data: [{ id: "claude-mock", type: "model" }],
        has_more: false,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/v1/messages") {
      const request = JSON.parse(body);
      reply(res, 200, {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: request.model,
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      return;
    }
    res.writeHead(404).end();
  });
  browser = await launchBrowser();
  options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html?tab=ai",
  );
  await options
    .getByRole("tab", { name: "AI Configuration" })
    .click()
    .catch(() => {});
  // Settings load asynchronously and then select a provider; pick Anthropic after that.
  await options.getByLabel("AI Host").waitFor();
  await options
    .getByRole("button", { name: /Anthropic/ })
    .first()
    .click();
  await options.getByLabel("Workspace ID").waitFor();
  await options.getByLabel("AI Host").fill(`${api.origin}/v1`);
  await options.getByPlaceholder("sk-ant-...").fill("sk-ant-e2e-key");
  await options.getByLabel("AI Model").fill("claude-mock");
});

after(async () => {
  await browser?.close();
  api?.close();
});

describe("Anthropic key not scoped to a workspace", () => {
  it("without a Workspace ID: Test Connection shows Anthropic's message and where to enter the ID", async () => {
    await options.getByRole("button", { name: "Test Connection" }).click();
    await options
      .getByText(/Settings → AI Configuration → Workspace ID/)
      .first()
      .waitFor({ timeout: 60_000 });
    assert.match(
      await options
        .getByText(/not scoped to a workspace/)
        .first()
        .innerText(),
      /^Connection test failed: 400: This API key is not scoped/,
    );
    assert.ok(
      seen.some((r) => r.path === "/v1/messages" && !r.workspace),
      JSON.stringify(seen),
    );
  });

  it("with the Workspace ID: Test Connection and Fetch models send it and succeed", async () => {
    seen.length = 0;
    await options.getByLabel("Workspace ID").fill(WORKSPACE);
    await options.getByRole("button", { name: "Test Connection" }).click();
    await options
      .getByText(/^Connection test successful/)
      .last()
      .waitFor({ timeout: 60_000 });
    await options.getByRole("button", { name: /Fetch models/ }).click();
    await options
      .getByText("1 models from the provider")
      .waitFor({ timeout: 30_000 });

    const messages = seen.filter((r) => r.path === "/v1/messages");
    assert.ok(messages.length >= 1, JSON.stringify(seen));
    assert.ok(
      seen.every((r) => r.workspace === WORKSPACE),
      JSON.stringify(seen),
    );
    assert.ok(seen.some((r) => r.path === "/v1/models"));
  });
});
