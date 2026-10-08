/**
 * External MCP clients end to end: the real mcp-bridge daemon, the real
 * extension connected to it, and a risky tool called from a CLI client.
 * The approval request travels from the service worker to the side panel
 * and the click travels back, so this covers the cross-context relay.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { extensionPage, launchBrowser, ROOT, tempDir } from "./harness.mjs";

const DAEMON = join(ROOT, "apps/mcp-bridge/dist/daemon.js");
/** A distinct image per call, so its download can be found by URL (Playwright renames downloaded files). */
const image = (marker) =>
  `data:image/png;base64,${Buffer.from(marker).toString("base64")}`;

let browser;
let configDir;

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startDaemon(extraArgs = []) {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      DAEMON,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--extension-id",
      browser.extensionId,
      ...extraArgs,
    ],
    {
      env: { ...process.env, APTY_MCP_CONFIG_DIR: configDir, HOME: configDir },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const token = readFileSync(join(configDir, "token"), "utf8").trim();
  return { port, token, stop: () => child.kill() };
}

async function connectExtension(daemon) {
  const page = await extensionPage(browser);
  const response = await page.evaluate(
    ({ url, token }) =>
      chrome.runtime.sendMessage({ request: "ws-bridge-connect", url, token }),
    { url: `ws://127.0.0.1:${daemon.port}/extension`, token: daemon.token },
  );
  assert.equal(response?.success, true, JSON.stringify(response));
  await page.close();
}

async function disconnectExtension() {
  const page = await extensionPage(browser);
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ request: "ws-bridge-disconnect" }),
  );
  await page.close();
}

/** Call a tool the way apty-cli does. Resolves with the JSON-RPC response. */
function callTool(daemon, name, args) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/cli`, [
      "apty-mcp.v1",
      `apty-token.${daemon.token}`,
    ]);
    const timer = setTimeout(
      () => reject(new Error(`${name} timed out`)),
      60_000,
    );
    ws.addEventListener("open", () =>
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      ),
    );
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(event.data));
    });
    ws.addEventListener("error", (e) => reject(e));
  });
}

/** The tool's own result object inside an MCP tools/call response. */
function toolPayload(response) {
  const text = response.result?.content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, response };
  }
}

async function downloadsOf(dataUrl) {
  const page = await extensionPage(browser);
  const items = await page.evaluate(
    (url) => chrome.downloads.search({ url }),
    dataUrl,
  );
  await page.close();
  return items;
}

before(async () => {
  assert.ok(existsSync(DAEMON), "Build the MCP bridge first (npm run build).");
  configDir = tempDir("apty-e2e-mcp-");
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  if (configDir) rmSync(configDir, { recursive: true, force: true });
});

describe("MCP bridge in a real browser", () => {
  it("connects from the Options page's own Connect button", async () => {
    const daemon = await startDaemon();
    const options = await extensionPage(browser);
    try {
      await options.getByText("Apty Integration").click();
      await options
        .getByLabel("Bridge URL")
        .fill(`ws://127.0.0.1:${daemon.port}/extension`);
      await options.getByLabel("Auth Token").fill(daemon.token);
      await options
        .getByLabel("Bridge URL")
        .locator("..")
        .getByRole("button", { name: "Connect", exact: true })
        .click();

      await options.getByText(/Connected since/).waitFor({ timeout: 20_000 });
      const health = await fetch(`http://127.0.0.1:${daemon.port}/health`).then(
        (r) => r.json(),
      );
      assert.equal(health.extensionConnected, true, JSON.stringify(health));
    } finally {
      await options.close();
      await disconnectExtension();
      daemon.stop();
    }
  });

  it("blocks risky tools at the daemon unless explicitly allowed", async () => {
    const daemon = await startDaemon();
    try {
      await connectExtension(daemon);
      const response = await callTool(daemon, "download_image", {
        imageData: image("blocked"),
        filename: "blocked",
      });
      assert.ok(response.error, JSON.stringify(response));
      assert.match(
        JSON.stringify(response.error),
        /allow-dangerous-tools|not allowed|blocked/i,
      );
    } finally {
      await disconnectExtension();
      daemon.stop();
    }
  });

  it("relays the approval prompt to the side panel and waits for the click", async () => {
    const daemon = await startDaemon(["--allow-dangerous-tools"]);
    const panel = await extensionPage(
      browser,
      "src/entrypoints/sidepanel/index.html",
    );
    try {
      await connectExtension(daemon);

      const allowed = callTool(daemon, "download_image", {
        imageData: image("e2e-allowed"),
        filename: "e2e-allowed",
      });
      const prompt = panel.getByRole("alertdialog");
      await prompt.waitFor({ timeout: 30_000 });
      assert.match(await prompt.innerText(), /download_image/);
      await prompt.getByRole("button", { name: "Allow once" }).click();
      const allowedResult = toolPayload(await allowed);
      assert.equal(allowedResult.success, true, JSON.stringify(allowedResult));
      assert.equal((await downloadsOf(image("e2e-allowed"))).length, 1);

      const denied = callTool(daemon, "download_image", {
        imageData: image("e2e-denied"),
        filename: "e2e-denied",
      });
      await panel.getByRole("alertdialog").waitFor({ timeout: 30_000 });
      await panel.getByRole("button", { name: "Deny" }).click();
      const deniedResult = toolPayload(await denied);
      assert.equal(deniedResult.status, "denied", JSON.stringify(deniedResult));
      assert.equal((await downloadsOf(image("e2e-denied"))).length, 0);
    } finally {
      await panel.close();
      await disconnectExtension();
      daemon.stop();
    }
  });

  it("refuses a risky tool at once when no side panel can show the prompt", async () => {
    const daemon = await startDaemon(["--allow-dangerous-tools"]);
    try {
      await connectExtension(daemon);
      const started = Date.now();
      const result = toolPayload(
        await callTool(daemon, "download_image", {
          imageData: image("e2e-no-ui"),
          filename: "e2e-no-ui",
        }),
      );
      assert.equal(result.status, "denied", JSON.stringify(result));
      assert.equal(result.reason, "no_approval_ui");
      assert.ok(Date.now() - started < 10_000);
      assert.equal((await downloadsOf(image("e2e-no-ui"))).length, 0);
    } finally {
      await disconnectExtension();
      daemon.stop();
    }
  });
});
