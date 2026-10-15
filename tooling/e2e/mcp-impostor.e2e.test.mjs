/**
 * S6: a program squatting on the daemon's port (another user on a shared
 * host) must learn nothing from the extension and must not get a tools/call
 * run: the extension never sends the token and waits for the daemon to
 * prove it holds the token first.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  extensionPage,
  launchBrowser,
  ROOT,
  startPageServer,
} from "./harness.mjs";

const require = createRequire(join(ROOT, "apps/mcp-bridge/package.json"));
const { WebSocketServer } = require("ws");

const TOKEN = "e2e-secret-token-0123456789abcdef";

let browser;
let site;
let impostor;
const seen = { protocols: [], frames: [], toolCallReplies: [] };

before(async () => {
  site = await startPageServer({
    "/app.html": "<!doctype html><title>Original</title><main>App</main>",
  });
  impostor = new WebSocketServer({
    port: 0,
    host: "127.0.0.1",
    handleProtocols: (protocols) => [...protocols][0] ?? false,
  });
  impostor.on("connection", (ws, req) => {
    seen.protocols.push(req.headers["sec-websocket-protocol"] ?? "");
    ws.on("message", (data) => {
      const text = data.toString();
      seen.frames.push(text);
      const msg = JSON.parse(text);
      if (msg.method === "auth/challenge") {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { nonce: "c".repeat(64), proof: "0".repeat(64) },
          }),
        );
        // Try anyway: a call the extension must never run.
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 99,
            method: "tools/call",
            params: {
              name: "create_new_tab",
              arguments: { url: `${site.origin}/app.html?pwned=1` },
            },
          }),
        );
      } else if (msg.id === 99) {
        seen.toolCallReplies.push(msg);
      }
    });
  });
  await new Promise((r) => impostor.on("listening", r));
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  impostor?.close();
  site?.close();
});

describe("an impostor on the daemon's port", () => {
  it("never receives the token and never gets a tools/call run", async () => {
    const page = await extensionPage(browser);
    const url = `ws://127.0.0.1:${impostor.address().port}/extension`;
    const response = await page.evaluate(
      ({ url, token }) =>
        chrome.runtime.sendMessage({
          request: "ws-bridge-connect",
          url,
          token,
        }),
      { url, token: TOKEN },
    );
    await new Promise((r) => setTimeout(r, 1500));

    assert.equal(response?.success, false, JSON.stringify(response));
    assert.ok(seen.protocols.length > 0, "the extension did connect");
    const everything = JSON.stringify(seen);
    assert.ok(!everything.includes(TOKEN), "the token reached the impostor");
    assert.ok(
      !seen.frames.some((f) => f.includes("auth/prove")),
      "the extension proved itself to an unproven daemon",
    );
    const opened = await browser.agentWorker.evaluate(async () =>
      (await chrome.tabs.query({})).some((t) => t.url?.includes("pwned=1")),
    );
    assert.equal(opened, false);
    assert.deepEqual(
      seen.toolCallReplies.filter((r) => r.result),
      [],
    );

    await page.evaluate(() =>
      chrome.runtime.sendMessage({ request: "ws-bridge-disconnect" }),
    );
    await page.close();
  });
});
